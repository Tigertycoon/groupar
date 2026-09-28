using UnityEngine;
using UnityEngine.UI;

namespace GroupAR.ARPlayer
{
    public sealed class ARPlayerProgressView : MonoBehaviour
    {
        [SerializeField]
        private ARPlayerRuntimeImageLibrary runtimeImageLibrary;

        [SerializeField]
        private ARPlayerManifestLoader manifestLoader;

        [SerializeField]
        private Slider progressSlider;

        [SerializeField]
        private Text statusText;

        private void Awake()
        {
            ResolveSceneReferences();
        }

        private void OnEnable()
        {
            ResolveSceneReferences();

            if (runtimeImageLibrary != null)
            {
                runtimeImageLibrary.ProgressChanged += OnProgressChanged;
            }

            if (manifestLoader != null)
            {
                manifestLoader.StatusChanged += OnStatusChanged;
            }
        }

        private void OnDisable()
        {
            if (runtimeImageLibrary != null)
            {
                runtimeImageLibrary.ProgressChanged -= OnProgressChanged;
            }

            if (manifestLoader != null)
            {
                manifestLoader.StatusChanged -= OnStatusChanged;
            }
        }

        private void OnProgressChanged(ARPlayerLoadProgress progress)
        {
            if (progressSlider != null)
            {
                progressSlider.value = progress.Normalized;
            }

            if (statusText != null)
            {
                statusText.text = progress.Message;
            }
        }

        private void OnStatusChanged(string message)
        {
            if (statusText != null)
            {
                statusText.text = message;
            }
        }

        private void ResolveSceneReferences()
        {
            if (runtimeImageLibrary == null)
            {
                runtimeImageLibrary = FindFirstObjectByType<ARPlayerRuntimeImageLibrary>();
            }

            if (manifestLoader == null)
            {
                manifestLoader = FindFirstObjectByType<ARPlayerManifestLoader>();
            }

            if (progressSlider == null)
            {
                progressSlider = GetComponentInChildren<Slider>(true);
            }

            if (statusText == null)
            {
                statusText = GetComponentInChildren<Text>(true);
            }
        }
    }
}
