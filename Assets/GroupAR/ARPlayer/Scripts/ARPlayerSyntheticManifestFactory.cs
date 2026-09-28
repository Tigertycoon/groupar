using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace GroupAR.ARPlayer
{
    public static class ARPlayerSyntheticManifestFactory
    {
        public static readonly int[] SupportedTargetCounts = { 25, 50, 100, 200 };

        private const int TextureSize = 512;
        private const float DefaultPhysicalWidthMeters = 0.18f;
        private const string SyntheticRootFolder = "GroupAR/SyntheticTargets";

        public static ARPlayerManifest CreateManifest(
            int targetCount,
            int seed,
            out ARPlayerSyntheticManifestBuildInfo buildInfo)
        {
            if (!IsSupportedTargetCount(targetCount))
            {
                Debug.LogWarning($"[GroupAR][perf] Synthetic target count {targetCount} is outside the planned spike set 25/50/100/200.");
            }

            string rootFolder = BuildRootFolder(targetCount, seed);
            Directory.CreateDirectory(rootFolder);

            List<ARPlayerTargetDefinition> targets = new List<ARPlayerTargetDefinition>(targetCount);
            List<ARPlayerContentDefinition> content = new List<ARPlayerContentDefinition>(targetCount);
            List<string> sourceImagePaths = new List<string>(targetCount);

            for (int i = 0; i < targetCount; i++)
            {
                string index = (i + 1).ToString("000");
                string targetId = $"perf.synthetic.target.{targetCount}.{index}";
                string triggerImageId = $"perf.synthetic.trigger.{targetCount}.{index}";
                string contentId = $"perf.synthetic.content.{targetCount}.{index}";
                Color debugColor = BuildDebugColor(i, targetCount);

                byte[] imageBytes = BuildTriggerPngBytes(targetId, seed, i, debugColor);
                string sha256 = ARPlayerTriggerImageCache.ComputeSha256Hex(imageBytes);
                string filePath = Path.Combine(rootFolder, targetId + ".png");
                File.WriteAllBytes(filePath, imageBytes);
                sourceImagePaths.Add(filePath);

                targets.Add(new ARPlayerTargetDefinition(
                    targetId,
                    triggerImageId,
                    contentId,
                    new Uri(filePath).AbsoluteUri,
                    sha256,
                    "image/png",
                    TextureSize,
                    TextureSize,
                    imageBytes.LongLength,
                    BuildPhysicalWidthMeters(i),
                    debugColor));

                content.Add(new ARPlayerContentDefinition(
                    contentId,
                    "debug",
                    "primary",
                    string.Empty,
                    "application/x-groupar-debug",
                    0,
                    ARPlayerTriggerImageCache.ComputeSha256Hex(System.Text.Encoding.UTF8.GetBytes(contentId)),
                    new ARPlayerContentMetadata(),
                    debugColor));
            }

            ARPlayerManifest manifest = new ARPlayerManifest(
                9000 + targetCount,
                "grp_perf_spike",
                "GroupAR Performance Spike",
                targets,
                content);

            buildInfo = new ARPlayerSyntheticManifestBuildInfo(
                targetCount,
                seed,
                rootFolder,
                sourceImagePaths);
            return manifest;
        }

        public static bool IsSupportedTargetCount(int targetCount)
        {
            for (int i = 0; i < SupportedTargetCounts.Length; i++)
            {
                if (SupportedTargetCounts[i] == targetCount)
                {
                    return true;
                }
            }

            return false;
        }

        private static float BuildPhysicalWidthMeters(int index)
        {
            return DefaultPhysicalWidthMeters + (index % 5) * 0.005f;
        }

        private static string BuildRootFolder(int targetCount, int seed)
        {
            return Path.Combine(
                Application.persistentDataPath,
                SyntheticRootFolder,
                $"seed-{seed}",
                $"targets-{targetCount}");
        }

        private static byte[] BuildTriggerPngBytes(
            string targetId,
            int seed,
            int index,
            Color debugColor)
        {
            Texture2D texture = new Texture2D(TextureSize, TextureSize, TextureFormat.RGBA32, false);
            Color32[] pixels = new Color32[TextureSize * TextureSize];
            Color32 background = new Color32(246, 248, 250, 255);
            Color32 dark = new Color32(18, 24, 31, 255);
            Color32 accent = debugColor;

            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = background;
            }

            System.Random random = new System.Random(StableHash($"{seed}:{targetId}:{index}"));

            DrawRect(pixels, 0, 0, TextureSize, 20, dark);
            DrawRect(pixels, 0, TextureSize - 20, TextureSize, 20, dark);
            DrawRect(pixels, 0, 0, 20, TextureSize, dark);
            DrawRect(pixels, TextureSize - 20, 0, 20, TextureSize, dark);

            for (int i = 0; i < 96; i++)
            {
                int x = random.Next(30, TextureSize - 70);
                int y = random.Next(30, TextureSize - 70);
                int width = random.Next(10, 58);
                int height = random.Next(10, 58);
                Color32 color = i % 4 == 0
                    ? accent
                    : (i % 4 == 1 ? dark : new Color32((byte) random.Next(80, 255), (byte) random.Next(80, 255), (byte) random.Next(80, 255), 255));
                DrawRect(pixels, x, y, width, height, color);
            }

            for (int i = 0; i < 36; i++)
            {
                DrawLine(
                    pixels,
                    random.Next(24, TextureSize - 24),
                    random.Next(24, TextureSize - 24),
                    random.Next(24, TextureSize - 24),
                    random.Next(24, TextureSize - 24),
                    i % 2 == 0 ? dark : accent);
            }

            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            byte[] bytes = texture.EncodeToPNG();
            DestroyTexture(texture);
            return bytes;
        }

        private static Color BuildDebugColor(int index, int targetCount)
        {
            float hue = Mathf.Repeat((index * 0.6180339887f) + (targetCount * 0.013f), 1f);
            return Color.HSVToRGB(hue, 0.72f, 0.92f);
        }

        private static void DrawRect(Color32[] pixels, int x, int y, int width, int height, Color32 color)
        {
            int xMin = Mathf.Clamp(x, 0, TextureSize - 1);
            int yMin = Mathf.Clamp(y, 0, TextureSize - 1);
            int xMax = Mathf.Clamp(x + width, 0, TextureSize);
            int yMax = Mathf.Clamp(y + height, 0, TextureSize);

            for (int py = yMin; py < yMax; py++)
            {
                int row = py * TextureSize;
                for (int px = xMin; px < xMax; px++)
                {
                    pixels[row + px] = color;
                }
            }
        }

        private static void DrawLine(Color32[] pixels, int x0, int y0, int x1, int y1, Color32 color)
        {
            int dx = Mathf.Abs(x1 - x0);
            int dy = -Mathf.Abs(y1 - y0);
            int sx = x0 < x1 ? 1 : -1;
            int sy = y0 < y1 ? 1 : -1;
            int error = dx + dy;

            while (true)
            {
                DrawRect(pixels, x0 - 2, y0 - 2, 5, 5, color);

                if (x0 == x1 && y0 == y1)
                {
                    break;
                }

                int e2 = 2 * error;
                if (e2 >= dy)
                {
                    error += dy;
                    x0 += sx;
                }

                if (e2 <= dx)
                {
                    error += dx;
                    y0 += sy;
                }
            }
        }

        private static int StableHash(string value)
        {
            unchecked
            {
                int hash = 23;
                for (int i = 0; i < value.Length; i++)
                {
                    hash = hash * 31 + value[i];
                }

                return hash;
            }
        }

        private static void DestroyTexture(Texture2D texture)
        {
            if (Application.isPlaying)
            {
                UnityEngine.Object.Destroy(texture);
            }
            else
            {
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }
    }

    public readonly struct ARPlayerSyntheticManifestBuildInfo
    {
        public ARPlayerSyntheticManifestBuildInfo(
            int targetCount,
            int seed,
            string rootFolder,
            IReadOnlyList<string> sourceImagePaths)
        {
            TargetCount = targetCount;
            Seed = seed;
            RootFolder = rootFolder;
            SourceImagePaths = sourceImagePaths;
        }

        public int TargetCount { get; }

        public int Seed { get; }

        public string RootFolder { get; }

        public IReadOnlyList<string> SourceImagePaths { get; }
    }
}
