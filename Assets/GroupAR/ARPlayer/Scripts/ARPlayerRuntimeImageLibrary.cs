using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Networking;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace GroupAR.ARPlayer
{
    public enum ARPlayerPhysicalWidthSeverity
    {
        Ok,
        Warning,
        Invalid
    }

    public sealed class ARPlayerRuntimeImageLibrary : MonoBehaviour
    {
        private const string SupportedSchemaVersion = "1.0";

        [SerializeField]
        private ARSession arSession;

        [SerializeField]
        private ARTrackedImageManager trackedImageManager;

        [SerializeField]
        private ARPlayerTriggerImageCache triggerImageCache;

        [SerializeField]
        private bool loadOnStart = true;

        [SerializeField]
        private bool createGeneratedTargetsWhenEmpty = true;

        [SerializeField]
        private ARPlayerManifest startupManifest = new ARPlayerManifest();

        [SerializeField]
        private List<ARPlayerTargetDefinition> startupTargets = new List<ARPlayerTargetDefinition>();

        [Header("Physical Width Validation (meters)")]
        [Tooltip("Targets whose physicalWidthMeters falls outside this hard range are rejected. contracts.md default 0.03 - 5.00.")]
        [SerializeField]
        private float physicalWidthHardMinMeters = 0.03f;

        [SerializeField]
        private float physicalWidthHardMaxMeters = 5.00f;

        [Tooltip("Targets inside the hard range but outside this range are accepted with a warning. contracts.md default 0.05 - 2.00.")]
        [SerializeField]
        private float physicalWidthWarningMinMeters = 0.05f;

        [SerializeField]
        private float physicalWidthWarningMaxMeters = 2.00f;

        [Header("Debug Events")]
        [SerializeField]
        private UnityEvent<float> onProgressChanged = new UnityEvent<float>();

        [SerializeField]
        private UnityEvent<string> onStatusChanged = new UnityEvent<string>();

        private readonly Dictionary<string, ARPlayerTargetDefinition> targetsById =
            new Dictionary<string, ARPlayerTargetDefinition>();

        private readonly Dictionary<Guid, ARPlayerTargetDefinition> targetsByGuid =
            new Dictionary<Guid, ARPlayerTargetDefinition>();

        private readonly Dictionary<string, ARPlayerContentDefinition> contentById =
            new Dictionary<string, ARPlayerContentDefinition>();

        private readonly HashSet<string> deletedTargetIds = new HashSet<string>();

        private MutableRuntimeReferenceImageLibrary mutableLibrary;
        private Coroutine loadCoroutine;

        public event Action<ARPlayerLoadProgress> ProgressChanged;

        public event Action<ARPlayerTargetDefinition, AddReferenceImageJobStatus> TargetAddCompleted;

        public event Action<ARPlayerTargetDefinition> TargetAddStarted;

        public bool IsReady { get; private set; }

        public string SchemaVersion { get; private set; }

        public int ManifestVersion { get; private set; }

        public string GroupId { get; private set; }

        public IReadOnlyDictionary<string, ARPlayerTargetDefinition> TargetsById => targetsById;

        public IReadOnlyDictionary<string, ARPlayerContentDefinition> ContentById => contentById;

        private IEnumerator Start()
        {
            ResolveSceneReferences();

            if (loadOnStart)
            {
                yield return LoadStartupTargets();
            }
        }

        public void ReloadStartupTargets()
        {
            if (loadCoroutine != null)
            {
                StopCoroutine(loadCoroutine);
            }

            loadCoroutine = StartCoroutine(LoadStartupTargets());
        }

        public IEnumerator LoadStartupTargets()
        {
            if (startupManifest != null && startupManifest.HasTargets)
            {
                yield return LoadManifest(startupManifest);
                yield break;
            }

            if (startupTargets.Count > 0)
            {
                ResetRuntimeState();
                BuildFallbackContentMap(startupTargets);
                yield return LoadTargets(startupTargets);
                yield break;
            }

            if (createGeneratedTargetsWhenEmpty)
            {
                yield return LoadManifest(CreateGeneratedManifest(), true);
            }
            else
            {
                ResetRuntimeState();
                BuildFallbackContentMap(startupTargets);
                yield return LoadTargets(startupTargets);
            }
        }

        public IEnumerator LoadManifest(ARPlayerManifest manifest)
        {
            yield return LoadManifest(manifest, false);
        }

        private IEnumerator LoadManifest(ARPlayerManifest manifest, bool allowGeneratedImages)
        {
            if (manifest == null)
            {
                ReportProgress(0, 0, string.Empty, "No AR manifest supplied.");
                yield break;
            }

            ResetRuntimeState();
            SchemaVersion = manifest.SchemaVersion;
            ManifestVersion = manifest.ManifestVersion;
            GroupId = manifest.Group != null ? manifest.Group.Id : string.Empty;

            if (!string.Equals(SchemaVersion, SupportedSchemaVersion, StringComparison.Ordinal))
            {
                ReportProgress(0, 0, string.Empty, $"Unsupported AR manifest schemaVersion '{SchemaVersion}'. Expected '{SupportedSchemaVersion}'.");
                yield break;
            }

            BuildDeletedTargetSet(manifest.DeletedTargetIds);
            BuildContentMap(manifest.Content);
            yield return LoadTargetsInternal(manifest.Targets, allowGeneratedImages);
        }

        public IEnumerator LoadTargets(IReadOnlyList<ARPlayerTargetDefinition> targets)
        {
            if (targets == null)
            {
                ReportProgress(0, 0, string.Empty, "No AR targets supplied.");
                yield break;
            }

            ResetTargetRecognitionState();

            if (contentById.Count == 0)
            {
                BuildFallbackContentMap(targets);
            }

            yield return LoadTargetsInternal(targets, createGeneratedTargetsWhenEmpty);
        }

        private IEnumerator LoadTargetsInternal(IReadOnlyList<ARPlayerTargetDefinition> targets, bool allowGeneratedImages)
        {
            if (targets == null)
            {
                ReportProgress(0, 0, string.Empty, "No AR targets supplied.");
                yield break;
            }

            yield return EnsureMutableLibrary();

            if (mutableLibrary == null)
            {
                yield break;
            }

            int totalTargets = targets.Count;
            int completedTargets = 0;

            ReportProgress(completedTargets, totalTargets, string.Empty, "Runtime image library ready.");

            for (int i = 0; i < targets.Count; i++)
            {
                ARPlayerTargetDefinition target = targets[i];

                if (target == null)
                {
                    completedTargets++;
                    ReportProgress(completedTargets, totalTargets, string.Empty, "Skipped empty target entry.");
                    continue;
                }

                if (deletedTargetIds.Contains(target.TargetId))
                {
                    completedTargets++;
                    ReportProgress(completedTargets, totalTargets, target.TargetId, $"Skipped deleted target '{target.TargetId}'.");
                    continue;
                }

                yield return AddTarget(target, completedTargets, totalTargets, allowGeneratedImages);
                completedTargets++;
            }

            IsReady = true;
            ReportProgress(completedTargets, totalTargets, string.Empty, "All runtime AR targets processed.");
            loadCoroutine = null;
        }

        public bool TryResolveContentId(string targetId, out string contentId)
        {
            if (!string.IsNullOrEmpty(targetId) && targetsById.TryGetValue(targetId, out ARPlayerTargetDefinition target))
            {
                contentId = target.PrimaryContentId;
                return true;
            }

            contentId = null;
            return false;
        }

        public bool TryResolveContent(string contentId, out ARPlayerContentDefinition content)
        {
            if (!string.IsNullOrEmpty(contentId) && contentById.TryGetValue(contentId, out content))
            {
                return true;
            }

            content = null;
            return false;
        }

        public bool TryResolveTarget(ARTrackedImage trackedImage, out ARPlayerTargetDefinition target)
        {
            target = null;

            if (trackedImage == null)
            {
                return false;
            }

            string targetId = trackedImage.referenceImage.name;
            if (!string.IsNullOrEmpty(targetId) && targetsById.TryGetValue(targetId, out target))
            {
                return true;
            }

            Guid guid = trackedImage.referenceImage.guid;
            return targetsByGuid.TryGetValue(guid, out target);
        }

        public bool TryResolveTargetContent(
            ARTrackedImage trackedImage,
            out ARPlayerTargetDefinition target,
            out ARPlayerContentDefinition content)
        {
            if (TryResolveTarget(trackedImage, out target) &&
                TryResolveContent(target.PrimaryContentId, out content))
            {
                return true;
            }

            content = null;
            return false;
        }

        private IEnumerator EnsureMutableLibrary()
        {
            ResolveSceneReferences();

            if (arSession == null)
            {
                ReportProgress(0, 0, string.Empty, "Missing ARSession in scene.");
                yield break;
            }

            if (trackedImageManager == null)
            {
                ReportProgress(0, 0, string.Empty, "Missing ARTrackedImageManager in scene.");
                yield break;
            }

            if (trackedImageManager.enabled)
            {
                trackedImageManager.enabled = false;
            }

            arSession.Reset();
            yield return null;

            while (ARSession.state == ARSessionState.None || ARSession.state == ARSessionState.CheckingAvailability)
            {
                ReportProgress(0, 0, string.Empty, $"Waiting for AR session availability: {ARSession.state}.");
                yield return null;
            }

            if (ARSession.state == ARSessionState.Unsupported)
            {
                ReportProgress(0, 0, string.Empty, "AR is unsupported on this device.");
                yield break;
            }

            while (ARSession.state < ARSessionState.Ready)
            {
                ReportProgress(0, 0, string.Empty, $"Waiting for AR session readiness: {ARSession.state}.");
                yield return null;
            }

            if (trackedImageManager.descriptor == null)
            {
                ReportProgress(0, 0, string.Empty, "Image tracking descriptor is unavailable.");
                yield break;
            }

            if (!trackedImageManager.descriptor.supportsMutableLibrary)
            {
                ReportProgress(0, 0, string.Empty, "Mutable runtime image libraries are not supported by this provider.");
                yield break;
            }

            RuntimeReferenceImageLibrary runtimeLibrary;
            try
            {
                runtimeLibrary = trackedImageManager.CreateRuntimeLibrary(null);
            }
            catch (Exception exception)
            {
                ReportProgress(0, 0, string.Empty, $"Failed to create runtime image library: {exception.Message}");
                yield break;
            }

            mutableLibrary = runtimeLibrary as MutableRuntimeReferenceImageLibrary;
            if (mutableLibrary == null)
            {
                ReportProgress(0, 0, string.Empty, "Provider returned a non-mutable runtime image library.");
                yield break;
            }

            trackedImageManager.referenceLibrary = mutableLibrary;
            trackedImageManager.enabled = true;
        }

        private void ResetRuntimeState()
        {
            IsReady = false;
            SchemaVersion = string.Empty;
            ManifestVersion = 0;
            GroupId = string.Empty;
            targetsById.Clear();
            targetsByGuid.Clear();
            contentById.Clear();
            deletedTargetIds.Clear();
            mutableLibrary = null;
        }

        private void ResetTargetRecognitionState()
        {
            IsReady = false;
            targetsById.Clear();
            targetsByGuid.Clear();
            deletedTargetIds.Clear();
            mutableLibrary = null;
        }

        private void BuildDeletedTargetSet(IReadOnlyList<string> manifestDeletedTargetIds)
        {
            deletedTargetIds.Clear();

            if (manifestDeletedTargetIds == null)
            {
                return;
            }

            for (int i = 0; i < manifestDeletedTargetIds.Count; i++)
            {
                string targetId = manifestDeletedTargetIds[i];
                if (!string.IsNullOrWhiteSpace(targetId))
                {
                    deletedTargetIds.Add(targetId);
                }
            }
        }

        private IEnumerator AddTarget(
            ARPlayerTargetDefinition target,
            int completedTargets,
            int totalTargets,
            bool allowGeneratedImage)
        {
            TargetAddStarted?.Invoke(target);

            if (!target.TryValidate(out string validationMessage, allowGeneratedImage))
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, validationMessage);
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorInvalidImage);
                yield break;
            }

            ARPlayerPhysicalWidthSeverity widthSeverity = EvaluatePhysicalWidth(target, out string widthMessage);
            if (widthSeverity == ARPlayerPhysicalWidthSeverity.Invalid)
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, widthMessage);
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorInvalidImage);
                yield break;
            }

            if (widthSeverity == ARPlayerPhysicalWidthSeverity.Warning)
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, widthMessage);
            }

            for (int i = 0; i < target.ContentIds.Count; i++)
            {
                string contentId = target.ContentIds[i];
                if (string.IsNullOrWhiteSpace(contentId))
                {
                    continue;
                }

                if (!contentById.ContainsKey(contentId))
                {
                    ReportProgress(completedTargets, totalTargets, target.TargetId, $"Content '{contentId}' is missing for target '{target.TargetId}'.");
                    TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorInvalidImage);
                    yield break;
                }
            }

            if (!contentById.ContainsKey(target.PrimaryContentId))
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, $"Content '{target.PrimaryContentId}' is missing for target '{target.TargetId}'.");
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorInvalidImage);
                yield break;
            }

            if (targetsById.ContainsKey(target.TargetId))
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, "Target was already added to the local map.");
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorDuplicateImage);
                yield break;
            }

            ReportProgress(completedTargets, totalTargets, target.TargetId, "Loading target image.");

            Texture2D texture = null;
            UnityWebRequest request = null;

            if (target.HasTriggerImageUrl)
            {
                if (triggerImageCache != null &&
                    triggerImageCache.TryLoadTriggerTexture(target, out texture, out string cacheStatus))
                {
                    ReportProgress(completedTargets, totalTargets, target.TargetId, cacheStatus);
                }

                if (texture == null)
                {
                    request = UnityWebRequestTexture.GetTexture(target.Image.Url, false);
                    yield return request.SendWebRequest();

                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        ReportProgress(completedTargets, totalTargets, target.TargetId, $"Image download failed: {request.error}");
                        request.Dispose();
                        TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorUnknown);
                        yield break;
                    }

                    texture = DownloadHandlerTexture.GetContent(request);
                    triggerImageCache?.StoreTriggerImageBytes(target, request.downloadHandler?.data);
                }
            }
            else
            {
                texture = CreateGeneratedTargetTexture(target);
            }

            if (texture == null)
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, "No readable texture was produced for target.");
                request?.Dispose();
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorUnknown);
                yield break;
            }

            if (!texture.isReadable)
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, "Texture must be readable for runtime image libraries.");
                request?.Dispose();
                Destroy(texture);
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorInvalidImage);
                yield break;
            }

            if (!mutableLibrary.IsTextureFormatSupported(texture.format))
            {
                Texture2D convertedTexture = CopyTexture(texture, TextureFormat.RGBA32);
                if (request == null)
                {
                    Destroy(texture);
                }

                texture = convertedTexture;
            }

            AddReferenceImageJobState addJobState;

            try
            {
                float? widthInMeters = target.PhysicalWidthMeters > 0f
                    ? target.PhysicalWidthMeters
                    : (float?) null;

                addJobState = mutableLibrary.ScheduleAddImageWithValidationJob(
                    texture,
                    target.TargetId,
                    widthInMeters);
            }
            catch (Exception exception)
            {
                ReportProgress(completedTargets, totalTargets, target.TargetId, $"Scheduling add-image job failed: {exception.Message}");
                request?.Dispose();
                Destroy(texture);
                TargetAddCompleted?.Invoke(target, AddReferenceImageJobStatus.ErrorUnknown);
                yield break;
            }

            request?.Dispose();
            Destroy(texture);

            ReportProgress(completedTargets, totalTargets, target.TargetId, "Adding image to mutable library.");

            while (!addJobState.status.IsComplete())
            {
                yield return null;
            }

            addJobState.jobHandle.Complete();

            AddReferenceImageJobStatus status = addJobState.status;
            if (status.IsSuccess())
            {
                targetsById[target.TargetId] = target;
                TryCacheRuntimeGuid(target);
                ReportProgress(completedTargets + 1, totalTargets, target.TargetId, $"Target added: {target.TargetId} -> {target.PrimaryContentId}.");
            }
            else
            {
                ReportProgress(completedTargets + 1, totalTargets, target.TargetId, $"Target add failed: {status}.");
            }

            TargetAddCompleted?.Invoke(target, status);
        }

        private ARPlayerPhysicalWidthSeverity EvaluatePhysicalWidth(ARPlayerTargetDefinition target, out string message)
        {
            float width = target.PhysicalWidthMeters;

            if (width < physicalWidthHardMinMeters || width > physicalWidthHardMaxMeters)
            {
                message = $"Physical width {width:0.###} m for target '{target.TargetId}' is outside the allowed range " +
                    $"[{physicalWidthHardMinMeters:0.##}, {physicalWidthHardMaxMeters:0.##}] m. Target rejected.";
                return ARPlayerPhysicalWidthSeverity.Invalid;
            }

            if (width < physicalWidthWarningMinMeters || width > physicalWidthWarningMaxMeters)
            {
                message = $"Physical width {width:0.###} m for target '{target.TargetId}' is outside the recommended range " +
                    $"[{physicalWidthWarningMinMeters:0.##}, {physicalWidthWarningMaxMeters:0.##}] m. Tracking scale may be unreliable.";
                return ARPlayerPhysicalWidthSeverity.Warning;
            }

            message = string.Empty;
            return ARPlayerPhysicalWidthSeverity.Ok;
        }

        private void BuildContentMap(IReadOnlyList<ARPlayerContentDefinition> content)
        {
            contentById.Clear();

            if (content == null)
            {
                return;
            }

            for (int i = 0; i < content.Count; i++)
            {
                ARPlayerContentDefinition item = content[i];
                if (item == null)
                {
                    continue;
                }

                if (!item.TryValidate(out string validationMessage))
                {
                    ReportProgress(0, 0, item.ContentId, validationMessage);
                    continue;
                }

                if (contentById.ContainsKey(item.ContentId))
                {
                    ReportProgress(0, 0, item.ContentId, $"Duplicate content ID '{item.ContentId}' ignored.");
                    continue;
                }

                contentById.Add(item.ContentId, item);
            }
        }

        private void BuildFallbackContentMap(IReadOnlyList<ARPlayerTargetDefinition> targets)
        {
            contentById.Clear();

            if (targets == null)
            {
                return;
            }

            for (int i = 0; i < targets.Count; i++)
            {
                ARPlayerTargetDefinition target = targets[i];
                if (target == null)
                {
                    continue;
                }

                if (target.ContentIds == null || target.ContentIds.Count == 0)
                {
                    AddFallbackContent(target.PrimaryContentId, target.DebugColor);
                    continue;
                }

                for (int contentIndex = 0; contentIndex < target.ContentIds.Count; contentIndex++)
                {
                    AddFallbackContent(target.ContentIds[contentIndex], target.DebugColor);
                }
            }
        }

        private void AddFallbackContent(string contentId, Color debugColor)
        {
            if (string.IsNullOrWhiteSpace(contentId) || contentById.ContainsKey(contentId))
            {
                return;
            }

            contentById.Add(
                contentId,
                new ARPlayerContentDefinition(
                    contentId,
                    "debug",
                    "primary",
                    string.Empty,
                    string.Empty,
                    0,
                    string.Empty,
                    new ARPlayerContentMetadata(),
                    debugColor));
        }

        private void TryCacheRuntimeGuid(ARPlayerTargetDefinition target)
        {
            if (mutableLibrary == null)
            {
                return;
            }

            for (int i = 0; i < mutableLibrary.count; i++)
            {
                XRReferenceImage image = mutableLibrary[i];
                if (image.name == target.TargetId)
                {
                    targetsByGuid[image.guid] = target;
                    return;
                }
            }
        }

        private void ResolveSceneReferences()
        {
            if (arSession == null)
            {
                arSession = FindFirstObjectByType<ARSession>();
            }

            if (trackedImageManager == null)
            {
                trackedImageManager = FindFirstObjectByType<ARTrackedImageManager>();
            }

            if (triggerImageCache == null)
            {
                triggerImageCache = FindFirstObjectByType<ARPlayerTriggerImageCache>();
            }
        }

        private void ReportProgress(int completedTargets, int totalTargets, string targetId, string message)
        {
            ARPlayerLoadProgress progress = new ARPlayerLoadProgress(completedTargets, totalTargets, targetId, message);
            ProgressChanged?.Invoke(progress);
            onProgressChanged.Invoke(progress.Normalized);
            onStatusChanged.Invoke(message);
            Debug.Log($"[GroupAR] {message}");
        }

        private static ARPlayerManifest CreateGeneratedManifest()
        {
            List<ARPlayerTargetDefinition> targets = new List<ARPlayerTargetDefinition>
            {
                new ARPlayerTargetDefinition(
                    "target.demo.school.poster",
                    "content.demo.school.poster",
                    string.Empty,
                    "generated:target.demo.school.poster",
                    0.14f,
                    new Color(0.08f, 0.48f, 0.9f, 1f)),
                new ARPlayerTargetDefinition(
                    "target.demo.lab.card",
                    "content.demo.lab.card",
                    string.Empty,
                    "generated:target.demo.lab.card",
                    0.10f,
                    new Color(0.9f, 0.35f, 0.12f, 1f))
            };

            List<ARPlayerContentDefinition> content = new List<ARPlayerContentDefinition>
            {
                new ARPlayerContentDefinition(
                    "content.demo.school.poster",
                    "debug",
                    "primary",
                    string.Empty,
                    string.Empty,
                    0,
                    string.Empty,
                    new ARPlayerContentMetadata(),
                    new Color(0.08f, 0.48f, 0.9f, 1f)),
                new ARPlayerContentDefinition(
                    "content.demo.lab.card",
                    "debug",
                    "primary",
                    string.Empty,
                    string.Empty,
                    0,
                    string.Empty,
                    new ARPlayerContentMetadata(),
                    new Color(0.9f, 0.35f, 0.12f, 1f))
            };

            return new ARPlayerManifest(targets, content);
        }

        private static Texture2D CreateGeneratedTargetTexture(ARPlayerTargetDefinition target)
        {
            const int size = 512;
            Texture2D texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            Color32[] pixels = new Color32[size * size];
            Color32 background = new Color32(246, 248, 250, 255);
            Color32 dark = new Color32(18, 24, 31, 255);
            Color32 accent = target.DebugColor;

            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = background;
            }

            int seed = StableHash(target.TargetId + target.PrimaryContentId);
            System.Random random = new System.Random(seed);

            DrawRect(pixels, size, 0, 0, size, 24, dark);
            DrawRect(pixels, size, 0, size - 24, size, 24, dark);
            DrawRect(pixels, size, 0, 0, 24, size, dark);
            DrawRect(pixels, size, size - 24, 0, 24, size, dark);

            for (int i = 0; i < 72; i++)
            {
                int x = random.Next(34, size - 82);
                int y = random.Next(34, size - 82);
                int w = random.Next(16, 74);
                int h = random.Next(16, 74);
                Color32 color = i % 3 == 0 ? accent : (i % 3 == 1 ? dark : new Color32(255, 255, 255, 255));
                DrawRect(pixels, size, x, y, w, h, color);
            }

            for (int i = 0; i < 28; i++)
            {
                int x0 = random.Next(32, size - 32);
                int y0 = random.Next(32, size - 32);
                int x1 = random.Next(32, size - 32);
                int y1 = random.Next(32, size - 32);
                DrawLine(pixels, size, x0, y0, x1, y1, i % 2 == 0 ? dark : accent);
            }

            texture.SetPixels32(pixels);
            texture.Apply(false, false);
            texture.name = target.TargetId;
            return texture;
        }

        private static Texture2D CopyTexture(Texture2D source, TextureFormat format)
        {
            Texture2D copy = new Texture2D(source.width, source.height, format, false);
            copy.SetPixels32(source.GetPixels32());
            copy.Apply(false, false);
            copy.name = source.name;
            return copy;
        }

        private static void DrawRect(Color32[] pixels, int textureSize, int x, int y, int width, int height, Color32 color)
        {
            int xMin = Mathf.Clamp(x, 0, textureSize - 1);
            int yMin = Mathf.Clamp(y, 0, textureSize - 1);
            int xMax = Mathf.Clamp(x + width, 0, textureSize);
            int yMax = Mathf.Clamp(y + height, 0, textureSize);

            for (int py = yMin; py < yMax; py++)
            {
                int row = py * textureSize;
                for (int px = xMin; px < xMax; px++)
                {
                    pixels[row + px] = color;
                }
            }
        }

        private static void DrawLine(Color32[] pixels, int textureSize, int x0, int y0, int x1, int y1, Color32 color)
        {
            int dx = Mathf.Abs(x1 - x0);
            int dy = -Mathf.Abs(y1 - y0);
            int sx = x0 < x1 ? 1 : -1;
            int sy = y0 < y1 ? 1 : -1;
            int error = dx + dy;

            while (true)
            {
                DrawRect(pixels, textureSize, x0 - 2, y0 - 2, 5, 5, color);

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
    }
}
