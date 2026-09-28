using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;
using UnityEngine.XR.ARSubsystems;

namespace GroupAR.ARPlayer
{
    public sealed class ARPlayerPerformanceProbe : MonoBehaviour
    {
        [Serializable]
        public sealed class ResultUnityEvent : UnityEvent<string>
        {
        }

        [SerializeField]
        private ARPlayerRuntimeImageLibrary runtimeImageLibrary;

        [SerializeField]
        private ARPlayerTelemetry telemetry;

        [SerializeField]
        private ARPlayerTriggerImageCache triggerImageCache;

        [SerializeField]
        private Text outputText;

        [SerializeField]
        private int targetCount = 25;

        [SerializeField]
        private int seed = 424242;

        [SerializeField]
        private bool runOnStart;

        [SerializeField]
        private bool runWarmAfterCold = true;

        [SerializeField]
        private bool includePerTargetCsv = true;

        [SerializeField]
        private float timeoutSeconds = 300f;

        [SerializeField]
        private ResultUnityEvent onResultReady = new ResultUnityEvent();

        private readonly Dictionary<string, double> targetStartSeconds = new Dictionary<string, double>();
        private readonly List<ARPlayerTargetTiming> targetTimings = new List<ARPlayerTargetTiming>();

        private Coroutine runCoroutine;
        private Stopwatch runStopwatch;

        private void Awake()
        {
            ResolveSceneReferences();
        }

        private IEnumerator Start()
        {
            ResolveSceneReferences();

            if (runOnStart)
            {
                yield return RunSuite(targetCount);
            }
        }

        [ContextMenu("Run Configured Performance Spike")]
        public void RunConfiguredSpike()
        {
            StartRun(targetCount);
        }

        [ContextMenu("Run 25 Targets")]
        public void Run25Targets()
        {
            StartRun(25);
        }

        [ContextMenu("Run 50 Targets")]
        public void Run50Targets()
        {
            StartRun(50);
        }

        [ContextMenu("Run 100 Targets")]
        public void Run100Targets()
        {
            StartRun(100);
        }

        [ContextMenu("Run 200 Targets")]
        public void Run200Targets()
        {
            StartRun(200);
        }

        public void StartRun(int requestedTargetCount)
        {
            if (runCoroutine != null)
            {
                StopCoroutine(runCoroutine);
            }

            targetCount = requestedTargetCount;
            runCoroutine = StartCoroutine(RunSuite(requestedTargetCount));
        }

        private IEnumerator RunSuite(int requestedTargetCount)
        {
            ResolveSceneReferences();

            if (runtimeImageLibrary == null)
            {
                EmitResult("GroupARPerf error=MissingRuntimeImageLibrary");
                yield break;
            }

            ARPlayerManifest manifest = ARPlayerSyntheticManifestFactory.CreateManifest(
                requestedTargetCount,
                seed,
                out ARPlayerSyntheticManifestBuildInfo buildInfo);

            yield return RunSinglePass(manifest, buildInfo, "cold", true);

            if (runWarmAfterCold)
            {
                yield return RunSinglePass(manifest, buildInfo, "warm", false);
            }

            runCoroutine = null;
        }

