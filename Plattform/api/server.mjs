import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platformDir = path.resolve(__dirname, "..");
const workspaceDir = path.resolve(platformDir, "..");

const port = Number(process.env.GROUPAR_API_PORT || process.env.PORT || 8787);
const host = process.env.GROUPAR_API_HOST || "127.0.0.1";
const fixturePathFromEnv = process.env.GROUPAR_MANIFEST_FIXTURE;

const fixtureLocalPath = path.join(platformDir, "fixtures", "manifest-test-group-local.json");
const fixtureDefaultPath = path.join(platformDir, "fixtures", "manifest-test-group-v1.json");

const defaultProfileId = "usr_fixture_admin";
const defaultOrgId = "org_fixture_school";
const defaultGroupId = "grp_fixture_ar_test";

const db = {
  profiles: new Map([
    [
      defaultProfileId,
      {
        id: defaultProfileId,
        email: "fixture.admin@example.local",
        displayName: "Fixture Admin",
        accountType: "primary",
        status: "active"
      }
    ]
  ]),
  organizations: new Map(),
  groups: new Map(),
  memberships: [],
  artworks: new Map(),
  revisions: new Map(),
  trigger_images: new Map(),
  media_assets: new Map(),
  asset_derivatives: new Map(),
  manifest_versions: new Map(),
  analytics_events: []
};


let chosenFixturePath = null;
let lastLoadedManifest = null;
let assetPathMap = new Map();

async function main() {
  chosenFixturePath = await resolveManifestFixturePath();
  const loaded = await loadManifestFixture();
  seedDbFromManifest(loaded.manifest);
  assetPathMap = buildFixtureAssetPathMap(loaded.manifest);

  const server = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      const status = error instanceof SyntaxError || error instanceof URIError ? 400 : 500;
      if (status === 500) console.error(error);
      sendError(res, status, status === 400 ? "BadRequest" : "InternalError", status === 400 ? "Malformed request." : "Unexpected API error.", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, host, () => {
    console.log(`GroupAR API slice listening on http://${host}:${server.address().port}`);
    console.log(`Manifest fixture: ${path.relative(workspaceDir, chosenFixturePath)}`);
  });
}

async function route(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const requestPath = normalizeApiPath(decodeURIComponent(url.pathname));

  if (req.method === "GET" && requestPath === "/") {
    res.writeHead(302, { Location: "/dashboard/" }); res.end(); return;
  }

  if ((req.method === "GET" || req.method === "HEAD") &&
      (requestPath.startsWith("/derived/") || assetPathMap.has(requestPath))) {
    await serveFixtureAsset(req, res, requestPath);
    return;
  }

  if (req.method === "GET" && requestPath === "/health") {
    sendJson(res, 200, {
      status: "ok",
      fixture: path.relative(workspaceDir, chosenFixturePath)
    });
    return;
  }

  if (req.method === "GET" && requestPath === "/me") {
    sendJson(res, 200, buildMeResponse(currentProfile()));
    return;
  }

  if (req.method === "GET" && requestPath === "/me/groups") {
    sendJson(res, 200, { groups: groupsForProfile(currentProfile().id) });
    return;
  }

  if (req.method === "GET" && requestPath === "/groups") {
    sendJson(res, 200, { groups: groupsForProfile(currentProfile().id) });
    return;
  }

  const groupArtworksMatch = requestPath.match(/^\/groups\/([^/]+)\/artworks$/);
  if (req.method === "GET" && groupArtworksMatch) {
    handleListArtworks(res, groupArtworksMatch[1]);
    return;
  }

  if (req.method === "POST" && groupArtworksMatch) {
    const body = await readJsonBody(req);
    handleCreateArtwork(res, { ...body, groupId: groupArtworksMatch[1] });
    return;
  }

  const manifestMatch = requestPath.match(/^\/groups\/([^/]+)\/manifest$/);
  if ((req.method === "GET" || req.method === "HEAD") && manifestMatch) {
    await handleGetManifest(req, res, manifestMatch[1]);
    return;
  }

  if (req.method === "POST" && requestPath === "/uploads/sign") {
    const body = await readJsonBody(req);
    handleSignUpload(res, body);
    return;
  }

  if (req.method === "POST" && requestPath === "/artworks") {
    const body = await readJsonBody(req);
    handleCreateArtwork(res, body);
    return;
  }

  const publishMatch = requestPath.match(/^\/artworks\/([^/]+)\/publish$/);
  if (req.method === "POST" && publishMatch) {
    const body = await readJsonBody(req);
    handlePublishArtwork(res, publishMatch[1], body);
    return;
  }

  const revisionStatusMatch = requestPath.match(/^\/revisions\/([^/]+)\/status$/);
  if (req.method === "GET" && revisionStatusMatch) {
    handleGetRevisionStatus(res, revisionStatusMatch[1]);
    return;
  }

  const revisionPublishMatch = requestPath.match(/^\/revisions\/([^/]+)\/publish$/);
  if (req.method === "POST" && revisionPublishMatch) {
    await readJsonBody(req);
    handlePublishRevision(res, revisionPublishMatch[1]);
    return;
  }

  if (req.method === "POST" && requestPath === "/analytics/events") {
    const body = await readJsonBody(req);
    handleAnalyticsEvents(res, body);
    return;
  }

  sendError(res, 404, "NotFound", "Endpoint not found.");
}

