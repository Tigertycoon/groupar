# Unity setup

1. Install Unity **6000.3.19f1** with the build support required for your target device.
2. Open the repository root and allow Package Manager and asset import to finish.
3. Run `npm --prefix Plattform start` from the repository root.
4. Open `Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity`.
5. Inspect `AR Player Runtime`: the manifest loader points to `http://localhost:8787/groups/grp_fixture_ar_test/manifest`.

The clean scene contains an AR session, image manager and GroupAR components. It has no missing script references in the editor validation. No Makaka, Imagine or OpenCV for Unity asset package is needed.

## Device checks

On a phone, `localhost` refers to the phone. For a controlled LAN test, set `GROUPAR_API_HOST=0.0.0.0`, update the loader URL to the host's reachable address, and replace the URL origin in both `Plattform/fixtures/manifest-test-group-*.json` files. The fixture bytes and hashes stay unchanged. HTTP access, camera permissions and platform XR settings must be checked for the device build.

This API is a local development service with a mock user; it is not suitable for an Internet deployment. ARCore/ARKit recognition, camera behavior, real media playback and mobile performance remain unverified. Synthetic textures demonstrate the data pipeline and are not a validated physical tracking corpus.

## Repeat the editor validation

From the repository root, invoke the Unity executable with:

```text
-batchmode -nographics -projectPath <absolute-repository-path> -executeMethod GroupAR.ARPlayer.EditorVerification.PortfolioValidation.Run -logFile <absolute-log-path>
```

The command exits with failure when compilation or a validation assertion fails. On success it writes `TestResults/unity-editor-validation.txt`. It checks the loaded scene, contract references, decoding all four PNG target files and SHA256 acceptance/rejection. It does not enter a physical tracking session.

The earlier `ARPlayerVerticalSliceVerifier` is retained as an experimental editor harness. Its historical simulated-tracking results are not a current device certification.
