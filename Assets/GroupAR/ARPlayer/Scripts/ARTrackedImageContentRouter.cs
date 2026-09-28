using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace GroupAR.ARPlayer
{
    public sealed class ARTrackedImageContentRouter : MonoBehaviour
    {
        [SerializeField]
        private ARTrackedImageManager trackedImageManager;

        [SerializeField]
        private ARPlayerRuntimeImageLibrary runtimeImageLibrary;

        [SerializeField]
        private GameObject contentPrefab;

        [SerializeField]
        private List<ARPlayerContentRendererBase> contentRenderers = new List<ARPlayerContentRendererBase>();

        [SerializeField]
        private bool showLimitedTrackingContent;

        private readonly Dictionary<TrackableId, GameObject> contentByTrackableId =
            new Dictionary<TrackableId, GameObject>();

        private readonly Dictionary<TrackableId, IARPlayerContentRenderer> rendererByTrackableId =
            new Dictionary<TrackableId, IARPlayerContentRenderer>();

        private void Awake()
        {
            ResolveSceneReferences();
        }

        private void OnEnable()
        {
            ResolveSceneReferences();

            if (trackedImageManager != null)
            {
                trackedImageManager.trackablesChanged.AddListener(OnTrackablesChanged);
            }
        }

        private void OnDisable()
        {
            if (trackedImageManager != null)
            {
                trackedImageManager.trackablesChanged.RemoveListener(OnTrackablesChanged);
            }
        }

        private void OnTrackablesChanged(ARTrackablesChangedEventArgs<ARTrackedImage> args)
        {
            foreach (ARTrackedImage trackedImage in args.added)
            {
                UpdateContent(trackedImage);
            }

            foreach (ARTrackedImage trackedImage in args.updated)
            {
                UpdateContent(trackedImage);
            }

            foreach (KeyValuePair<TrackableId, ARTrackedImage> removedImage in args.removed)
            {
                if (contentByTrackableId.TryGetValue(removedImage.Key, out GameObject content))
                {
                    if (rendererByTrackableId.TryGetValue(removedImage.Key, out IARPlayerContentRenderer renderer))
                    {
                        renderer.Release(content);
                        rendererByTrackableId.Remove(removedImage.Key);
                    }
                    else
                    {
                        Destroy(content);
                    }

                    contentByTrackableId.Remove(removedImage.Key);
                }
            }
        }

        private void UpdateContent(ARTrackedImage trackedImage)
        {
            bool canShow = trackedImage.trackingState == TrackingState.Tracking ||
                (showLimitedTrackingContent && trackedImage.trackingState == TrackingState.Limited);

            if (!canShow)
            {
                SetContentActive(trackedImage.trackableId, false);
                return;
            }

            if (runtimeImageLibrary == null ||
                !runtimeImageLibrary.TryResolveTargetContent(
                    trackedImage,
                    out ARPlayerTargetDefinition target,
                    out ARPlayerContentDefinition contentDefinition))
            {
                SetContentActive(trackedImage.trackableId, false);
                return;
            }

            GameObject content = GetOrCreateContent(trackedImage, target, contentDefinition);
            if (content == null)
            {
                SetContentActive(trackedImage.trackableId, false);
                return;
            }

            content.transform.SetParent(trackedImage.transform, false);
            content.transform.localPosition = Vector3.zero;
            content.transform.localRotation = Quaternion.identity;
            content.transform.localScale = BuildContentScale(trackedImage);
            content.SetActive(true);
        }

        private GameObject GetOrCreateContent(
            ARTrackedImage trackedImage,
            ARPlayerTargetDefinition target,
            ARPlayerContentDefinition contentDefinition)
        {
            contentByTrackableId.TryGetValue(trackedImage.trackableId, out GameObject content);

            IARPlayerContentRenderer renderer = FindRenderer(contentDefinition);
            if (renderer != null)
            {
                ARPlayerContentRenderContext context = new ARPlayerContentRenderContext(
                    trackedImage,
                    target,
                    contentDefinition,
                    BuildContentScale(trackedImage));

                content = renderer.Render(context, content);
                rendererByTrackableId[trackedImage.trackableId] = renderer;
            }
            else if (content == null && contentPrefab != null)
            {
                content = Instantiate(contentPrefab);
                content.name = $"AR Content - {contentDefinition.ContentId}";
            }
            else if (content == null)
            {
                content = CreateFallbackDebugContent(contentDefinition);
            }

            contentByTrackableId[trackedImage.trackableId] = content;
            Debug.Log($"[GroupAR] Showing {contentDefinition.Type} content '{contentDefinition.ContentId}' for target '{target.TargetId}'.");
            return content;
        }

        private IARPlayerContentRenderer FindRenderer(ARPlayerContentDefinition contentDefinition)
        {
            ResolveContentRenderers();

            for (int i = 0; i < contentRenderers.Count; i++)
            {
                ARPlayerContentRendererBase renderer = contentRenderers[i];
                if (renderer != null && renderer.CanRender(contentDefinition))
                {
                    return renderer;
                }
            }

            return null;
        }

        private static GameObject CreateFallbackDebugContent(ARPlayerContentDefinition contentDefinition)
        {
            GameObject content = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Destroy(content.GetComponent<Collider>());

            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null)
            {
                shader = Shader.Find("Standard");
            }

            Material material = new Material(shader);
            material.color = contentDefinition.DebugColor;
            content.GetComponent<MeshRenderer>().sharedMaterial = material;
            content.name = $"AR Content - {contentDefinition.ContentId}";
            return content;
        }

        private static Vector3 BuildContentScale(ARTrackedImage trackedImage)
        {
            float width = Mathf.Max(trackedImage.size.x, 0.01f);
            float height = Mathf.Max(trackedImage.size.y, 0.01f);
            return new Vector3(width, 0.01f, height);
        }

        private void SetContentActive(TrackableId trackableId, bool isActive)
        {
            if (contentByTrackableId.TryGetValue(trackableId, out GameObject content))
            {
                content.SetActive(isActive);
            }
        }

        private void ResolveSceneReferences()
        {
            if (trackedImageManager == null)
            {
                trackedImageManager = FindFirstObjectByType<ARTrackedImageManager>();
            }

            if (runtimeImageLibrary == null)
            {
                runtimeImageLibrary = FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            }

            ResolveContentRenderers();
        }

        private void ResolveContentRenderers()
        {
            contentRenderers.RemoveAll(renderer => renderer == null);

            if (contentRenderers.Count > 0)
            {
                return;
            }

            GetComponents(contentRenderers);
        }
    }
}