function normalizeApiPath(requestPath) {
  let normalized = requestPath.replace(/\/+$/, "") || "/";
  if (normalized.startsWith("/api/v1/")) {
    normalized = normalized.slice("/api/v1".length);
  } else if (normalized === "/api/v1") {
    normalized = "/";
  }
  return normalized;
}

function currentProfile() {
  return db.profiles.get(defaultProfileId);
}

function buildMeResponse(profile) {
  const memberships = db.memberships.filter((membership) => membership.profileId === profile.id);
  const organizations = memberships
    .filter((membership) => membership.groupId === null)
    .map((membership) => {
      const org = db.organizations.get(membership.orgId);
      return {
        id: org.id,
        name: org.name,
        role: membership.role,
        capabilities: membership.capabilities
      };
    });
  const groups = groupsForProfile(profile.id);

  return {
    user: {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      accountType: profile.accountType
    },
    organizations,
    groups
  };
}

function groupsForProfile(profileId) {
  return db.memberships
    .filter((membership) => membership.profileId === profileId && membership.groupId)
    .map((membership) => {
      const group = db.groups.get(membership.groupId);
      return {
        id: group.id,
        organizationId: group.orgId,
        name: group.name,
        role: membership.role,
        capabilities: membership.capabilities
      };
    });
}

