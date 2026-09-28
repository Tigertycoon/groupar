import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runImageOptimizeJob } from "../dist/jobs/imageOptimize.js";
import { runProcessingJob } from "../dist/jobs/router.js";

const rawBytes = Buffer.from("raw uploaded image bytes");
const optimizedBytes = Buffer.from("processed optimized image bytes");
const thumbnailBytes = Buffer.from("processed thumbnail bytes");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function imageAsset(overrides = {}) {
  return {
    id: "med_fixture_image",
    artwork_revision_id: "rev_fixture",
    artwork_id: "art_fixture",
    org_id: "org_fixture",
    group_id: "grp_fixture",
    asset_type: "image",
    content_role: "primary",
    storage_key_original: "raw/image-source",
    processing_status: "queued",
    processing_report: {},
    metadata: {},
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    jobId: "bull_job_fixture",
    processingJobId: "processing_job_fixture",
    jobType: "image.optimize",
    orgId: "org_fixture",
    groupId: "grp_fixture",
    targetType: "media_asset",
    targetId: "med_fixture_image",
    ...overrides
  };
}

function createDeps({ asset = imageAsset(), tmpDir, storageBytes = rawBytes } = {}) {
  const updates = {
    processingJobs: [],
    mediaAssets: [],
    triggerImages: [],
    derivatives: [],
    uploads: []
  };

  const deps = {
    tmpDir,
    db: {
      async getTriggerImage() {
        throw new Error("unexpected trigger lookup");
      },
      async getMediaAsset() {
        return asset;
      },
      async updateProcessingJob(id, patch) {
        updates.processingJobs.push({ id, patch });
      },
      async updateTriggerImage(id, patch) {
        updates.triggerImages.push({ id, patch });
      },
      async updateMediaAsset(id, patch) {
        updates.mediaAssets.push({ id, patch });
      },
      async upsertAssetDerivative(input) {
        updates.derivatives.push(input);
      }
    },
    storage: {
      async downloadToFile(_storageKey, localPath) {
        await mkdir(dirname(localPath), { recursive: true });
        await writeFile(localPath, storageBytes);
      },
      async uploadFile(localPath, storageKey, contentType) {
        updates.uploads.push({ localPath, storageKey, contentType });
      },
      publicUrl(storageKey) {
        return `https://cdn.test/${storageKey}`;
      }
    },
    imageProcessor: {
      async normalizeTrigger() {
        throw new Error("unexpected trigger normalization");
      },
      async optimizeImage(_inputPath, outputPath) {
        await writeFile(outputPath, optimizedBytes);
      },
      async createThumbnail(_inputPath, outputPath) {
        await writeFile(outputPath, thumbnailBytes);
      }
    }
  };

  return { deps, updates };
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "worker-job-contracts-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await withTempDir(async (tmpDir) => {
  const { deps, updates } = createDeps({ tmpDir });

  await runImageOptimizeJob(payload(), deps);

  const optimized = updates.derivatives.find((derivative) => derivative.kind === "image.optimized_2048");
  const thumbnail = updates.derivatives.find((derivative) => derivative.kind === "image.thumbnail_512");
  assert.ok(optimized, "image.optimize writes optimized derivative");
  assert.ok(thumbnail, "image.optimize writes thumbnail derivative");

  assert.equal(optimized.sha256, sha256(optimizedBytes));
  assert.equal(optimized.bytes, optimizedBytes.length);
  assert.equal(optimized.mime_type, "image/webp");
  assert.equal(optimized.cdn_url, `https://cdn.test/${optimized.storage_key}`);
  assert.notEqual(optimized.sha256, sha256(rawBytes));

  assert.equal(thumbnail.sha256, sha256(thumbnailBytes));
  assert.equal(thumbnail.bytes, thumbnailBytes.length);

  const finalAssetPatch = updates.mediaAssets.at(-1).patch;
  assert.equal(finalAssetPatch.processing_status, "ready");
  assert.equal(finalAssetPatch.storage_key_processed, null);
  assert.equal(finalAssetPatch.cdn_url, null);
  assert.equal(finalAssetPatch.sha256, sha256(rawBytes));
  assert.equal(finalAssetPatch.bytes, rawBytes.length);
});

await withTempDir(async (tmpDir) => {
  const { deps, updates } = createDeps({ asset: imageAsset({ asset_type: "video" }), tmpDir });

  await assert.rejects(() => runImageOptimizeJob(payload(), deps), /non-image media asset/);

  assert.equal(updates.processingJobs.at(-1).patch.status, "failed_permanent");
  assert.equal(updates.mediaAssets.at(-1).patch.processing_status, "failed_permanent");
});

await withTempDir(async (tmpDir) => {
  const { deps, updates } = createDeps({ tmpDir });

  await assert.rejects(
    () => runProcessingJob(payload({ jobType: "manifest.rebuild", targetType: "group", targetId: "grp_fixture" }), deps),
    /manifest worker/
  );

  assert.equal(updates.processingJobs.at(-1).patch.status, "failed_permanent");
});

console.log("Worker job contract smoke checks passed.");
