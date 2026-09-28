using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using UnityEngine;

namespace GroupAR.ARPlayer
{
    public sealed class ARPlayerTriggerImageCache : MonoBehaviour
    {
        [SerializeField]
        private bool enableDiskCache = true;

        [SerializeField]
        private string cacheFolderName = "GroupAR/TriggerImages";

        [SerializeField]
        private bool verifyCachedBytes;

        public bool TryLoadTriggerTexture(
            ARPlayerTargetDefinition target,
            out Texture2D texture,
            out string status)
        {
            texture = null;

            if (!CanUseCache(target, out status))
            {
                return false;
            }

            string path = GetTriggerImageCachePath(target.Image.Sha256);
            if (!File.Exists(path))
            {
                status = $"Trigger cache miss for '{target.TargetId}'.";
                return false;
            }

            try
            {
                byte[] bytes = File.ReadAllBytes(path);

                if (verifyCachedBytes &&
                    !TryVerifySha256(bytes, target.Image.Sha256, out string verificationMessage))
                {
                    status = $"Trigger cache verification failed for '{target.TargetId}': {verificationMessage}";
                    return false;
                }

                Texture2D cachedTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!ImageConversion.LoadImage(cachedTexture, bytes, false))
                {
                    Destroy(cachedTexture);
                    status = $"Trigger cache entry could not be decoded for '{target.TargetId}'.";
                    return false;
                }

                cachedTexture.name = target.TargetId;
                texture = cachedTexture;
                status = $"Loaded trigger '{target.TargetId}' from cache.";
                return true;
            }
            catch (Exception exception)
            {
                status = $"Trigger cache read failed for '{target.TargetId}': {exception.Message}";
                return false;
            }
        }

        public void StoreTriggerImageBytes(ARPlayerTargetDefinition target, byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0 || !CanUseCache(target, out _))
            {
                return;
            }

            try
            {
                Directory.CreateDirectory(BuildCacheRoot());
                File.WriteAllBytes(GetTriggerImageCachePath(target.Image.Sha256), bytes);

                if (verifyCachedBytes &&
                    !TryVerifySha256(bytes, target.Image.Sha256, out string verificationMessage))
                {
                    Debug.LogWarning($"[GroupAR] Stored trigger bytes do not match image.sha256 for '{target.TargetId}': {verificationMessage}");
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[GroupAR] Trigger cache write failed for '{target.TargetId}': {exception.Message}");
            }
        }

        public string GetTriggerImageCachePath(string sha256)
        {
            return Path.Combine(BuildCacheRoot(), SanitizeFileName(sha256) + ".img");
        }

        public bool HasTriggerImage(string sha256)
        {
            return !string.IsNullOrWhiteSpace(sha256) && File.Exists(GetTriggerImageCachePath(sha256));
        }

        public bool DeleteTriggerImage(string sha256)
        {
            if (string.IsNullOrWhiteSpace(sha256))
            {
                return false;
            }

            string path = GetTriggerImageCachePath(sha256);
            if (!File.Exists(path))
            {
                return false;
            }

            File.Delete(path);
            return true;
        }

        public int DeleteTriggerImages(IEnumerable<ARPlayerTargetDefinition> targets)
        {
            int deletedCount = 0;

            if (targets == null)
            {
                return deletedCount;
            }

            foreach (ARPlayerTargetDefinition target in targets)
            {
                if (target != null && target.Image != null && DeleteTriggerImage(target.Image.Sha256))
                {
                    deletedCount++;
                }
            }

            return deletedCount;
        }

        public static bool TryVerifySha256(byte[] bytes, string expectedSha256, out string message)
        {
            if (bytes == null || bytes.Length == 0)
            {
                message = "No bytes supplied.";
                return false;
            }

            string normalizedExpected = NormalizeSha256(expectedSha256);
            if (string.IsNullOrWhiteSpace(normalizedExpected))
            {
                message = "Expected sha256 is missing.";
                return false;
            }

            string actual = ComputeSha256Hex(bytes);
            if (!string.Equals(actual, normalizedExpected, StringComparison.OrdinalIgnoreCase))
            {
                message = $"Expected {normalizedExpected}, got {actual}.";
                return false;
            }

            message = string.Empty;
            return true;
        }

        public static string ComputeSha256Hex(byte[] bytes)
        {
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(bytes);
                StringBuilder builder = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    builder.Append(hash[i].ToString("x2"));
                }

                return builder.ToString();
            }
        }

        private bool CanUseCache(ARPlayerTargetDefinition target, out string status)
        {
            if (!enableDiskCache)
            {
                status = "Trigger cache disabled.";
                return false;
            }

            if (target == null || target.Image == null || string.IsNullOrWhiteSpace(target.Image.Sha256))
            {
                status = "Trigger cache needs image.sha256.";
                return false;
            }

            status = string.Empty;
            return true;
        }

        private string BuildCacheRoot()
        {
            return Path.Combine(Application.persistentDataPath, cacheFolderName);
        }

        private static string SanitizeFileName(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "missing-sha256";
            }

            foreach (char invalidChar in Path.GetInvalidFileNameChars())
            {
                value = value.Replace(invalidChar, '_');
            }

            return value;
        }

        private static string NormalizeSha256(string sha256)
        {
            if (string.IsNullOrWhiteSpace(sha256))
            {
                return string.Empty;
            }

            string normalized = sha256.Trim();
            if (normalized.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
            {
                normalized = normalized.Substring("sha256:".Length);
            }

            return normalized.Replace("-", string.Empty).ToLowerInvariant();
        }
    }
}
