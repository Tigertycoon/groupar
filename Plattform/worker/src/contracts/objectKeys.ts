import type { DerivativeKind, MediaAssetRow, TriggerImageRow } from "./types.js";

export function triggerDerivativeKey(trigger: TriggerImageRow, kind: DerivativeKind): string {
  const base = `derived/${trigger.org_id}/${trigger.group_id}/${trigger.artwork_id}/${trigger.artwork_revision_id}/trigger/${trigger.id}`;

  switch (kind) {
    case "trigger.normalized":
      return `${base}/trigger_normalized.jpg`;
    case "trigger.thumbnail":
      return `${base}/thumb_512.webp`;
    default:
      throw new Error(`Invalid trigger derivative kind: ${kind}`);
  }
}

export function mediaDerivativeKey(asset: MediaAssetRow, kind: DerivativeKind): string {
  const base = `derived/${asset.org_id}/${asset.group_id}/${asset.artwork_id}/${asset.artwork_revision_id}/media/${asset.id}`;

  switch (kind) {
    case "image.optimized_2048":
      return `${base}/image_2048.webp`;
    case "image.optimized_1024":
      return `${base}/image_1024.webp`;
    case "image.thumbnail_512":
      return `${base}/thumb_512.webp`;
    case "video.mp4_1080p":
      return `${base}/video_1080p.mp4`;
    case "video.thumbnail_512":
      return `${base}/thumb_512.webp`;
    case "model.glb_validated":
      return `${base}/model.glb`;
    default:
      throw new Error(`Invalid media derivative kind: ${kind}`);
  }
}

export function expectedContentTypeForKind(kind: DerivativeKind): string {
  switch (kind) {
    case "trigger.normalized":
      return "image/jpeg";
    case "trigger.thumbnail":
    case "image.optimized_2048":
    case "image.optimized_1024":
    case "image.thumbnail_512":
    case "video.thumbnail_512":
      return "image/webp";
    case "video.mp4_1080p":
      return "video/mp4";
    case "model.glb_validated":
      return "model/gltf-binary";
  }
}

export function cdnUrl(cdnBaseUrl: string, storageKey: string): string {
  return `${cdnBaseUrl.replace(/\/+$/, "")}/${storageKey.replace(/^\/+/, "")}`;
}
