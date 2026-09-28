#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using GroupAR.ARPlayer;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace GroupAR.ARPlayer.EditorVerification
{
    [InitializeOnLoad]
    public static class ARPlayerVerticalSliceVerifier
    {
        private const string ScenePath = "Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity";
        private const string ManifestUrl = "http://localhost:8787/groups/grp_fixture_ar_test/manifest";
        private const string RunRequestPath = "Temp/GroupARVerticalSliceRun.request";
        private const string RuntimeLogPath = "Logs/unity-vertical-slice-runtime.log";
        private const string VerifierReportPath = "Logs/unity-vertical-slice-editor-verifier.md";
        private const string ScreenshotPath = "Logs/unity-vertical-slice-playmode.png";
        private const string TriggerSourcePath = "Plattform/fixtures/cdn-root/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.png";
        private const string TriggerCopyPath = "Logs/unity-vertical-slice-trigger-trg_fixture_feature_box.png";
        private const double MaxPlayModeSeconds = 35.0;

        private static readonly List<string> CapturedLogs = new List<string>();
        private static readonly List<string> CapturedAnalytics = new List<string>();

        private static bool monitoring;
        private static bool finalizing;
        private static double playStartTime;
        private static ARPlayerTelemetry telemetryHook;
        private static bool trackingSimulationAttempted;
        private static bool trackingSimulationPassed;
        private static string trackingSimulationMessage = string.Empty;
        private static string renderedObjectName = string.Empty;

        static ARPlayerVerticalSliceVerifier()
        {
            Application.logMessageReceived -= CaptureLog;
            Application.logMessageReceived += CaptureLog;
            EditorApplication.delayCall += MaybeStart;
            MaybeStart();
        }

        private static void MaybeStart()
        {
            if (!File.Exists(RunRequestFullPath))
            {
                return;
            }

            if (EditorApplication.isCompiling)
            {
                EditorApplication.delayCall += MaybeStart;
                return;
            }

            EnsureDirectories();

            string phase = ReadPhase();
            if (phase == "cleanup")
            {
                CleanupMissingScripts();
                return;
            }

            if (phase == "done" || phase == "finalizing")
            {
                return;
            }

            if (EditorApplication.isPlaying)
            {
                StartMonitor();
                return;
            }

            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorApplication.delayCall += MaybeStart;
                return;
            }

            try
            {
                Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                ARPlayerManifestLoader loader = UnityEngine.Object.FindFirstObjectByType<ARPlayerManifestLoader>();
                if (loader != null)
                {
                    loader.ManifestUrl = ManifestUrl;
                    EditorUtility.SetDirty(loader);
                    EditorSceneManager.MarkSceneDirty(scene);
                }

                EditorSceneManager.SaveScene(scene);
                WritePhase("play-requested");
                AppendVerifierLine("Requested Play Mode for GroupAR vertical slice verification.");
                EditorApplication.update -= WaitForPlayMode;
                EditorApplication.update += WaitForPlayMode;
                EditorApplication.isPlaying = true;
            }
            catch (Exception exception)
            {
                WriteFailureReport("Editor setup failed: " + exception.Message);
                WritePhase("done");
            }
        }

        private static void WaitForPlayMode()
        {
            if (!File.Exists(RunRequestFullPath))
            {
                EditorApplication.update -= WaitForPlayMode;
                return;
            }

            if (EditorApplication.isPlaying)
            {
                EditorApplication.update -= WaitForPlayMode;
                StartMonitor();
            }
        }

        private static void StartMonitor()
        {
            if (monitoring)
            {
                return;
            }

            monitoring = true;
            playStartTime = EditorApplication.timeSinceStartup;
            WritePhase("playing");
            EditorApplication.update -= MonitorPlayMode;
            EditorApplication.update += MonitorPlayMode;
            AppendVerifierLine("Play Mode monitor started.");
        }

        private static void MonitorPlayMode()
        {
            if (finalizing)
            {
                return;
            }

            if (!EditorApplication.isPlaying)
            {
                FinalizeReport("Play Mode ended before verifier completed.", true);
                return;
            }

            HookTelemetry();

            ARPlayerRuntimeImageLibrary runtime = UnityEngine.Object.FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            if (runtime != null && runtime.IsReady && !trackingSimulationAttempted)
            {
                TrySimulateTrackedImageRouter(runtime);
            }

            double elapsed = EditorApplication.timeSinceStartup - playStartTime;
            bool timedOut = elapsed >= MaxPlayModeSeconds;
            bool runtimeReady = runtime != null && runtime.IsReady;
            bool fatalBlocker = HasFatalRuntimeBlocker();

            if (runtimeReady || timedOut || fatalBlocker)
            {
                if (runtimeReady && !trackingSimulationAttempted)
                {
                    TrySimulateTrackedImageRouter(runtime);
                }

                string reason = timedOut ? "Timed out waiting for the full AR runtime flow." : "Runtime reached a terminal verification state.";
                FinalizeReport(reason, timedOut || fatalBlocker);
            }
        }

        private static void FinalizeReport(string reason, bool blocked)
        {
            if (finalizing)
            {
                return;
            }

            finalizing = true;
            WritePhase("finalizing");
            EditorApplication.update -= MonitorPlayMode;

            ARPlayerRuntimeImageLibrary runtime = UnityEngine.Object.FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            ARPlayerManifestLoader loader = UnityEngine.Object.FindFirstObjectByType<ARPlayerManifestLoader>();
            ARPlayerTelemetry telemetry = UnityEngine.Object.FindFirstObjectByType<ARPlayerTelemetry>();

            if (runtime != null && runtime.IsReady && !trackingSimulationAttempted)
            {
                TrySimulateTrackedImageRouter(runtime);
            }

            TryCopyTriggerImage();
            TryCaptureScreenshot();

            File.WriteAllText(RuntimeLogFullPath, string.Join(Environment.NewLine, CapturedLogs), Encoding.UTF8);
            File.WriteAllText(VerifierReportFullPath, BuildVerifierReport(reason, blocked, loader, runtime, telemetry), Encoding.UTF8);
            AppendVerifierLine("Verifier report written: " + VerifierReportPath);

            WritePhase("done");
            EditorApplication.delayCall += () =>
            {
                if (EditorApplication.isPlaying)
                {
                    EditorApplication.isPlaying = false;
                }
            };
        }

        private static string BuildVerifierReport(
            string reason,
            bool blocked,
            ARPlayerManifestLoader loader,
            ARPlayerRuntimeImageLibrary runtime,
            ARPlayerTelemetry telemetry)
        {
            int targetCount = runtime != null && runtime.TargetsById != null ? runtime.TargetsById.Count : 0;
            int contentCount = runtime != null && runtime.ContentById != null ? runtime.ContentById.Count : 0;
            string statusCounts = FormatStatusCounts(telemetry);
            string analytics = CapturedAnalytics.Count > 0 ? string.Join("<br>", CapturedAnalytics) : "(no analytics callback captured)";
            string logs = CapturedLogs.Count > 0
                ? string.Join(Environment.NewLine, CapturedLogs.TakeLast(80))
                : "(no GroupAR logs captured)";

            StringBuilder builder = new StringBuilder();
            builder.AppendLine("# GroupAR Unity Vertical Slice Editor Verifier");
            builder.AppendLine();
            builder.AppendLine("Generated: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            builder.AppendLine("Reason: " + reason);
            builder.AppendLine("Blocked: " + blocked);
            builder.AppendLine();
            builder.AppendLine("## Runtime State");
            builder.AppendLine();
            builder.AppendLine("- Scene: " + ScenePath);
            builder.AppendLine("- Manifest URL: " + (loader != null ? loader.ManifestUrl : "(loader missing)"));
            builder.AppendLine("- SchemaVersion: " + (runtime != null ? runtime.SchemaVersion : "(runtime missing)"));
            builder.AppendLine("- ManifestVersion: " + (runtime != null ? runtime.ManifestVersion.ToString() : "(runtime missing)"));
            builder.AppendLine("- GroupId: " + (runtime != null ? runtime.GroupId : "(runtime missing)"));
            builder.AppendLine("- IsReady: " + (runtime != null && runtime.IsReady));
            builder.AppendLine("- TargetsById.Count: " + targetCount);
            builder.AppendLine("- ContentById.Count: " + contentCount);
            builder.AppendLine("- Telemetry StatusCounts: " + statusCounts);
            builder.AppendLine("- Tracking simulation: " + (trackingSimulationAttempted ? trackingSimulationPassed + " - " + trackingSimulationMessage : "not attempted"));
            builder.AppendLine("- Rendered object: " + (string.IsNullOrEmpty(renderedObjectName) ? "(none)" : renderedObjectName));
            builder.AppendLine();
            builder.AppendLine("## Captured Analytics");
            builder.AppendLine();
            builder.AppendLine(analytics);
            builder.AppendLine();
            builder.AppendLine("## Recent GroupAR Logs");
            builder.AppendLine();
            builder.AppendLine("```text");
            builder.AppendLine(logs);
            builder.AppendLine("```");
            builder.AppendLine();
            builder.AppendLine("## Artifacts");
            builder.AppendLine();
            builder.AppendLine("- Runtime log: " + RuntimeLogPath);
            builder.AppendLine("- Play mode screenshot: " + ScreenshotPath);
            builder.AppendLine("- Fixture trigger copy: " + TriggerCopyPath);
            return builder.ToString();
        }

        private static void TrySimulateTrackedImageRouter(ARPlayerRuntimeImageLibrary runtime)
        {
            trackingSimulationAttempted = true;
            trackingSimulationPassed = false;

            try
            {
                ARTrackedImageContentRouter router = UnityEngine.Object.FindFirstObjectByType<ARTrackedImageContentRouter>();
                if (router == null)
                {
                    trackingSimulationMessage = "ARTrackedImageContentRouter missing.";
                    return;
                }

                if (runtime == null || runtime.TargetsById == null || runtime.TargetsById.Count == 0)
                {
                    trackingSimulationMessage = "No runtime target map entries available.";
                    return;
                }

                ARPlayerTargetDefinition target = runtime.TargetsById.Values.FirstOrDefault();
                if (target == null)
                {
                    trackingSimulationMessage = "First runtime target was null.";
                    return;
                }

                if (!runtime.TryResolveContent(target.PrimaryContentId, out ARPlayerContentDefinition content))
                {
                    trackingSimulationMessage = "Primary content could not be resolved for " + target.TargetId + ".";
                    return;
                }

                GameObject trackedObject = new GameObject("GroupAR Verifier Fake ARTrackedImage");
                ARTrackedImage trackedImage = trackedObject.AddComponent<ARTrackedImage>();
                float width = Mathf.Max(target.PhysicalWidthMeters, 0.01f);
                Vector2 size = new Vector2(width, width);
                XRReferenceImage referenceImage = new XRReferenceImage(
                    new SerializableGuid(Guid.NewGuid()),
                    new SerializableGuid(Guid.NewGuid()),
                    size,
                    target.TargetId,
                    null);

                XRTrackedImage data = new XRTrackedImage(
                    new TrackableId(0x1234, 0x5678),
                    referenceImage.guid,
                    Pose.identity,
                    size,
                    TrackingState.Tracking,
                    IntPtr.Zero);

                MethodInfo setData = typeof(ARTrackable<XRTrackedImage, ARTrackedImage>).GetMethod(
                    "SetSessionRelativeData",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                setData?.Invoke(trackedImage, new object[] { data });

                PropertyInfo referenceProperty = typeof(ARTrackedImage).GetProperty("referenceImage");
                MethodInfo setter = referenceProperty?.GetSetMethod(true);
                setter?.Invoke(trackedImage, new object[] { referenceImage });

                MethodInfo updateContent = typeof(ARTrackedImageContentRouter).GetMethod(
                    "UpdateContent",
                    BindingFlags.Instance | BindingFlags.NonPublic);
                updateContent?.Invoke(router, new object[] { trackedImage });

                GameObject rendered = trackedImage.transform.childCount > 0
                    ? trackedImage.transform.GetChild(0).gameObject
                    : null;

                trackingSimulationPassed = rendered != null && rendered.activeSelf;
                renderedObjectName = rendered != null ? rendered.name : string.Empty;
                trackingSimulationMessage = trackingSimulationPassed
                    ? $"Simulated ARTrackedImage resolved {target.TargetId} -> {target.PrimaryContentId} ({content.Type}) and rendered '{renderedObjectName}'."
                    : $"Simulated ARTrackedImage did not create active content for {target.TargetId}.";
            }
            catch (Exception exception)
            {
                trackingSimulationMessage = "Simulation failed: " + exception.Message;
            }
        }

        private static bool HasAddedTargets(ARPlayerRuntimeImageLibrary runtime)
        {
            return runtime != null && runtime.TargetsById != null && runtime.TargetsById.Count > 0;
        }

        private static bool HasTerminalTelemetry()
        {
            ARPlayerTelemetry telemetry = UnityEngine.Object.FindFirstObjectByType<ARPlayerTelemetry>();
            return telemetry != null && telemetry.StatusCounts != null && telemetry.StatusCounts.Count > 0;
        }

        private static bool HasFatalRuntimeBlocker()
        {
            for (int i = CapturedLogs.Count - 1; i >= 0; i--)
            {
                string line = CapturedLogs[i];
                if (line.Contains("AR is unsupported on this device") ||
                    line.Contains("Image tracking descriptor is unavailable") ||
                    line.Contains("Mutable runtime image libraries are not supported") ||
                    line.Contains("Failed to create runtime image library"))
                {
                    return true;
                }
            }

            return false;
        }

        private static void HookTelemetry()
        {
            ARPlayerTelemetry telemetry = UnityEngine.Object.FindFirstObjectByType<ARPlayerTelemetry>();
            if (telemetry == null || telemetry == telemetryHook)
            {
                return;
            }

            if (telemetryHook != null)
            {
                telemetryHook.AnalyticsEvent -= CaptureAnalytics;
            }

            telemetryHook = telemetry;
            telemetryHook.AnalyticsEvent += CaptureAnalytics;
        }

        private static void CaptureAnalytics(string eventName, string payloadJson)
        {
            CapturedAnalytics.Add(eventName + " " + payloadJson);
        }

        private static void CaptureLog(string condition, string stackTrace, LogType type)
        {
            if (!File.Exists(RunRequestFullPath))
            {
                return;
            }

            if (!condition.Contains("[GroupAR]"))
            {
                return;
            }

            CapturedLogs.Add(DateTime.Now.ToString("HH:mm:ss") + " [" + type + "] " + condition);
        }

        private static string FormatStatusCounts(ARPlayerTelemetry telemetry)
        {
            if (telemetry == null || telemetry.StatusCounts == null || telemetry.StatusCounts.Count == 0)
            {
                return "{}";
            }

            return "{" + string.Join(", ", telemetry.StatusCounts.Select(pair => pair.Key + ": " + pair.Value)) + "}";
        }

        private static void TryCaptureScreenshot()
        {
            try
            {
                ScreenCapture.CaptureScreenshot(ScreenshotFullPath);
            }
            catch (Exception exception)
            {
                CapturedLogs.Add(DateTime.Now.ToString("HH:mm:ss") + " [Warning] Screenshot capture failed: " + exception.Message);
            }
        }

        private static void TryCopyTriggerImage()
        {
            try
            {
                if (File.Exists(TriggerSourceFullPath))
                {
                    File.Copy(TriggerSourceFullPath, TriggerCopyFullPath, true);
                }
            }
            catch (Exception exception)
            {
                CapturedLogs.Add(DateTime.Now.ToString("HH:mm:ss") + " [Warning] Trigger copy failed: " + exception.Message);
            }
        }

        private static void WriteFailureReport(string message)
        {
            EnsureDirectories();
            File.WriteAllText(
                VerifierReportFullPath,
                "# GroupAR Unity Vertical Slice Editor Verifier" + Environment.NewLine + Environment.NewLine + message + Environment.NewLine,
                Encoding.UTF8);
        }

        private static void AppendVerifierLine(string line)
        {
            EnsureDirectories();
            File.AppendAllText(RuntimeLogFullPath, DateTime.Now.ToString("HH:mm:ss") + " [verifier] " + line + Environment.NewLine, Encoding.UTF8);
        }

        private static void EnsureDirectories()
        {
            Directory.CreateDirectory(FullPath("Temp"));
            Directory.CreateDirectory(FullPath("Logs"));
        }

        private static string ReadPhase()
        {
            try
            {
                return File.Exists(RunRequestFullPath) ? File.ReadAllText(RunRequestFullPath).Trim() : string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static void WritePhase(string phase)
        {
            EnsureDirectories();
            File.WriteAllText(RunRequestFullPath, phase, Encoding.UTF8);
        }

        private static void CleanupMissingScripts()
        {
            try
            {
                Scene scene = EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                GameObject runtime = GameObject.Find("AR Player Runtime");
                int removed = runtime != null
                    ? GameObjectUtility.RemoveMonoBehavioursWithMissingScript(runtime)
                    : 0;
                if (runtime != null && removed == 0)
                {
                    removed = RemoveMissingComponentsBySerializedObject(runtime);
                }

                if (removed > 0)
                {
                    EditorSceneManager.MarkSceneDirty(scene);
                    EditorSceneManager.SaveScene(scene);
                }

                AppendVerifierLine("Cleanup removed missing script components: " + removed);
            }
            catch (Exception exception)
            {
                AppendVerifierLine("Cleanup failed: " + exception.Message);
            }
            finally
            {
                WritePhase("done");
            }
        }

        private static int RemoveMissingComponentsBySerializedObject(GameObject target)
        {
            SerializedObject serializedObject = new SerializedObject(target);
            SerializedProperty components = serializedObject.FindProperty("m_Component");
            if (components == null || !components.isArray)
            {
                return 0;
            }

            int removed = 0;
            for (int i = components.arraySize - 1; i >= 0; i--)
            {
                SerializedProperty component = components.GetArrayElementAtIndex(i).FindPropertyRelative("component");
                if (component != null && component.objectReferenceValue == null)
                {
                    components.DeleteArrayElementAtIndex(i);
                    removed++;
                }
            }

            if (removed > 0)
            {
                serializedObject.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(target);
            }

            return removed;
        }

        private static string ProjectRoot => Path.GetFullPath(Path.Combine(Application.dataPath, ".."));

        private static string RunRequestFullPath => FullPath(RunRequestPath);

        private static string RuntimeLogFullPath => FullPath(RuntimeLogPath);

        private static string VerifierReportFullPath => FullPath(VerifierReportPath);

        private static string ScreenshotFullPath => FullPath(ScreenshotPath);

        private static string TriggerSourceFullPath => FullPath(TriggerSourcePath);

        private static string TriggerCopyFullPath => FullPath(TriggerCopyPath);

        private static string FullPath(string projectRelativePath)
        {
            return Path.GetFullPath(Path.Combine(ProjectRoot, projectRelativePath));
        }
    }
}
#endif