        private IEnumerator RunSinglePass(
            ARPlayerManifest manifest,
            ARPlayerSyntheticManifestBuildInfo buildInfo,
            string cacheMode,
            bool clearCacheBeforeRun)
        {
            if (triggerImageCache == null)
            {
                triggerImageCache = FindFirstObjectByType<ARPlayerTriggerImageCache>();
            }

            if (clearCacheBeforeRun && triggerImageCache != null)
            {
                int deletedCount = triggerImageCache.DeleteTriggerImages(manifest.Targets);
                UnityEngine.Debug.Log($"[GroupAR][perf] Cleared {deletedCount} trigger cache entries before cold run.");
            }

            int cacheEntriesBefore = CountCachedTargets(manifest);
            telemetry?.ResetCounts();
            targetStartSeconds.Clear();
            targetTimings.Clear();

            runtimeImageLibrary.TargetAddStarted += OnTargetAddStarted;
            runtimeImageLibrary.TargetAddCompleted += OnTargetAddCompleted;

            runStopwatch = Stopwatch.StartNew();
            bool completed = false;
            Coroutine loadCoroutine = StartCoroutine(RunManifestLoad(manifest, () => completed = true));

            while (!completed && runStopwatch.Elapsed.TotalSeconds < timeoutSeconds)
            {
                yield return null;
            }

            bool timedOut = !completed;
            if (timedOut)
            {
                StopCoroutine(loadCoroutine);
            }

            double totalMs = runStopwatch.Elapsed.TotalMilliseconds;
            runtimeImageLibrary.TargetAddStarted -= OnTargetAddStarted;
            runtimeImageLibrary.TargetAddCompleted -= OnTargetAddCompleted;

            int cacheEntriesAfter = CountCachedTargets(manifest);
            string summary = BuildSummary(
                manifest,
                buildInfo,
                cacheMode,
                timedOut,
                totalMs,
                cacheEntriesBefore,
                cacheEntriesAfter);

            EmitResult(summary);

            if (includePerTargetCsv && targetTimings.Count > 0)
            {
                UnityEngine.Debug.Log(BuildPerTargetCsv(cacheMode));
            }
        }

        private IEnumerator RunManifestLoad(ARPlayerManifest manifest, Action onCompleted)
        {
            yield return runtimeImageLibrary.LoadManifest(manifest);
            onCompleted?.Invoke();
        }

        private void OnTargetAddStarted(ARPlayerTargetDefinition target)
        {
            if (target == null || runStopwatch == null)
            {
                return;
            }

            targetStartSeconds[target.TargetId] = runStopwatch.Elapsed.TotalSeconds;
        }

        private void OnTargetAddCompleted(ARPlayerTargetDefinition target, AddReferenceImageJobStatus status)
        {
            if (target == null || runStopwatch == null)
            {
                return;
            }

            double endSeconds = runStopwatch.Elapsed.TotalSeconds;
            targetStartSeconds.TryGetValue(target.TargetId, out double startSeconds);
            targetTimings.Add(new ARPlayerTargetTiming(
                target.TargetId,
                target.TriggerImageId,
                status.ToString(),
                Math.Max(0d, (endSeconds - startSeconds) * 1000d)));
        }

        private string BuildSummary(
            ARPlayerManifest manifest,
            ARPlayerSyntheticManifestBuildInfo buildInfo,
            string cacheMode,
            bool timedOut,
            double totalMs,
            int cacheEntriesBefore,
            int cacheEntriesAfter)
        {
            double averageMs = targetTimings.Count > 0 ? targetTimings.Average(timing => timing.DurationMs) : 0d;
            double minMs = targetTimings.Count > 0 ? targetTimings.Min(timing => timing.DurationMs) : 0d;
            double maxMs = targetTimings.Count > 0 ? targetTimings.Max(timing => timing.DurationMs) : 0d;
            double p95Ms = CalculatePercentile(targetTimings.Select(timing => timing.DurationMs), 0.95d);
            int successCount = targetTimings.Count(timing => string.Equals(timing.Status, "Success", StringComparison.OrdinalIgnoreCase));
            int errorCount = Math.Max(0, targetTimings.Count - successCount);
            long memoryBytes = GC.GetTotalMemory(false);

            StringBuilder builder = new StringBuilder(512);
            builder.Append("GroupARPerf");
            builder.Append(" targetCount=").Append(buildInfo.TargetCount);
            builder.Append(" cache=").Append(cacheMode);
            builder.Append(" timedOut=").Append(timedOut ? "true" : "false");
            builder.Append(" ready=").Append(runtimeImageLibrary != null && runtimeImageLibrary.IsReady ? "true" : "false");
            builder.Append(" manifestVersion=").Append(manifest.ManifestVersion);
            builder.Append(" seed=").Append(buildInfo.Seed);
            builder.Append(" totalMs=").Append(Round(totalMs));
            builder.Append(" targetCompleted=").Append(targetTimings.Count);
            builder.Append(" success=").Append(successCount);
            builder.Append(" errors=").Append(errorCount);
            builder.Append(" targetAvgMs=").Append(Round(averageMs));
            builder.Append(" targetMinMs=").Append(Round(minMs));
            builder.Append(" targetP95Ms=").Append(Round(p95Ms));
            builder.Append(" targetMaxMs=").Append(Round(maxMs));
            builder.Append(" cacheBefore=").Append(cacheEntriesBefore).Append('/').Append(buildInfo.TargetCount);
            builder.Append(" cacheAfter=").Append(cacheEntriesAfter).Append('/').Append(buildInfo.TargetCount);
            builder.Append(" managedMemoryMB=").Append(Round(memoryBytes / (1024d * 1024d)));
            builder.Append(" statusCounts=").Append(FormatStatusCounts());
            builder.Append(" sourceFolder=\"").Append(buildInfo.RootFolder).Append('"');
            return builder.ToString();
        }

