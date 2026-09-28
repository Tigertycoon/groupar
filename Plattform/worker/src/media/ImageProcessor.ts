export interface ImageProcessor {
  normalizeTrigger(inputPath: string, outputPath: string): Promise<void>;
  optimizeImage(inputPath: string, outputPath: string, maxLongEdge: number): Promise<void>;
  createThumbnail(inputPath: string, outputPath: string, size: number): Promise<void>;
}

export class SharpImageProcessor implements ImageProcessor {
  async normalizeTrigger(inputPath: string, outputPath: string): Promise<void> {
    const sharp = (await import("sharp")).default;
    await sharp(inputPath)
      .rotate()
      .jpeg({ quality: 90, mozjpeg: true })
      .toColourspace("srgb")
      .toFile(outputPath);
  }

  async optimizeImage(inputPath: string, outputPath: string, maxLongEdge: number): Promise<void> {
    const sharp = (await import("sharp")).default;
    await sharp(inputPath)
      .rotate()
      .resize({ width: maxLongEdge, height: maxLongEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toColourspace("srgb")
      .toFile(outputPath);
  }

  async createThumbnail(inputPath: string, outputPath: string, size: number): Promise<void> {
    const sharp = (await import("sharp")).default;
    await sharp(inputPath)
      .rotate()
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toColourspace("srgb")
      .toFile(outputPath);
  }
}
