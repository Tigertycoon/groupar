import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { FileProbe } from "../contracts/types.js";

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });
  return hash.digest("hex");
}

export async function probeFile(path: string): Promise<FileProbe> {
  const [fileStat, sha256, header] = await Promise.all([
    stat(path),
    sha256File(path),
    readFile(path).then((buffer) => buffer.subarray(0, 4096))
  ]);
  const contentType = sniffContentType(header, path);
  const dimensions = readImageDimensions(header, contentType);

  return {
    path,
    bytes: fileStat.size,
    sha256,
    contentType,
    ...dimensions
  };
}

export function sniffContentType(header: Buffer, path = ""): string {
  if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (header.subarray(4, 8).toString("ascii") === "ftyp") {
    return "video/mp4";
  }
  if (header.subarray(0, 4).toString("ascii") === "glTF") {
    return "model/gltf-binary";
  }

  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".glb":
      return "model/gltf-binary";
    default:
      return "application/octet-stream";
  }
}

export function readImageDimensions(header: Buffer, contentType: string): { width?: number; height?: number } {
  if (contentType === "image/png" && header.length >= 24) {
    return {
      width: header.readUInt32BE(16),
      height: header.readUInt32BE(20)
    };
  }

  if (contentType === "image/jpeg") {
    return readJpegDimensions(header);
  }

  if (contentType === "image/webp") {
    return readWebpDimensions(header);
  }

  return {};
}

function readJpegDimensions(buffer: Buffer): { width?: number; height?: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame && offset + 8 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return {};
}

function readWebpDimensions(buffer: Buffer): { width?: number; height?: number } {
  const format = buffer.subarray(12, 16).toString("ascii");

  if (format === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (format === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }

  if (format === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  return {};
}
