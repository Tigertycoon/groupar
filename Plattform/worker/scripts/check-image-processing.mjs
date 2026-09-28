import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import sharp from "sharp";
import { SharpImageProcessor } from "../dist/media/ImageProcessor.js";

// Avoid libvips retaining input file handles during Windows fixture cleanup.
sharp.cache(false);
const manifest = JSON.parse(await readFile(new URL("../../fixtures/manifest-test-group-local.json", import.meta.url)));
const input = new URL("../../fixtures/cdn-root" + new URL(manifest.targets[0].image.url).pathname, import.meta.url);
const { fileURLToPath } = await import("node:url");
const temp = await mkdtemp(join(tmpdir(), "groupar-image-check-"));
try {
  const processor = new SharpImageProcessor();
  const source = fileURLToPath(input);
  const normalized = join(temp, "trigger.jpg");
  const optimized = join(temp, "image.webp");
  const thumbnail = join(temp, "thumb.webp");
  await processor.normalizeTrigger(source, normalized);
  await processor.optimizeImage(source, optimized, 128);
  await processor.createThumbnail(source, thumbnail, 64);
  for (const [file, format, size] of [[normalized, "jpeg", 256], [optimized, "webp", 128], [thumbnail, "webp", 64]]) {
    const metadata = await sharp(await readFile(file)).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.ok((await readFile(file)).length > 0);
  }
  console.log("Real Sharp processing: JPEG normalization, WebP resize and thumbnail passed.");
} finally {
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
