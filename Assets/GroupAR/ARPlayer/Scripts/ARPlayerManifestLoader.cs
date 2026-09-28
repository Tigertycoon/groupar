using System;
using System.Collections;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;

namespace GroupAR.ARPlayer
{
    public sealed class ARPlayerManifestLoader : MonoBehaviour
    {
        [SerializeField]
        private ARPlayerRuntimeImageLibrary runtimeImageLibrary;

        [SerializeField]
        private string manifestUrl;

        [SerializeField]
        private bool loadOnStart;

        [SerializeField]
        private bool useEtagCache = true;

        [SerializeField]
        private string etagPlayerPrefsPrefix = "GroupAR.Manifest.ETag.";

        [SerializeField]
        private bool useManifestJsonCache = true;

        [SerializeField]
        private string manifestCacheFolderName = "GroupAR/Manifests";

        [SerializeField]
        private UnityEvent<string> onStatusChanged = new UnityEvent<string>();

        private Coroutine loadCoroutine;

        public event Action<string> StatusChanged;

        public bool IsLoading { get; private set; }

        public string ManifestUrl
        {
            get => manifestUrl;
            set => manifestUrl = value;
        }

        public string LastETag { get; private set; }

        private void Awake()
        {
            ResolveSceneReferences();
        }

        private IEnumerator Start()
        {
            ResolveSceneReferences();

            if (loadOnStart)
            {
                yield return LoadManifestFromConfiguredUrl();
            }
        }

        [ContextMenu("Load Configured Manifest")]
        public void LoadConfiguredManifest()
        {
            if (loadCoroutine != null)
            {
                StopCoroutine(loadCoroutine);
            }

            loadCoroutine = StartCoroutine(LoadManifestFromConfiguredUrl());
        }

        public IEnumerator LoadManifestFromConfiguredUrl()
        {
            yield return LoadManifest(manifestUrl);
        }

        public IEnumerator LoadManifest(string url)
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                ReportStatus("Manifest URL is missing.");
                yield break;
            }

            ResolveSceneReferences();

            if (runtimeImageLibrary == null)
            {
                ReportStatus("Missing ARPlayerRuntimeImageLibrary in scene.");
                yield break;
            }

