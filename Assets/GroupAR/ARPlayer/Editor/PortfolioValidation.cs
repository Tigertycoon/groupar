#if UNITY_EDITOR
using System;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace GroupAR.ARPlayer.EditorVerification
{
    /// <summary>Repeatable editor checks; does not claim physical AR tracking acceptance.</summary>
    public static class PortfolioValidation
    {
        public static void Run()
        {
            try
            {
                var scene = EditorSceneManager.OpenScene("Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity");
                int missing = scene.GetRootGameObjects()
                    .SelectMany(root => root.GetComponentsInChildren<Transform>(true))
                    .Sum(transform => GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(transform.gameObject));
                Require(missing == 0, $"Scene has {missing} missing scripts.");
                Require(UnityEngine.Object.FindFirstObjectByType<ARSession>() != null, "ARSession missing.");
                Require(UnityEngine.Object.FindFirstObjectByType<ARTrackedImageManager>() != null, "Image manager missing.");
                Require(UnityEngine.Object.FindFirstObjectByType<ARPlayerManifestLoader>() != null, "Manifest loader missing.");

                string json = File.ReadAllText("Plattform/fixtures/manifest-test-group-local.json");
                var manifest = JsonUtility.FromJson<ARPlayerManifest>(json);
                Require(manifest.SchemaVersion == "1.0", "Unexpected schema.");
                Require(manifest.Targets.Count == 4 && manifest.Content.Count == 5, "Fixture counts differ.");
                foreach (var target in manifest.Targets)
                {
                    Require(target.ContentIds.Contains(target.PrimaryContentId), "Primary content is not declared.");
                    Require(manifest.Content.Any(content => content.ContentId == target.PrimaryContentId), "Content cannot resolve.");
                    string path = "Plattform/fixtures/cdn-root" + new Uri(target.Image.Url).AbsolutePath;
                    byte[] bytes = File.ReadAllBytes(path);
                    Require(ARPlayerTriggerImageCache.TryVerifySha256(bytes, target.Image.Sha256, out var reason), reason);
                    var texture = new Texture2D(2, 2);
                    Require(ImageConversion.LoadImage(texture, bytes), "Trigger image cannot decode.");
                    UnityEngine.Object.DestroyImmediate(texture);
                }
                byte[] known = Encoding.UTF8.GetBytes("abc");
                const string digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
                Require(ARPlayerTriggerImageCache.TryVerifySha256(known, "sha256:" + digest, out _), "Known SHA256 vector failed.");
                Require(!ARPlayerTriggerImageCache.TryVerifySha256(Encoding.UTF8.GetBytes("changed"), digest, out _), "Corruption accepted.");

                Directory.CreateDirectory("TestResults");
                File.WriteAllText("TestResults/unity-editor-validation.txt",
                    $"PASS — Unity {Application.unityVersion}\nScene: no missing scripts; AR components present.\nManifest: 4 targets, 5 contents; primary references resolve.\nFour actual PNGs decode and match SHA256; hash corruption is rejected.\nPhysical tracking and media playback were not tested.\n");
                Debug.Log("GroupAR publication editor validation: PASS");
                EditorApplication.Exit(0);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                EditorApplication.Exit(1);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }
    }
}
#endif