async function handleGetManifest(req, res, groupId) {
  if (!canUseGroup(currentProfile().id, groupId)) {
    sendError(res, 404, "GroupNotFound", "Group does not exist or is not visible.");
    return;
  }

  const loaded = await loadManifestFixture();
  if (loaded.manifest.group.id !== groupId) {
    sendError(res, 404, "GroupNotFound", "No manifest fixture is available for this group.");
    return;
  }

  const etagHeader = toHttpEtag(loaded.manifest.etag || loaded.hash);
  const headers = manifestHeaders(loaded.manifest, etagHeader, loaded.raw);
  const ifNoneMatch = req.headers["if-none-match"];

  if (ifNoneMatch && etagMatches(ifNoneMatch, etagHeader, loaded.manifest.etag)) {
    const { "Content-Length": _contentLength, "Content-Type": _contentType, ...notModifiedHeaders } =
      headers;
    res.writeHead(304, notModifiedHeaders);
    res.end();
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  res.end(loaded.raw);
}

function handleListArtworks(res, groupId) {
  if (!canUseGroup(currentProfile().id, groupId)) {
    sendError(res, 404, "GroupNotFound", "Group does not exist or is not visible.");
    return;
  }

  const artworks = [...db.artworks.values()]
    .filter((artwork) => artwork.groupId === groupId && artwork.lifecycleStatus === "active")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map((artwork) => {
      const revision = latestRevisionForArtwork(artwork.id);
      return {
        ...toApiArtwork(artwork),
        revision: revision ? toApiRevisionSummary(revision) : null
      };
    });

  sendJson(res, 200, { artworks });
}

function handleSignUpload(res, body) {
  const required = ["groupId", "uploadType", "contentType", "byteSize"];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      sendError(res, 400, "ValidationFailed", `Missing required field: ${field}.`);
      return;
    }
  }

  if (!canUseGroup(currentProfile().id, body.groupId)) {
    sendError(res, 403, "Forbidden", "You do not have access to this group.");
    return;
  }

  if (!["trigger", "media"].includes(body.uploadType)) {
    sendError(res, 422, "UnsupportedUploadType", "uploadType must be trigger or media.");
    return;
  }

  const group = db.groups.get(body.groupId);
  const uploadId = `${body.uploadType === "trigger" ? "tri" : "med"}_${crypto.randomUUID()}`;
  const artworkId = body.artworkId || "art_unassigned";
  const revisionId = body.revisionId || "rev_unassigned";
  const objectKey =
    body.uploadType === "trigger"
      ? `raw/${group.orgId}/${group.id}/${artworkId}/${revisionId}/trigger/${uploadId}/original`
      : `raw/${group.orgId}/${group.id}/${artworkId}/${revisionId}/media/${uploadId}/original`;

  sendJson(res, 200, {
    uploadIntentId: `upl_${crypto.randomUUID()}`,
    uploadType: body.uploadType,
    objectKey,
    processingStatus: "upload_pending",
    upload: {
      method: "PUT",
      url: `http://localhost:${port}/mock-r2/${objectKey}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      headers: {
        "Content-Type": body.contentType,
        ...(body.sha256 ? { "x-amz-checksum-sha256": body.sha256 } : {})
      }
    },
    mock: true
  });
}

function handleCreateArtwork(res, body) {
  if (!body.groupId) {
    sendError(res, 400, "ValidationFailed", "Missing required field: groupId.");
    return;
  }

  if (!canUseGroup(currentProfile().id, body.groupId)) {
    sendError(res, 403, "Forbidden", "You do not have access to this group.");
    return;
  }

  const group = db.groups.get(body.groupId);
  const now = new Date().toISOString();
  const artworkId = body.artworkId || `art_${crypto.randomUUID()}`;
  const revisionId = `rev_${crypto.randomUUID()}`;
  const artwork = {
    id: artworkId,
    orgId: group.orgId,
    groupId: group.id,
    title: body.title || "Untitled Artwork",
    description: body.description || "",
    locale: body.locale || "de-DE",
    tags: Array.isArray(body.tags) ? body.tags : [],
    lifecycleStatus: "active",
    createdBy: currentProfile().id,
    createdAt: now,
    updatedAt: now
  };
  const revision = {
    id: revisionId,
    artworkId,
    orgId: group.orgId,
    groupId: group.id,
    revisionNo: 1,
    status: "draft",
    createdBy: currentProfile().id,
    createdAt: now,
    updatedAt: now
  };

  db.artworks.set(artwork.id, artwork);
  db.revisions.set(revision.id, revision);

  sendJson(res, 201, {
    artwork: toApiArtwork(artwork),
    revision: toApiRevisionSummary(revision)
  });
}

function handlePublishArtwork(res, artworkId, body) {
  const artwork = db.artworks.get(artworkId);
  if (!artwork || !canUseGroup(currentProfile().id, artwork.groupId)) {
    sendError(res, 404, "ArtworkNotFound", "Artwork does not exist or is not visible.");
    return;
  }

  const revision = resolveRevisionForPublish(artworkId, body?.revisionId);
  if (!revision) {
    sendError(res, 404, "RevisionNotFound", "No revision exists for this artwork.");
    return;
  }

  publishRevision(res, artwork, revision);
}

function handleGetRevisionStatus(res, revisionId) {
  const revision = db.revisions.get(revisionId);
  const artwork = revision ? db.artworks.get(revision.artworkId) : null;

  if (!revision || !artwork || !canUseGroup(currentProfile().id, revision.groupId)) {
    sendError(res, 404, "RevisionNotFound", "Revision does not exist or is not visible.");
    return;
  }

  sendJson(res, 200, toApiRevisionStatus(revision));
}

function handlePublishRevision(res, revisionId) {
  const revision = db.revisions.get(revisionId);
  const artwork = revision ? db.artworks.get(revision.artworkId) : null;

  if (!revision || !artwork || !canUseGroup(currentProfile().id, revision.groupId)) {
    sendError(res, 404, "RevisionNotFound", "Revision does not exist or is not visible.");
    return;
  }

  publishRevision(res, artwork, revision);
}

function publishRevision(res, artwork, revision) {
  if (!canPublishGroup(currentProfile().id, revision.groupId)) {
    sendError(res, 403, "Forbidden", "You do not have permission to publish this group.");
    return;
  }

  if (revision.status === "published") {
    sendJson(res, 200, publishedArtworkResponse(artwork, revision));
    return;
  }

  const publishability = checkRevisionPublishable(revision);
  if (!publishability.ok) {
    sendError(res, 422, "RevisionNotPublishable", "Revision does not satisfy publish requirements.", {
      missing: publishability.missing
    });
    return;
  }

  for (const otherRevision of revisionsForArtwork(artwork.id)) {
    if (otherRevision.id !== revision.id && otherRevision.status === "published") {
      otherRevision.status = "superseded";
      otherRevision.updatedAt = new Date().toISOString();
      db.revisions.set(otherRevision.id, otherRevision);
    }
  }

  const now = new Date().toISOString();
  revision.status = "published";
  revision.publishedBy = currentProfile().id;
  revision.publishedAt = now;
  revision.updatedAt = now;
  artwork.currentPublishedRevisionId = revision.id;
  artwork.updatedAt = now;
  db.artworks.set(artwork.id, artwork);
  db.revisions.set(revision.id, revision);
  sendJson(res, 200, publishedArtworkResponse(artwork, revision));
}

function handleAnalyticsEvents(res, body) {
  const rawEvents = Array.isArray(body.events) ? body.events : [body];
  const accepted = [];
  const rejected = [];

  for (const event of rawEvents) {
    if (!event || typeof event !== "object") {
      rejected.push({ code: "ValidationFailed", message: "Event must be an object." });
      continue;
    }

    if (!event.type || !event.groupId) {
      rejected.push({
        eventId: event.eventId,
        code: "ValidationFailed",
        message: "Event requires type and groupId."
      });
      continue;
    }

    if (!canUseGroup(currentProfile().id, event.groupId)) {
      rejected.push({
        eventId: event.eventId,
        code: "Forbidden",
        message: "No access to event group."
      });
      continue;
    }

    const eventId = event.eventId || `evt_${crypto.randomUUID()}`;
    if (db.analytics_events.some((stored) => stored.eventId === eventId)) {
      accepted.push({ eventId, duplicate: true });
      continue;
    }

    const stored = {
      id: `ane_${crypto.randomUUID()}`,
      eventId,
      type: event.type,
      occurredAt: event.occurredAt || new Date().toISOString(),
      orgId: db.groups.get(event.groupId).orgId,
      groupId: event.groupId,
      profileId: currentProfile().id,
      artworkId: event.artworkId,
      targetKey: event.targetId,
      triggerImageId: event.triggerImageId,
      manifestVersion: event.manifestVersion,
      sessionId: event.sessionId,
      platform: event.platform,
      properties: event.properties || {},
      receivedAt: new Date().toISOString()
    };
    db.analytics_events.push(stored);
    accepted.push({ eventId });
  }

  sendJson(res, rejected.length > 0 ? 202 : 200, {
    accepted: accepted.length,
    rejected: rejected.length,
    acceptedEvents: accepted,
    rejectedEvents: rejected
  });
}

function resolveRevisionForPublish(artworkId, requestedRevisionId) {
  if (requestedRevisionId) {
    const revision = db.revisions.get(requestedRevisionId);
    return revision?.artworkId === artworkId ? revision : null;
  }

  return [...db.revisions.values()]
    .filter((revision) => revision.artworkId === artworkId)
    .sort((a, b) => b.revisionNo - a.revisionNo)[0];
}

function revisionsForArtwork(artworkId) {
  return [...db.revisions.values()]
    .filter((revision) => revision.artworkId === artworkId)
    .sort((a, b) => b.revisionNo - a.revisionNo);
}

function latestRevisionForArtwork(artworkId) {
  return revisionsForArtwork(artworkId)[0] || null;
}

function checkRevisionPublishable(revision) {
  const trigger = [...db.trigger_images.values()].find(
    (item) => item.artworkRevisionId === revision.id
  );
  const media = [...db.media_assets.values()].filter(
    (item) => item.artworkRevisionId === revision.id
  );
  const primaryMedia = media.find((item) => item.role === "primary");

  const missing = [];
  if (revision.status !== "approved") {
    missing.push("revision_status_approved");
  }
  if (!trigger || trigger.processingStatus !== "ready") {
    missing.push("ready_trigger");
  }
  if (trigger && !["passed", "warning"].includes(trigger.qualityStatus)) {
    missing.push("publishable_trigger_quality");
  }
  if (!primaryMedia || primaryMedia.processingStatus !== "ready") {
    missing.push("ready_primary_content");
  }
  if (!hasReadyDerivativeForTrigger(trigger)) {
    missing.push("ready_trigger_derivative");
  }
  if (!primaryMedia || !hasReadyDerivativeForMedia(primaryMedia)) {
    missing.push("ready_primary_content_derivative");
  }

  return { ok: missing.length === 0, missing };
}

function revisionAssetStatus(revision) {
  const trigger = [...db.trigger_images.values()].find(
    (item) => item.artworkRevisionId === revision.id
  );
  const primaryMedia = [...db.media_assets.values()].find(
    (item) => item.artworkRevisionId === revision.id && item.role === "primary"
  );

  return {
    triggerStatus: trigger?.processingStatus || "missing",
    primaryContentStatus: primaryMedia?.processingStatus || "missing"
  };
}

function hasReadyDerivativeForTrigger(trigger) {
  if (!trigger) return false;
  return [...db.asset_derivatives.values()].some(
    (derivative) =>
      derivative.triggerImageId === trigger.id && derivative.processingStatus === "ready"
  );
}

function hasReadyDerivativeForMedia(media) {
  return [...db.asset_derivatives.values()].some(
    (derivative) => derivative.mediaAssetId === media.id && derivative.processingStatus === "ready"
  );
}

function publishedArtworkResponse(artwork, revision) {
  const manifest = [...db.manifest_versions.values()].find(
    (item) => item.groupId === artwork.groupId && item.status === "published"
  );

  return {
    artworkId: artwork.id,
    revisionId: revision.id,
    status: "published",
    manifest: manifest
      ? {
          id: manifest.id,
          version: manifest.versionNo,
          status: manifest.status,
          etag: manifest.etag
        }
      : null,
    publishedAt: revision.publishedAt || new Date().toISOString(),
    mock: true
  };
}

async function serveFixtureAsset(req, res, requestPath) {
  const mappedPath = assetPathMap.get(requestPath);
  if (!mappedPath) {
    sendError(res, 404, "AssetNotFound", "No local fixture asset is mapped for this URL.");
    return;
  }

  const absolutePath = path.resolve(workspaceDir, mappedPath);
  if (!absolutePath.startsWith(workspaceDir + path.sep)) {
    sendError(res, 403, "Forbidden", "Invalid fixture asset path.");
    return;
  }

  try {
    const fileStat = await stat(absolutePath);
    const headers = {
      "Content-Type": contentTypeForPath(absolutePath),
      "Content-Length": String(fileStat.size),
      "Cache-Control": "public, max-age=3600"
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    createReadStream(absolutePath).pipe(res);
  } catch {
    sendError(res, 404, "AssetNotFound", "Mapped fixture asset file does not exist.");
  }
}

async function resolveManifestFixturePath() {
  if (fixturePathFromEnv) {
    return path.resolve(workspaceDir, fixturePathFromEnv);
  }
  if (await pathExists(fixtureLocalPath)) {
    return fixtureLocalPath;
  }
  return fixtureDefaultPath;
}

async function loadManifestFixture() {
  const raw = await readFile(chosenFixturePath, "utf8");
  const manifest = JSON.parse(raw);
  const issues = validateManifestContract(manifest);
  if (issues.length > 0) {
    throw new Error(
      `Manifest fixture violates Plattform/contracts.md: ${issues.join("; ")}`
    );
  }

  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  lastLoadedManifest = { raw, manifest, hash };
  return lastLoadedManifest;
}

function validateManifestContract(manifest) {
  const issues = [];
  const topLevelRequired = [
    "schemaVersion",
    "manifestVersion",
    "manifestId",
    "generatedAt",
    "etag",
    "organization",
    "group",
    "cache",
    "limits",
    "content",
    "targets",
    "deletedTargetIds",
    "requiredApp"
  ];
  for (const field of topLevelRequired) {
    if (!(field in manifest)) issues.push(`missing top-level ${field}`);
  }
  if (!Array.isArray(manifest.content)) issues.push("content must be a top-level array");
  if (!Array.isArray(manifest.targets)) issues.push("targets must be an array");
  if (manifest.artworks) issues.push("top-level artworks[] is not allowed");
  if (manifest.assets) issues.push("top-level assets[] is not allowed");

  const contentIds = new Set();
  for (const item of manifest.content || []) {
    if (!item.contentId) issues.push("content item missing contentId");
    if ("id" in item) issues.push(`content ${item.contentId || "unknown"} must not use id`);
    if (item.contentId) contentIds.add(item.contentId);
  }

  for (const target of manifest.targets || []) {
    if ("content" in target) {
      issues.push(`target ${target.targetId || "unknown"} must not embed content[]`);
    }
    if (!Array.isArray(target.contentIds)) {
      issues.push(`target ${target.targetId || "unknown"} missing contentIds[]`);
    }
    if (!target.primaryContentId) {
      issues.push(`target ${target.targetId || "unknown"} missing primaryContentId`);
    }
    for (const contentId of target.contentIds || []) {
      if (!contentIds.has(contentId)) {
        issues.push(`target ${target.targetId || "unknown"} references unknown ${contentId}`);
      }
    }
    if (target.primaryContentId && !contentIds.has(target.primaryContentId)) {
      issues.push(`target ${target.targetId || "unknown"} primaryContentId missing in content[]`);
    }
    if (
      target.primaryContentId &&
      Array.isArray(target.contentIds) &&
      !target.contentIds.includes(target.primaryContentId)
    ) {
      issues.push(`target ${target.targetId || "unknown"} primaryContentId not in contentIds[]`);
    }
  }

  return issues;
}

function seedDbFromManifest(manifest) {
  db.organizations.set(manifest.organization.id, {
    id: manifest.organization.id,
    name: manifest.organization.name,
    lifecycleStatus: "active"
  });
  db.groups.set(manifest.group.id, {
    id: manifest.group.id,
    orgId: manifest.organization.id,
    name: manifest.group.name,
    lifecycleStatus: "active",
    currentManifestVersionId: manifest.manifestId
  });
  db.memberships.push({
    orgId: manifest.organization.id,
    groupId: null,
    profileId: defaultProfileId,
    role: "admin",
    capabilities: ["can_publish", "can_manage_members", "can_use_app"]
  });
  db.memberships.push({
    orgId: manifest.organization.id,
    groupId: manifest.group.id,
    profileId: defaultProfileId,
    role: "admin",
    capabilities: ["can_publish", "can_manage_members", "can_use_app"]
  });

  db.manifest_versions.set(manifest.manifestId, {
    id: manifest.manifestId,
    orgId: manifest.organization.id,
    groupId: manifest.group.id,
    versionNo: manifest.manifestVersion,
    status: "published",
    etag: manifest.etag,
    generatedAt: manifest.generatedAt,
    snapshotPath: path.relative(workspaceDir, chosenFixturePath)
  });

  for (const target of manifest.targets) {
    db.artworks.set(target.artworkId, {
      id: target.artworkId,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      title: target.title,
      description: "",
      locale: target.locale,
      tags: target.tags || [],
      lifecycleStatus: "active",
      currentPublishedRevisionId: target.revisionId,
      createdBy: defaultProfileId,
      createdAt: target.updatedAt,
      updatedAt: target.updatedAt
    });
    db.revisions.set(target.revisionId, {
      id: target.revisionId,
      artworkId: target.artworkId,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      revisionNo: Number(target.revisionId.match(/_(\d+)$/)?.[1] || 1),
      status: "published",
      createdBy: defaultProfileId,
      publishedBy: defaultProfileId,
      publishedAt: target.updatedAt,
      createdAt: target.updatedAt,
      updatedAt: target.updatedAt
    });
    db.trigger_images.set(target.triggerImageId, {
      id: target.triggerImageId,
      artworkRevisionId: target.revisionId,
      artworkId: target.artworkId,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      targetKey: target.targetId,
      physicalWidthMeters: target.physicalWidthMeters,
      processingStatus: "ready",
      qualityStatus: target.quality.status,
      sha256: target.image.sha256
    });
    db.asset_derivatives.set(`der_${target.triggerImageId}`, {
      id: `der_${target.triggerImageId}`,
      triggerImageId: target.triggerImageId,
      mediaAssetId: null,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      kind: "trigger.normalized",
      cdnUrl: target.image.url,
      mimeType: target.image.contentType,
      bytes: target.image.byteSize,
      sha256: target.image.sha256,
      processingStatus: "ready"
    });
  }

  const revisionByContentId = new Map();
  for (const target of manifest.targets) {
    for (const contentId of target.contentIds) {
      revisionByContentId.set(contentId, target);
    }
  }

  for (const content of manifest.content) {
    const target = revisionByContentId.get(content.contentId);
    db.media_assets.set(content.contentId, {
      id: content.contentId,
      artworkRevisionId: target?.revisionId,
      artworkId: target?.artworkId,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      assetType: content.type,
      role: content.role,
      processingStatus: "ready",
      sha256: content.sha256
    });
    db.asset_derivatives.set(`der_${content.contentId}`, {
      id: `der_${content.contentId}`,
      triggerImageId: null,
      mediaAssetId: content.contentId,
      orgId: manifest.organization.id,
      groupId: manifest.group.id,
      kind: derivativeKindForContent(content),
      cdnUrl: content.url,
      mimeType: content.contentType,
      bytes: content.byteSize,
      sha256: content.sha256,
      processingStatus: "ready"
    });
  }
}

function buildFixtureAssetPathMap(manifest) {
  const map = new Map([
    ["/dashboard", "Plattform/dashboard/index.html"],
    ["/dashboard/app.js", "Plattform/dashboard/app.js"],
    ["/dashboard/styles.css", "Plattform/dashboard/styles.css"],
    ["/fixtures/manifest-test-group-v1.json", "Plattform/fixtures/manifest-test-group-v1.json"]
  ]);
  for (const entry of [...manifest.content, ...manifest.targets.map(target => target.image)]) {
    const pathname = new URL(entry.url).pathname;
    if (!pathname.startsWith("/derived/")) throw new Error("Fixture assets must use /derived/ URLs");
    map.set(pathname, path.join("Plattform", "fixtures", "cdn-root", pathname.slice(1)));
  }
  return map;
}

function derivativeKindForContent(content) {
  if (content.type === "video") return "video.mp4_1080p";
  if (content.type === "model3d") return "model.glb_validated";
  if (content.role === "thumbnail") return "image.thumbnail_512";
  return "image.optimized_2048";
}

function toApiArtwork(artwork) {
  return {
    id: artwork.id,
    organizationId: artwork.orgId,
    groupId: artwork.groupId,
    title: artwork.title,
    description: artwork.description,
    locale: artwork.locale,
    tags: artwork.tags,
    lifecycleStatus: artwork.lifecycleStatus,
    createdAt: artwork.createdAt,
    updatedAt: artwork.updatedAt
  };
}

function toApiRevisionSummary(revision) {
  return {
    id: revision.id,
    artworkId: revision.artworkId,
    revisionNumber: revision.revisionNo,
    status: revision.status,
    ...revisionAssetStatus(revision),
    createdAt: revision.createdAt,
    updatedAt: revision.updatedAt
  };
}

function toApiRevisionStatus(revision) {
  const publishability =
    revision.status === "published" ? { ok: true, missing: [] } : checkRevisionPublishable(revision);

  return {
    revision: toApiRevisionSummary(revision),
    missing: publishability.missing
  };
}

function canUseGroup(profileId, groupId) {
  return hasGroupCapability(profileId, groupId, "can_use_app");
}

function canPublishGroup(profileId, groupId) {
  return hasGroupCapability(profileId, groupId, "can_publish");
}

function hasGroupCapability(profileId, groupId, capability) {
  return db.memberships.some(
    (membership) =>
      membership.profileId === profileId &&
      membership.groupId === groupId &&
      membership.capabilities.includes(capability)
  );
}

function manifestHeaders(manifest, etagHeader, raw) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(raw)),
    "ETag": etagHeader,
    "Cache-Control": `private, max-age=${manifest.cache.maxAgeSeconds}, stale-while-revalidate=${manifest.cache.staleWhileRevalidateSeconds}`,
    "Vary": "Authorization, If-None-Match"
  };
}

function toHttpEtag(value) {
  const text = String(value);
  if (text.startsWith("\"") && text.endsWith("\"")) return text;
  return `"${text}"`;
}

function etagMatches(ifNoneMatch, etagHeader, manifestEtag) {
  return String(ifNoneMatch)
    .split(",")
    .map((item) => item.trim())
    .some((item) => item === "*" || item === etagHeader || item === manifestEtag);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function sendJson(res, status, body, headers = {}) {
  const raw = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(raw)),
    ...headers
  });
  res.end(raw);
}

function sendError(res, status, code, message, details = {}) {
  sendJson(res, status, {
    error: {
      code,
      message,
      requestId: `req_${crypto.randomUUID()}`,
      details
    }
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, If-None-Match");
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const byExt = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".glb": "model/gltf-binary"
  };
  return byExt[ext] || "application/octet-stream";
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