            IsLoading = true;
            yield return LoadManifestInternal(url, false);
            IsLoading = false;
            loadCoroutine = null;
        }

        private IEnumerator LoadManifestInternal(string url, bool forceDownload)
        {
            ReportStatus(forceDownload ? "Downloading full AR manifest." : "Loading AR manifest.");

            bool hasCachedManifest = TryLoadCachedManifestJson(url, out string cachedManifestJson, out _);

            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.SetRequestHeader("Accept", "application/json");

                string cachedEtag = GetCachedEtag(url);
                if (!forceDownload &&
                    useEtagCache &&
                    hasCachedManifest &&
                    !string.IsNullOrWhiteSpace(cachedEtag))
                {
                    request.SetRequestHeader("If-None-Match", cachedEtag);
                }

                yield return request.SendWebRequest();

                if (request.responseCode == 304)
                {
                    string cachedParseMessage = string.Empty;
                    if (hasCachedManifest &&
                        TryDeserializeManifest(cachedManifestJson, out ARPlayerManifest cachedManifest, out cachedParseMessage))
                    {
                        LastETag = cachedEtag;
                        ReportStatus($"Manifest not modified. Applying cached manifest v{cachedManifest.ManifestVersion}.");
                        yield return runtimeImageLibrary.LoadManifest(cachedManifest);
                        ReportStatus($"Cached manifest v{cachedManifest.ManifestVersion} applied.");
                        yield break;
                    }

                    ReportStatus("Manifest returned 304 but local JSON cache is missing or invalid. Retrying full download.");
                    if (!string.IsNullOrWhiteSpace(cachedParseMessage))
                    {
                        Debug.LogWarning($"[GroupAR] Cached manifest parse failed after 304: {cachedParseMessage}");
                    }

                    yield return LoadManifestInternal(url, true);
                    yield break;
                }

                if (request.result != UnityWebRequest.Result.Success)
                {
                    ReportStatus($"Manifest download failed: {request.error}");
                    yield break;
                }

                string json = request.downloadHandler?.text;
                if (string.IsNullOrWhiteSpace(json))
                {
                    ReportStatus("Manifest response was empty.");
                    yield break;
                }

                if (!TryDeserializeManifest(json, out ARPlayerManifest manifest, out string parseMessage))
                {
                    ReportStatus($"Manifest JSON parse failed: {parseMessage}");
                    yield break;
                }

                SaveCachedManifestJson(url, json);

                string responseEtag = request.GetResponseHeader("ETag");
                if (!string.IsNullOrWhiteSpace(responseEtag))
                {
                    LastETag = responseEtag;
                    SaveCachedEtag(url, responseEtag);
                }

                ReportStatus($"Manifest v{manifest.ManifestVersion} loaded. Building AR targets.");
                yield return runtimeImageLibrary.LoadManifest(manifest);
                ReportStatus($"Manifest v{manifest.ManifestVersion} applied.");
            }
        }

        private void ResolveSceneReferences()
        {
            if (runtimeImageLibrary == null)
            {
                runtimeImageLibrary = FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            }
        }

        private string GetCachedEtag(string url)
        {
            return useEtagCache
                ? PlayerPrefs.GetString(BuildEtagKey(url), string.Empty)
                : string.Empty;
        }

        private void SaveCachedEtag(string url, string etag)
        {
            if (!useEtagCache)
            {
                return;
            }

            PlayerPrefs.SetString(BuildEtagKey(url), etag);
            PlayerPrefs.Save();
        }

        private bool TryLoadCachedManifestJson(string url, out string json, out string status)
        {
            json = null;

            if (!useManifestJsonCache)
            {
                status = "Manifest JSON cache disabled.";
                return false;
            }

            string path = BuildManifestCachePath(url);
            if (!File.Exists(path))
            {
                status = "Manifest JSON cache miss.";
                return false;
            }

            try
            {
                json = File.ReadAllText(path, Encoding.UTF8);
                bool hasJson = !string.IsNullOrWhiteSpace(json);
                status = hasJson ? "Manifest JSON cache hit." : "Manifest JSON cache entry is empty.";
                return hasJson;
            }
            catch (Exception exception)
            {
                status = $"Manifest JSON cache read failed: {exception.Message}";
                return false;
            }
        }

        private void SaveCachedManifestJson(string url, string json)
        {
            if (!useManifestJsonCache || string.IsNullOrWhiteSpace(json))
            {
                return;
            }

            try
            {
                Directory.CreateDirectory(BuildManifestCacheRoot());
                File.WriteAllText(BuildManifestCachePath(url), json, Encoding.UTF8);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[GroupAR] Manifest JSON cache write failed: {exception.Message}");
            }
        }

        private static bool TryDeserializeManifest(
            string json,
            out ARPlayerManifest manifest,
            out string message)
        {
            manifest = null;

            if (string.IsNullOrWhiteSpace(json))
            {
                message = "Manifest JSON is empty.";
                return false;
            }

            try
            {
                manifest = JsonUtility.FromJson<ARPlayerManifest>(json);
                if (manifest == null)
                {
                    message = "Manifest JSON produced no manifest object.";
                    return false;
                }

                message = string.Empty;
                return true;
            }
            catch (Exception exception)
            {
                message = exception.Message;
                return false;
            }
        }

        private string BuildManifestCachePath(string url)
        {
            return Path.Combine(BuildManifestCacheRoot(), StableHash(url).ToString("x8") + ".json");
        }

        private string BuildManifestCacheRoot()
        {
            return Path.Combine(Application.persistentDataPath, manifestCacheFolderName);
        }

        private string BuildEtagKey(string url)
        {
            return etagPlayerPrefsPrefix + StableHash(url).ToString("x8");
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

        private void ReportStatus(string message)
        {
            StatusChanged?.Invoke(message);
            onStatusChanged.Invoke(message);
            Debug.Log($"[GroupAR] {message}");
        }
    }
}