        private string BuildPerTargetCsv(string cacheMode)
        {
            StringBuilder builder = new StringBuilder();
            builder.AppendLine($"[GroupAR][perf][targets] cache={cacheMode}");
            builder.AppendLine("targetId,triggerImageId,status,durationMs");

            for (int i = 0; i < targetTimings.Count; i++)
            {
                ARPlayerTargetTiming timing = targetTimings[i];
                builder.Append(timing.TargetId).Append(',');
                builder.Append(timing.TriggerImageId).Append(',');
                builder.Append(timing.Status).Append(',');
                builder.Append(Round(timing.DurationMs)).AppendLine();
            }

            return builder.ToString();
        }

        private int CountCachedTargets(ARPlayerManifest manifest)
        {
            if (triggerImageCache == null || manifest == null || manifest.Targets == null)
            {
                return 0;
            }

            int count = 0;
            for (int i = 0; i < manifest.Targets.Count; i++)
            {
                ARPlayerTargetDefinition target = manifest.Targets[i];
                if (target != null && target.Image != null && triggerImageCache.HasTriggerImage(target.Image.Sha256))
                {
                    count++;
                }
            }

            return count;
        }

        private string FormatStatusCounts()
        {
            if (telemetry == null || telemetry.StatusCounts.Count == 0)
            {
                return "{}";
            }

            return "{" + string.Join(";", telemetry.StatusCounts.Select(pair => $"{pair.Key}:{pair.Value}")) + "}";
        }

        private void ResolveSceneReferences()
        {
            if (runtimeImageLibrary == null)
            {
                runtimeImageLibrary = FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            }

            if (telemetry == null)
            {
                telemetry = FindFirstObjectByType<ARPlayerTelemetry>();
            }

            if (triggerImageCache == null)
            {
                triggerImageCache = FindFirstObjectByType<ARPlayerTriggerImageCache>();
            }

            if (outputText == null)
            {
                outputText = FindFirstObjectByType<Text>();
            }
        }

        private void EmitResult(string result)
        {
            if (outputText != null)
            {
                outputText.text = result;
            }

            onResultReady.Invoke(result);
            UnityEngine.Debug.Log($"[GroupAR][perf] {result}");
        }

        private static double CalculatePercentile(IEnumerable<double> values, double percentile)
        {
            List<double> sorted = values.OrderBy(value => value).ToList();
            if (sorted.Count == 0)
            {
                return 0d;
            }

            double position = (sorted.Count - 1) * percentile;
            int lower = Mathf.FloorToInt((float) position);
            int upper = Mathf.CeilToInt((float) position);

            if (lower == upper)
            {
                return sorted[lower];
            }

            double fraction = position - lower;
            return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
        }

        private static string Round(double value)
        {
            return value.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        }

        private readonly struct ARPlayerTargetTiming
        {
            public ARPlayerTargetTiming(
                string targetId,
                string triggerImageId,
                string status,
                double durationMs)
            {
                TargetId = targetId;
                TriggerImageId = triggerImageId;
                Status = status;
                DurationMs = durationMs;
            }

            public string TargetId { get; }

            public string TriggerImageId { get; }

            public string Status { get; }

            public double DurationMs { get; }
        }
    }
}
