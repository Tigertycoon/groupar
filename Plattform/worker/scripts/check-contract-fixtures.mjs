import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const fixturePath = resolve(process.cwd(), "../fixtures/manifest-test-group-v1.json");
const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
const errors = [];

if (manifest.schemaVersion !== "1.0") {
  errors.push("schemaVersion must be string '1.0'");
}
if (!Array.isArray(manifest.content)) {
  errors.push("manifest.content must be a top-level array");
}
if (!Array.isArray(manifest.targets)) {
  errors.push("manifest.targets must be an array");
}

const contentIds = new Set();
for (const [index, item] of (manifest.content ?? []).entries()) {
  if (!item.contentId) {
    errors.push(`content[${index}] is missing contentId`);
  }
  if ("id" in item) {
    errors.push(`content[${index}] must not use id`);
  }
  contentIds.add(item.contentId);
}

for (const [index, target] of (manifest.targets ?? []).entries()) {
  if ("content" in target) {
    errors.push(`targets[${index}] must not contain nested content[]`);
  }
  if (!Array.isArray(target.contentIds)) {
    errors.push(`targets[${index}].contentIds must be an array`);
    continue;
  }
  if (!target.primaryContentId) {
    errors.push(`targets[${index}] is missing primaryContentId`);
  }
  if (!target.contentIds.includes(target.primaryContentId)) {
    errors.push(`targets[${index}].primaryContentId must be in contentIds[]`);
  }
  for (const contentId of target.contentIds) {
    if (!contentIds.has(contentId)) {
      errors.push(`targets[${index}] references unknown contentId ${contentId}`);
    }
  }
}

if (!Array.isArray(manifest.deletedTargetIds)) {
  errors.push("deletedTargetIds must be an array");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Manifest fixture matches worker-relevant contract checks.");
