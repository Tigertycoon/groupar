using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.XR.ARSubsystems;

namespace GroupAR.ARPlayer
{
    /// <summary>
    /// Lean telemetry sink for the AR player. Subscribes to <see cref="ARPlayerRuntimeImageLibrary"/>
    /// and emits the canonical analytics events from contracts.md:
    /// <c>target_add_started</c>, <c>target_add_completed</c> and <c>target_add_failed</c>.
    /// Each event carries the contract payload
    /// { groupId, manifestVersion, targetId, triggerImageId, platform, status, message }.
    /// Drop this component anywhere in the AR player scene; it resolves the runtime library by itself.
    /// Hook <see cref="AnalyticsEvent"/> (code) or <c>onAnalyticsEvent</c> (inspector) to forward to a real backend.
    /// </summary>
    public sealed class ARPlayerTelemetry : MonoBehaviour
    {
        public const string EventTargetAddStarted = "target_add_started";
        public const string EventTargetAddCompleted = "target_add_completed";
        public const string EventTargetAddFailed = "target_add_failed";

        [Serializable]
        public sealed class AnalyticsUnityEvent : UnityEvent<string, string>
        {
        }

        [SerializeField]
        private ARPlayerRuntimeImageLibrary runtimeImageLibrary;

        [SerializeField]
        private bool logToConsole = true;

        [Tooltip("Raised for every analytics event as (eventName, payloadJson). Hook a real uploader here.")]
        [SerializeField]
        private AnalyticsUnityEvent onAnalyticsEvent = new AnalyticsUnityEvent();

        private readonly Dictionary<string, int> statusCounts = new Dictionary<string, int>();

        /// <summary>Raised as (eventName, payloadJson) for every emitted analytics event.</summary>
        public event Action<string, string> AnalyticsEvent;

        /// <summary>Terminal add-status counts (Success, ErrorInvalidImage, ...). Useful for the performance spike.</summary>
        public IReadOnlyDictionary<string, int> StatusCounts => statusCounts;

        private void Awake()
        {
            ResolveReferences();
        }

        private void OnEnable()
        {
            ResolveReferences();
            Subscribe();
        }

        private void OnDisable()
        {
            Unsubscribe();
        }

        public void ResetCounts()
        {
            statusCounts.Clear();
        }

        private void ResolveReferences()
        {
            if (runtimeImageLibrary == null)
            {
                runtimeImageLibrary = FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            }
        }

        private void Subscribe()
        {
            if (runtimeImageLibrary == null)
            {
                Debug.LogWarning("[GroupAR][telemetry] No ARPlayerRuntimeImageLibrary found; telemetry is inactive.");
                return;
            }

            // Defensive: never double-subscribe if OnEnable runs after a manual ResolveReferences.
            runtimeImageLibrary.TargetAddStarted -= HandleTargetAddStarted;
            runtimeImageLibrary.TargetAddCompleted -= HandleTargetAddCompleted;

            runtimeImageLibrary.TargetAddStarted += HandleTargetAddStarted;
            runtimeImageLibrary.TargetAddCompleted += HandleTargetAddCompleted;
        }

        private void Unsubscribe()
        {
            if (runtimeImageLibrary == null)
            {
                return;
            }

            runtimeImageLibrary.TargetAddStarted -= HandleTargetAddStarted;
            runtimeImageLibrary.TargetAddCompleted -= HandleTargetAddCompleted;
        }

        private void HandleTargetAddStarted(ARPlayerTargetDefinition target)
        {
            Emit(EventTargetAddStarted, target, "Started", $"Target add started: {SafeTargetId(target)}");
        }

        private void HandleTargetAddCompleted(ARPlayerTargetDefinition target, AddReferenceImageJobStatus status)
        {
            if (status.IsSuccess())
            {
                Emit(EventTargetAddCompleted, target, status.ToString(), $"Target added: {SafeTargetId(target)}");
            }
            else
            {
                Emit(EventTargetAddFailed, target, status.ToString(), $"Target add failed: {status}");
            }
        }

        private void Emit(string eventName, ARPlayerTargetDefinition target, string status, string message)
        {
            ARPlayerTargetAddTelemetryPayload payload = new ARPlayerTargetAddTelemetryPayload
            {
                groupId = runtimeImageLibrary != null ? runtimeImageLibrary.GroupId : string.Empty,
                manifestVersion = runtimeImageLibrary != null ? runtimeImageLibrary.ManifestVersion : 0,
                targetId = SafeTargetId(target),
                triggerImageId = target != null ? target.TriggerImageId : string.Empty,
                platform = ResolvePlatform(),
                status = status,
                message = message
            };

            // Count only terminal outcomes (completed/failed), not the started signal.
            if (eventName != EventTargetAddStarted)
            {
                statusCounts.TryGetValue(payload.status, out int count);
                statusCounts[payload.status] = count + 1;
            }

            string json = JsonUtility.ToJson(payload);

            AnalyticsEvent?.Invoke(eventName, json);
            onAnalyticsEvent.Invoke(eventName, json);

            if (logToConsole)
            {
                Debug.Log($"[GroupAR][telemetry] {eventName} {json}");
            }
        }

        private static string SafeTargetId(ARPlayerTargetDefinition target)
        {
            return target != null ? target.TargetId : string.Empty;
        }

        private static string ResolvePlatform()
        {
            switch (Application.platform)
            {
                case RuntimePlatform.Android:
                    return "android";
                case RuntimePlatform.IPhonePlayer:
                    return "ios";
                default:
                    return "editor";
            }
        }
    }

    /// <summary>
    /// Serializable payload mirroring the contracts.md <c>target_add_*</c> analytics schema.
    /// Field names are the canonical JSON keys; do not rename without updating contracts.md.
    /// </summary>
    [Serializable]
    public sealed class ARPlayerTargetAddTelemetryPayload
    {
        public string groupId;
        public int manifestVersion;
        public string targetId;
        public string triggerImageId;
        public string platform;
        public string status;
        public string message;
    }
}
