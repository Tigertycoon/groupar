(() => {
  const CONTRACT_STATUSES = {
    asset: [
      "upload_pending",
      "uploaded",
      "queued",
      "processing",
      "ready",
      "needs_manual_review",
      "rejected",
      "failed_retryable",
      "failed_permanent",
      "superseded",
      "deleted",
    ],
    quality: ["pending", "passed", "warning", "failed"],
    revision: [
      "draft",
      "in_review",
      "changes_requested",
      "approved",
      "published",
      "superseded",
      "rejected",
    ],
  };

  const app = document.querySelector("#app");
  const fixtureUrl = "../fixtures/manifest-test-group-v1.json";
  const defaultApiBaseUrl = "http://localhost:8787";
  const apiBaseUrl = configuredApiBaseUrl();

  const state = {
    loaded: false,
    session: null,
    organizations: [],
    groups: [],
    activeGroupId: null,
    selectedArtworkId: null,
    selectedContentType: "image",
    artworks: [],
    manifestByGroup: new Map(),
    events: [],
  };

  const fallbackManifest = {
    schemaVersion: "1.0",
    manifestVersion: 1,
    manifestId: "mfst_fixture_test_group_v1",
    generatedAt: "2026-05-30T18:00:00Z",
    etag: "grp_fixture_ar_test-v1",
    organization: { id: "org_fixture_school", name: "Fixture School" },
    group: { id: "grp_fixture_ar_test", name: "AR Fixture Test Group" },
    cache: { maxAgeSeconds: 3600, staleWhileRevalidateSeconds: 86400 },
    limits: { activeTargetCount: 100, maxMovingImages: 1 },
    content: [
      {
        contentId: "med_fixture_box_scene_image",
        type: "image",
        role: "primary",
        url: "https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/media/med_fixture_box_scene_image/image_2048.png",
        contentType: "image/png",
        byteSize: 122490,
        sha256: "8b0225ff76244a42bd1400c0904f8b7afea7d97b7d8115495e42e98ad347bd51",
        metadata: { placement: "onImage", scale: 1.0, loop: false },
      },
    ],
    targets: [
      {
        targetId: "trg_fixture_feature_box",
        artworkId: "art_fixture_feature_box",
        revisionId: "rev_fixture_feature_box_001",
        triggerImageId: "tri_fixture_feature_box_001",
        title: "Feature Box Image Target",
        locale: "de-DE",
        tags: ["fixture", "image", "features2d"],
        updatedAt: "2026-05-30T18:00:00Z",
        physicalWidthMeters: 0.18,
        image: {
          url: "https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.png",
          contentType: "image/png",
          width: 324,
          height: 223,
          byteSize: 50728,
          sha256: "1094629c1e2ebbc8a9ae2c9c63e18c1dff0f5f1481146e02f3b11a3d30feb20a",
        },
        quality: {
          status: "passed",
          score: 0.82,
          featureCount: 620,
          arcoreScore: 82,
          warnings: [],
        },
        contentIds: ["med_fixture_box_scene_image"],
        primaryContentId: "med_fixture_box_scene_image",
      },
    ],
    deletedTargetIds: [],
    requiredApp: { minVersion: "1.0.0", recommendedVersion: "1.2.0" },
  };

  const MockApi = {
    async bootstrap() {
      let manifest = fallbackManifest;
      try {
        const response = await fetch(fixtureUrl, { cache: "no-store" });
        if (response.ok) manifest = await response.json();
      } catch {
        logEvent("Fixture-Fallback genutzt");
      }

      state.organizations = [
        {
          id: manifest.organization.id,
          name: manifest.organization.name,
          role: "admin",
          capabilities: [
            "can_publish",
            "can_manage_members",
            "can_use_app",
            "can_override_technical_warning",
          ],
        },
      ];

      state.groups = [
        {
          id: manifest.group.id,
          organizationId: manifest.organization.id,
          name: manifest.group.name,
          description: "Mock-Gruppe aus dem kanonischen Testmanifest",
          role: "admin",
          capabilities: [
            "can_publish",
            "can_manage_members",
            "can_use_app",
            "can_override_technical_warning",
          ],
          manifestVersion: manifest.manifestVersion,
          etag: manifest.etag,
          targetLimit: manifest.limits.activeTargetCount,
        },
      ];

      state.manifestByGroup.set(manifest.group.id, manifest);
      state.artworks = manifest.targets.map((target) =>
        artworkFromTarget(target, manifest),
      );

      state.loaded = true;
      render();
    },

    async login(email) {
      state.session = {
        user: {
          id: "usr_mock_dashboard",
          email,
          displayName: email.split("@")[0] || "Dashboard User",
          accountType: "primary",
        },
      };
      state.activeGroupId = null;
      state.selectedArtworkId = null;
      logEvent(`Login: ${email}`);
      render();
    },

    createArtwork(values) {
      const group = activeGroup();
      const idSuffix = slugify(values.title || "artwork");
      const artworkId = uniqueId(`art_${idSuffix}`);
      const revisionId = uniqueId(`rev_${idSuffix}_001`);
      const now = new Date().toISOString();
      const artwork = {
        id: artworkId,
        groupId: group.id,
        title: values.title || "Neues Artwork",
        description: values.description || "",
        locale: values.locale || "de-DE",
        tags: splitTags(values.tags),
        lifecycleStatus: "active",
        revision: {
          id: revisionId,
          number: 1,
          status: "draft",
          updatedAt: now,
        },
        trigger: null,
        media: [],
        publication: null,
        warningOverride: false,
      };
      state.artworks.unshift(artwork);
      state.selectedArtworkId = artwork.id;
      logEvent(`Artwork erstellt: ${artwork.title}`);
      render();
    },

    updateArtwork(values) {
      const artwork = selectedArtwork();
      artwork.title = values.title || artwork.title;
      artwork.description = values.description || "";
      artwork.locale = values.locale || "de-DE";
      artwork.tags = splitTags(values.tags);
      artwork.revision.updatedAt = new Date().toISOString();
      if (artwork.revision.status === "published") {
        artwork.revision = {
          id: uniqueId(`rev_${slugify(artwork.title)}_draft`),
          number: artwork.revision.number + 1,
          status: "draft",
          updatedAt: new Date().toISOString(),
        };
        artwork.publication = null;
      }
      logEvent(`Artwork aktualisiert: ${artwork.title}`);
      render();
    },

    uploadTrigger(file, physicalWidthMeters) {
      const artwork = selectedArtwork();
      const triggerId = uniqueId(`tri_${slugify(artwork.title)}`);
      artwork.trigger = {
        id: triggerId,
        targetKey: artwork.trigger?.targetKey || uniqueId("trg_mock"),
        fileName: file?.name || "trigger.jpg",
        contentType: file?.type || "image/jpeg",
        byteSize: file?.size || 824120,
        processingStatus: "uploaded",
        qualityStatus: "pending",
        physicalWidthMeters,
        previewUrl: null,
        image: null,
        quality: {
          status: "pending",
          score: null,
          featureCount: null,
          arcoreScore: null,
          warnings: [],
        },
      };
      artwork.revision.status = "draft";
      artwork.publication = null;
      logEvent(`Trigger uploaded: ${artwork.trigger.fileName}`);
      render();

      setAssetStatus(artwork.id, "trigger", "queued", 550);
      setAssetStatus(artwork.id, "trigger", "processing", 1200);
      simulateTriggerResult(artwork.id, file?.name || "", 2300);
    },

    uploadMedia(file, mediaType) {
      const artwork = selectedArtwork();
      const mediaId = uniqueId(`med_${slugify(artwork.title)}_${mediaType}`);
      const media = {
        id: mediaId,
        type: mediaType,
        role: "primary",
        fileName: file?.name || `content.${mediaType === "model3d" ? "glb" : mediaType}`,
        contentType: file?.type || defaultContentType(mediaType),
        byteSize: file?.size || defaultByteSize(mediaType),
        processingStatus: "uploaded",
        sha256: `mock-${mediaId}`,
        metadata: { placement: "onImage", scale: 1.0, loop: mediaType === "video" },
        url: null,
      };

      artwork.media = artwork.media.filter((item) => item.role !== "primary");
      artwork.media.unshift(media);
      artwork.revision.status = "draft";
      artwork.publication = null;
      logEvent(`Content uploaded: ${media.fileName}`);
      render();

      setAssetStatus(artwork.id, media.id, "queued", 550);
      setAssetStatus(artwork.id, media.id, "processing", 1200);
      simulateMediaResult(artwork.id, media.id, file?.name || "", 2300);
    },

    setWarningOverride(enabled) {
      const artwork = selectedArtwork();
      artwork.warningOverride = enabled;
      logEvent(enabled ? "Technische Warnung freigegeben" : "Freigabe entfernt");
      render();
    },

    publish() {
      const artwork = selectedArtwork();
      const group = activeGroup();
      const readiness = getPublishReadiness(artwork);
      if (!readiness.canPublish) return;

      const manifest = state.manifestByGroup.get(group.id);
      const nextVersion = (manifest?.manifestVersion || group.manifestVersion || 1) + 1;
      artwork.revision.status = "published";
      artwork.revision.updatedAt = new Date().toISOString();
      artwork.publication = {
        manifestId: `mfst_mock_${String(nextVersion).padStart(3, "0")}`,
        manifestVersion: nextVersion,
        manifestStatus: "queued",
        publishedAt: new Date().toISOString(),
      };
      group.manifestVersion = nextVersion;
      group.etag = `${group.id}-v${nextVersion}`;
      logEvent(`Publish queued: ${artwork.title}`);
      render();

      window.setTimeout(() => {
        const freshArtwork = state.artworks.find((item) => item.id === artwork.id);
        if (!freshArtwork?.publication) return;
        freshArtwork.publication.manifestStatus = "generating";
        logEvent(`manifest.rebuild running: ${freshArtwork.title}`);
        render();
      }, 900);

      window.setTimeout(() => {
        const freshArtwork = state.artworks.find((item) => item.id === artwork.id);
        if (!freshArtwork?.publication) return;
        freshArtwork.publication.manifestStatus = "published";
        logEvent(`Manifest published: v${freshArtwork.publication.manifestVersion}`);
        render();
      }, 2000);
    },
  };

  function artworkFromTarget(target, manifest) {
    const media = target.contentIds
      .map((contentId) => manifest.content.find((item) => item.contentId === contentId))
      .filter(Boolean)
      .map((content) => ({
        id: content.contentId,
        type: content.type,
        role: content.role,
        fileName: content.url.split("/").pop(),
        contentType: content.contentType,
        byteSize: content.byteSize,
        processingStatus: "ready",
        sha256: content.sha256,
        metadata: content.metadata || {},
        url: content.url,
      }));

    return {
      id: target.artworkId,
      groupId: manifest.group.id,
      title: target.title,
      description: "",
      locale: target.locale || "de-DE",
      tags: target.tags || [],
      lifecycleStatus: "active",
      revision: {
        id: target.revisionId,
        number: Number(target.revisionId.match(/(\d+)$/)?.[1] || 1),
        status: "published",
        updatedAt: target.updatedAt,
      },
      trigger: {
        id: target.triggerImageId,
        targetKey: target.targetId,
        fileName: target.image.url.split("/").pop(),
        contentType: target.image.contentType,
        byteSize: target.image.byteSize,
        processingStatus: "ready",
        qualityStatus: target.quality.status,
        physicalWidthMeters: target.physicalWidthMeters,
        previewUrl: target.image.url,
        image: target.image,
        quality: target.quality,
      },
      media,
      publication: {
        manifestId: manifest.manifestId,
        manifestVersion: manifest.manifestVersion,
        manifestStatus: "published",
        publishedAt: manifest.generatedAt,
      },
      warningOverride: target.quality.status === "warning",
    };
  }

  function render() {
    if (!state.loaded) {
      app.innerHTML = `<div class="loading-shell">Dashboard wird geladen...</div>`;
      return;
    }

    if (!state.session) {
      renderLogin();
      return;
    }

    app.innerHTML = `
      <div class="app-shell">
        ${renderSidebar()}
        <main class="workspace">
          ${renderMain()}
        </main>
      </div>
    `;
    bindEvents();
  }

  function renderLogin() {
    app.innerHTML = `
      <main class="login-shell">
        <section class="login-panel" aria-labelledby="login-title">
          <h1 id="login-title">AR Dashboard</h1>
          <p>Arbeitsoberfläche für Gruppen, Triggerbilder, Medien und Manifest-Publish.</p>
          <form class="login-form" data-action="login">
            <label>
              E-Mail
              <input name="email" type="email" autocomplete="email" value="teacher@example.com" required />
            </label>
            <label>
              Passwort
              <input name="password" type="password" autocomplete="current-password" value="mock-password" required />
            </label>
            <button class="primary" type="submit">Einloggen</button>
          </form>
        </section>
      </main>
    `;
    bindEvents();
  }

  function renderSidebar() {
    const org = state.organizations[0];
    const groups = state.groups
      .map(
        (group) => `
          <button class="group-button ${group.id === state.activeGroupId ? "active" : ""}"
            type="button"
            data-action="select-group"
            data-group-id="${escapeAttr(group.id)}">
            <strong>${escapeHtml(group.name)}</strong>
            <span>${artworksForGroup(group.id).length} Artworks · Manifest v${group.manifestVersion}</span>
          </button>
        `,
      )
      .join("");

    return `
      <aside class="sidebar">
        <div class="brand">
          <strong>${escapeHtml(org.name)}</strong>
          <span>Rolle: ${escapeHtml(org.role)} · ${org.capabilities.includes("can_publish") ? "Publish erlaubt" : "Publish gesperrt"}</span>
        </div>

        <div class="side-section">
          <div class="side-title">Gruppen</div>
          ${groups}
        </div>

        <div class="user-strip">
          <div>${escapeHtml(state.session.user.displayName)}</div>
          <div>${escapeHtml(state.session.user.email)}</div>
        </div>
      </aside>
    `;
  }

  function renderMain() {
    if (!state.activeGroupId) return renderGroupOverview();
    if (!state.selectedArtworkId) return renderArtworkList();
    return renderArtworkDetail();
  }

  function renderGroupOverview() {
    const groups = state.groups
      .map(
        (group) => `
        <button class="card" type="button" data-action="select-group" data-group-id="${escapeAttr(group.id)}">
          <div>
            <h2>${escapeHtml(group.name)}</h2>
            <p class="meta">${escapeHtml(group.description)}</p>
          </div>
          <div class="chips">
            ${chip(`${artworksForGroup(group.id).length} Artworks`, "uploaded")}
            ${chip(`Manifest v${group.manifestVersion}`, "published")}
            ${chip(`${group.targetLimit} Target-Limit`, "ok")}
          </div>
        </button>
      `,
      )
      .join("");

    return `
      <div class="topbar">
        <div class="view-title">
          <div class="crumbs">Login · Gruppe auswählen</div>
          <h1>Gruppenübersicht</h1>
          <p>Nur Gruppen aus der aktiven Membership werden angezeigt.</p>
        </div>
      </div>
      <section class="grid-list">
        ${groups}
      </section>
    `;
  }

  function renderArtworkList() {
    const group = activeGroup();
    const artworks = artworksForGroup(group.id);
    const rows = artworks.length
      ? artworks
          .map(
            (artwork) => `
          <button class="artwork-row" type="button" data-action="select-artwork" data-artwork-id="${escapeAttr(artwork.id)}">
            ${renderSmallPreview(artwork)}
            <span>
              <strong>${escapeHtml(artwork.title)}</strong>
              <span>${escapeHtml(artwork.tags.join(", ") || "ohne Tags")}</span>
            </span>
            <span class="chips">
              ${chip(artwork.revision.status, artwork.revision.status)}
              ${chip(assetPhase(artwork.trigger?.processingStatus), artwork.trigger?.processingStatus || "upload_pending")}
              ${chip(qualityLabel(artwork.trigger?.qualityStatus), artwork.trigger?.qualityStatus || "pending")}
            </span>
          </button>
        `,
          )
          .join("")
      : `<div class="empty">Noch keine Artworks in dieser Gruppe.</div>`;

    return `
      <div class="topbar">
        <div class="view-title">
          <div class="crumbs">Gruppe · ${escapeHtml(group.name)}</div>
          <h1>Artwork-Liste</h1>
          <p>${artworks.length} aktive Artworks · Manifest v${group.manifestVersion} · ${escapeHtml(group.etag)}</p>
        </div>
        <div class="toolbar">
          <button type="button" data-action="show-groups">Gruppen</button>
        </div>
      </div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Artworks</h2>
              <p>Status, Qualität und Publish-Zustand pro Revision.</p>
            </div>
          </div>
          <div class="artwork-table">
            ${rows}
          </div>
        </section>

        <aside class="stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Artwork anlegen</h2>
                <p>Erzeugt ein Artwork mit Draft-Revision.</p>
              </div>
            </div>
            <form class="create-form" data-action="create-artwork">
              <label>
                Titel
                <input name="title" required placeholder="z. B. Pflanzenzelle" />
              </label>
              <label>
                Beschreibung
                <textarea name="description" placeholder="Interner Hinweis für die Gruppe"></textarea>
              </label>
              <div class="form-grid">
                <label>
                  Sprache
                  <input name="locale" value="de-DE" />
                </label>
                <label>
                  Tags
                  <input name="tags" placeholder="biologie, zelle" />
                </label>
              </div>
              <button class="primary" type="submit">Artwork anlegen</button>
            </form>
          </section>

          ${renderManifestPanel(group)}
        </aside>
      </div>
    `;
  }

  function renderArtworkDetail() {
    const group = activeGroup();
    const artwork = selectedArtwork();
    const readiness = getPublishReadiness(artwork);
    const primary = primaryContent(artwork);

    return `
      <div class="topbar">
        <div class="view-title">
          <div class="crumbs">Gruppe · ${escapeHtml(group.name)} · Artwork Detail</div>
          <h1>${escapeHtml(artwork.title)}</h1>
          <p>${escapeHtml(artwork.id)} · Revision ${escapeHtml(artwork.revision.id)}</p>
        </div>
        <div class="toolbar">
          <button type="button" data-action="back-to-list">Artwork-Liste</button>
          <button class="primary" type="button" data-action="publish" ${readiness.canPublish ? "" : "disabled"}>
            Publish
          </button>
        </div>
      </div>

      <div class="detail-layout">
        <div>
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Artwork Detail</h2>
                <p>Fachliche Daten der stabilen AR-Einheit.</p>
              </div>
              ${chip(artwork.revision.status, artwork.revision.status)}
            </div>
            <form class="detail-form" data-action="update-artwork">
              <label>
                Titel
                <input name="title" value="${escapeAttr(artwork.title)}" required />
              </label>
              <label>
                Beschreibung
                <textarea name="description">${escapeHtml(artwork.description || "")}</textarea>
              </label>
              <div class="form-grid">
                <label>
                  Sprache
                  <input name="locale" value="${escapeAttr(artwork.locale || "de-DE")}" />
                </label>
                <label>
                  Tags
                  <input name="tags" value="${escapeAttr(artwork.tags.join(", "))}" />
                </label>
              </div>
              <button type="submit">Speichern</button>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Triggerbild Upload</h2>
                <p>Ein stabiler Trigger-Slot pro Artwork im MVP.</p>
              </div>
              ${chip(assetPhase(artwork.trigger?.processingStatus), artwork.trigger?.processingStatus || "upload_pending")}
            </div>
            <div class="asset-layout">
              ${renderTriggerPreview(artwork)}
              <div class="stack">
                <form class="upload-form" data-action="upload-trigger">
                  <div class="form-grid">
                    <label>
                      Physische Breite (m)
                      <input name="physicalWidthMeters" type="number" min="0.03" max="5" step="0.01" value="${escapeAttr(String(artwork.trigger?.physicalWidthMeters || 0.18))}" required />
                    </label>
                    <label>
                      Triggerbild
                      <input name="file" type="file" accept="image/png,image/jpeg,image/webp" />
                    </label>
                  </div>
                  <button type="submit">Trigger hochladen</button>
                </form>
                ${renderTriggerStatus(artwork)}
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Content Upload</h2>
                <p>Primary-Content: Bild, Video oder GLB-Modell.</p>
              </div>
              ${chip(assetPhase(primary?.processingStatus), primary?.processingStatus || "upload_pending")}
            </div>
            <div class="asset-layout">
              ${renderContentPreview(primary)}
              <div class="stack">
                <div class="segmented" role="group" aria-label="Content-Typ">
                  ${["image", "video", "model3d"]
                    .map(
                      (type) => `
                      <button type="button" class="${state.selectedContentType === type ? "active" : ""}" data-action="select-content-type" data-content-type="${type}">
                        ${contentTypeLabel(type)}
                      </button>
                    `,
                    )
                    .join("")}
                </div>
                <form class="upload-form" data-action="upload-media">
                  <label>
                    Datei
                    <input name="file" type="file" accept="${acceptForContentType(state.selectedContentType)}" />
                  </label>
                  <button type="submit">Content hochladen</button>
                </form>
                ${renderMediaStatus(primary)}
              </div>
            </div>
          </section>
        </div>

        <aside class="stack">
          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Processing-/Qualitätsstatus</h2>
                <p>Publish-Gates aus Contract und Mock-API.</p>
              </div>
            </div>
            ${renderReadiness(readiness, artwork)}
          </section>

          <section class="panel">
            <div class="panel-head">
              <div>
                <h2>Publish</h2>
                <p>Erzeugt einen manifest.rebuild Job im Mock.</p>
              </div>
            </div>
            <div class="status-stack">
              <div class="status-line">
                <span>Revision</span>
                ${chip(artwork.revision.status, artwork.revision.status)}
              </div>
              <div class="status-line">
                <span>Manifest</span>
                ${chip(artwork.publication?.manifestStatus || "nicht veröffentlicht", artwork.publication?.manifestStatus || "draft")}
              </div>
              <button class="primary" type="button" data-action="publish" ${readiness.canPublish ? "" : "disabled"}>Publish klicken</button>
            </div>
          </section>

          ${renderManifestPanel(group, artwork)}
        </aside>
      </div>
    `;
  }

  function renderTriggerStatus(artwork) {
    if (!artwork.trigger) {
      return `<div class="empty">Kein Triggerbild hochgeladen.</div>`;
    }
    const warnings = artwork.trigger.quality?.warnings || [];
    return `
      <div class="status-stack">
        <div class="status-line"><span>Processing</span>${chip(artwork.trigger.processingStatus, artwork.trigger.processingStatus)}</div>
        <div class="status-line"><span>Qualität</span>${chip(qualityLabel(artwork.trigger.qualityStatus), artwork.trigger.qualityStatus)}</div>
        <div class="status-line"><span>Target Key</span><strong>${escapeHtml(artwork.trigger.targetKey)}</strong></div>
        <div class="status-line"><span>ARCore Score</span><strong>${artwork.trigger.quality?.arcoreScore ?? "-"}</strong></div>
        ${warnings.length ? `<div class="warning-box">${warnings.map(escapeHtml).join("<br />")}</div>` : ""}
      </div>
    `;
  }

  function renderMediaStatus(media) {
    if (!media) {
      return `<div class="empty">Kein Primary-Content hochgeladen.</div>`;
    }
    return `
      <div class="status-stack">
        <div class="status-line"><span>Processing</span>${chip(media.processingStatus, media.processingStatus)}</div>
        <div class="status-line"><span>Typ</span><strong>${contentTypeLabel(media.type)}</strong></div>
        <div class="status-line"><span>Datei</span><strong>${escapeHtml(media.fileName || media.id)}</strong></div>
        <div class="status-line"><span>Content ID</span><strong>${escapeHtml(media.id)}</strong></div>
      </div>
    `;
  }

  function renderReadiness(readiness, artwork) {
    const warningNeedsOverride =
      artwork.trigger?.qualityStatus === "warning" &&
      artwork.trigger.processingStatus === "ready";

    return `
      <div class="requirements">
        ${readiness.items
          .map(
            (item) => `
            <div class="requirement">
              <span>${escapeHtml(item.label)}</span>
              ${chip(item.ok ? "ok" : item.status, item.ok ? "ok" : item.status)}
            </div>
          `,
          )
          .join("")}
      </div>
      ${
        warningNeedsOverride
          ? `
        <label class="warning-box">
          <input type="checkbox" data-action="toggle-warning-override" ${artwork.warningOverride ? "checked" : ""} />
          Technische Warnung mit Capability freigeben
        </label>
      `
          : ""
      }
      ${readiness.blockers.length ? `<div class="error-box">${readiness.blockers.map(escapeHtml).join("<br />")}</div>` : ""}
    `;
  }

  function renderManifestPanel(group, artwork) {
    const version = artwork?.publication?.manifestVersion || group.manifestVersion;
    const status = artwork?.publication?.manifestStatus || "published";
    const manifestLink = `${apiBaseUrl}/api/v1/groups/${group.id}/manifest`;
    const appLink = `ar-test://groups/${group.id}?manifestVersion=${version}`;

    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Manifest/App-Test-Link</h2>
            <p>Gruppenscope, Version und App-Link.</p>
          </div>
          ${chip(`v${version}`, status)}
        </div>
        <div class="manifest-link">
          <div class="meta">Manifest</div>
          <div class="readonly-link">${escapeHtml(manifestLink)}</div>
          <div class="meta">App-Test-Link</div>
          <div class="readonly-link">${escapeHtml(appLink)}</div>
          <div class="qr">
            <a href="${escapeAttr(appLink)}">App-Test-Link öffnen</a>
          </div>
        </div>
      </section>
    `;
  }

  function renderSmallPreview(artwork) {
    const source = artwork.trigger?.previewUrl || artwork.trigger?.image?.url;
    if (!source) return `<span class="preview">kein Bild</span>`;
    return `<span class="preview"><img src="${escapeAttr(localAssetUrl(source))}" alt="" /></span>`;
  }

  function renderTriggerPreview(artwork) {
    const source = artwork.trigger?.previewUrl || artwork.trigger?.image?.url;
    if (!source) return `<div class="preview" style="width: 170px; height: 128px;">Trigger</div>`;
    return `<div class="preview" style="width: 170px; height: 128px;"><img src="${escapeAttr(localAssetUrl(source))}" alt="" /></div>`;
  }

  function renderContentPreview(media) {
    if (!media?.url) {
      return `<div class="preview" style="width: 170px; height: 128px;">${media ? contentTypeLabel(media.type) : "Content"}</div>`;
    }

    const source = localAssetUrl(media.url);
    if (media.type === "video") {
      return `<div class="preview" style="width: 170px; height: 128px;"><video src="${escapeAttr(source)}" muted controls></video></div>`;
    }
    if (media.type === "image") {
      return `<div class="preview" style="width: 170px; height: 128px;"><img src="${escapeAttr(source)}" alt="" /></div>`;
    }
    return `<div class="preview" style="width: 170px; height: 128px;">GLB</div>`;
  }

  function bindEvents() {
    document.querySelectorAll("[data-action='login']").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        MockApi.login(new FormData(form).get("email") || "teacher@example.com");
      });
    });

    document.querySelectorAll("[data-action='select-group']").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeGroupId = button.dataset.groupId;
        state.selectedArtworkId = null;
        render();
      });
    });

    document.querySelectorAll("[data-action='show-groups']").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeGroupId = null;
        state.selectedArtworkId = null;
        render();
      });
    });

    document.querySelectorAll("[data-action='select-artwork']").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedArtworkId = button.dataset.artworkId;
        render();
      });
    });

    document.querySelectorAll("[data-action='back-to-list']").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedArtworkId = null;
        render();
      });
    });

    document.querySelectorAll("[data-action='create-artwork']").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        MockApi.createArtwork({
          title: formData.get("title"),
          description: formData.get("description"),
          locale: formData.get("locale"),
          tags: formData.get("tags"),
        });
      });
    });

    document.querySelectorAll("[data-action='update-artwork']").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        MockApi.updateArtwork({
          title: formData.get("title"),
          description: formData.get("description"),
          locale: formData.get("locale"),
          tags: formData.get("tags"),
        });
      });
    });

    document.querySelectorAll("[data-action='upload-trigger']").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const file = formData.get("file");
        const width = Number(formData.get("physicalWidthMeters") || 0.18);
        MockApi.uploadTrigger(file instanceof File && file.name ? file : null, width);
      });
    });

    document.querySelectorAll("[data-action='select-content-type']").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedContentType = button.dataset.contentType;
        render();
      });
    });

    document.querySelectorAll("[data-action='upload-media']").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const file = formData.get("file");
        MockApi.uploadMedia(
          file instanceof File && file.name ? file : null,
          state.selectedContentType,
        );
      });
    });

    document.querySelectorAll("[data-action='toggle-warning-override']").forEach((input) => {
      input.addEventListener("change", () => MockApi.setWarningOverride(input.checked));
    });

    document.querySelectorAll("[data-action='publish']").forEach((button) => {
      button.addEventListener("click", () => MockApi.publish());
    });
  }

  function setAssetStatus(artworkId, target, status, delay) {
    window.setTimeout(() => {
      const artwork = state.artworks.find((item) => item.id === artworkId);
      if (!artwork) return;
      if (target === "trigger" && artwork.trigger) {
        artwork.trigger.processingStatus = status;
      } else {
        const media = artwork.media.find((item) => item.id === target);
        if (media) media.processingStatus = status;
      }
      render();
    }, delay);
  }

  function simulateTriggerResult(artworkId, fileName, delay) {
    window.setTimeout(() => {
      const artwork = state.artworks.find((item) => item.id === artworkId);
      if (!artwork?.trigger) return;
      const mode = resultMode(fileName);
      if (mode === "failed") {
        artwork.trigger.processingStatus = "failed_permanent";
        artwork.trigger.qualityStatus = "failed";
        artwork.trigger.quality = {
          status: "failed",
          score: 0.24,
          featureCount: 88,
          arcoreScore: 24,
          warnings: ["Triggerbild ist nicht publishfähig."],
        };
      } else if (mode === "warning") {
        artwork.trigger.processingStatus = "ready";
        artwork.trigger.qualityStatus = "warning";
        artwork.trigger.quality = {
          status: "warning",
          score: 0.64,
          featureCount: 386,
          arcoreScore: 64,
          warnings: ["ARCore Score liegt im Warnbereich."],
        };
      } else {
        artwork.trigger.processingStatus = "ready";
        artwork.trigger.qualityStatus = "passed";
        artwork.trigger.quality = {
          status: "passed",
          score: 0.83,
          featureCount: 720,
          arcoreScore: 83,
          warnings: [],
        };
      }
      artwork.trigger.image = {
        url: artwork.trigger.previewUrl || "",
        contentType: artwork.trigger.contentType,
        width: 1600,
        height: 1200,
        byteSize: artwork.trigger.byteSize,
        sha256: `mock-${artwork.trigger.id}`,
      };
      render();
    }, delay);
  }

  function simulateMediaResult(artworkId, mediaId, fileName, delay) {
    window.setTimeout(() => {
      const artwork = state.artworks.find((item) => item.id === artworkId);
      const media = artwork?.media.find((item) => item.id === mediaId);
      if (!media) return;
      const mode = resultMode(fileName);
      media.processingStatus = mode === "failed" ? "failed_permanent" : "ready";
      render();
    }, delay);
  }

  function getPublishReadiness(artwork) {
    const group = activeGroup();
    const canPublish = group?.capabilities.includes("can_publish");
    const triggerReady = artwork.trigger?.processingStatus === "ready";
    const content = primaryContent(artwork);
    const contentReady = content?.processingStatus === "ready";
    const qualityPassed = artwork.trigger?.qualityStatus === "passed";
    const qualityWarningAllowed =
      artwork.trigger?.qualityStatus === "warning" && artwork.warningOverride;
    const manifestPending = ["queued", "generating"].includes(
      artwork.publication?.manifestStatus,
    );
    const alreadyPublished =
      artwork.revision.status === "published" &&
      artwork.publication?.manifestStatus === "published";
    const adminDirectPublish =
      ["owner", "admin"].includes(group?.role) &&
      ["draft", "changes_requested", "approved"].includes(artwork.revision.status);
    const revisionAllowed =
      !manifestPending &&
      !alreadyPublished &&
      (artwork.revision.status === "approved" || adminDirectPublish);

    const items = [
      {
        label: "User hat can_publish",
        ok: Boolean(canPublish),
        status: "CanPublishRequired",
      },
      {
        label: "Revision ist publishfähig",
        ok: revisionAllowed,
        status: artwork.revision.status,
      },
      {
        label: "Triggerbild ist ready",
        ok: Boolean(triggerReady),
        status: artwork.trigger?.processingStatus || "upload_pending",
      },
      {
        label: "Triggerqualität ist passed oder freigegeben",
        ok: Boolean(qualityPassed || qualityWarningAllowed),
        status: artwork.trigger?.qualityStatus || "pending",
      },
      {
        label: "Primary-Content ist ready",
        ok: Boolean(contentReady),
        status: content?.processingStatus || "upload_pending",
      },
    ];

    return {
      items,
      blockers: items.filter((item) => !item.ok).map((item) => item.label),
      canPublish: items.every((item) => item.ok),
    };
  }

  function activeGroup() {
    return state.groups.find((group) => group.id === state.activeGroupId);
  }

  function selectedArtwork() {
    return state.artworks.find((artwork) => artwork.id === state.selectedArtworkId);
  }

  function artworksForGroup(groupId) {
    return state.artworks.filter(
      (artwork) => artwork.groupId === groupId && artwork.lifecycleStatus === "active",
    );
  }

  function primaryContent(artwork) {
    return artwork.media.find((item) => item.role === "primary") || null;
  }

  function chip(label, status) {
    return `<span class="chip ${statusClass(status)}">${escapeHtml(label)}</span>`;
  }

  function statusClass(status = "") {
    if (String(status).startsWith("failed")) return "failed-state";
    return String(status)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_");
  }

  function assetPhase(status) {
    if (!status) return "upload_pending";
    if (status === "failed_retryable" || status === "failed_permanent") return "failed";
    return status;
  }

  function qualityLabel(status) {
    return status || "pending";
  }

  function localAssetUrl(url) {
    if (!url) return "";
    return url.replace("https://cdn.example.com/derived/", "../fixtures/cdn-root/derived/");
  }

  function configuredApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const configured =
      params.get("apiBaseUrl") ||
      window.GROUPAR_API_BASE_URL ||
      window.localStorage?.getItem("grouparApiBaseUrl") ||
      defaultApiBaseUrl;

    return String(configured).replace(/\/+$/, "") || defaultApiBaseUrl;
  }

  function contentTypeLabel(type) {
    return (
      {
        image: "Bild",
        video: "Video",
        model3d: "3D-Modell",
      }[type] || type
    );
  }

  function acceptForContentType(type) {
    if (type === "video") return "video/mp4,video/quicktime";
    if (type === "model3d") return ".glb,model/gltf-binary";
    return "image/png,image/jpeg,image/webp";
  }

  function defaultContentType(type) {
    if (type === "video") return "video/mp4";
    if (type === "model3d") return "model/gltf-binary";
    return "image/png";
  }

  function defaultByteSize(type) {
    if (type === "video") return 3483280;
    if (type === "model3d") return 4822112;
    return 122490;
  }

  function resultMode(fileName) {
    const lower = fileName.toLowerCase();
    if (lower.includes("fail") || lower.includes("error")) return "failed";
    if (lower.includes("warn")) return "warning";
    return "ready";
  }

  function splitTags(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function slugify(value) {
    return String(value || "item")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36);
  }

  function uniqueId(prefix) {
    const cleanPrefix = prefix.replace(/_+$/g, "");
    return `${cleanPrefix}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function logEvent(message) {
    state.events.unshift({ at: new Date().toISOString(), message });
    state.events = state.events.slice(0, 20);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  MockApi.bootstrap();
})();
