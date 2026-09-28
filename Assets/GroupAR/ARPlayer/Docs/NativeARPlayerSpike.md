> Historical spike design. See the root README and docs/validation.md for current publication status.

# Native AR Player Spike

## Technical Assessment

This spike keeps image recognition local and group-scoped. The mobile app should download a group manifest, cache image targets and media, create a mutable runtime image library, and route detected `targetId` values through `targets[]` to top-level `content[]`. No global recognition database is required.

AR Foundation 6.3.4 is installed with ARCore and ARKit providers. Both providers report mutable image library support. ARKit requires physical image dimensions; Android does not strictly require them but benefits from them. The spike therefore treats `physicalWidthMeters` as required manifest data.

## Manifest Contract Alignment

`Plattform/contracts.md` is the source of truth for the Unity DTOs.

Supported manifest fields:

- `schemaVersion`
- `manifestVersion`
- `deletedTargetIds`
- `targets[]`
- top-level `content[]`

Supported target fields:

- `targetId`
- `physicalWidthMeters`
- `image.url`
- `image.sha256`
- `contentIds[]`
- `primaryContentId`

Canonical content identity is `content.contentId`. The player must not depend on `target.content[]`, `content.id`, or a flat target-level `imageUrl`.

## Makaka Assessment

Keep as reference:

- AR Foundation scene bootstrapping ideas: `ARSession`, `XROrigin`, `ARTrackedImageManager`, onboarding support.
- UI/UX concepts around camera permission and first-frame/AR-start onboarding.
- Video panel and polished UI widgets only as optional implementation references.

Do not keep as player architecture:

- `BusinessCardControl` and `BusinessCardData`; they are business-card-specific and index content by reference-library order.
- Makaka `ARTrackedImageManagerControl` as the core router; it assumes one active content object and static serialized libraries.
- Business Card prefab hierarchy as a base scene; it is too demo-specific for group manifests and dynamic uploads.

## Proposed Scene

`Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity`

- `AR Session`
  - `ARSession`
- `XR Origin`
  - `XROrigin`
  - `ARTrackedImageManager`
  - `Camera Offset`
    - `Main Camera`
      - `Camera`
      - `ARCameraManager`
      - `ARCameraBackground`
- `AR Player Runtime`
  - `ARPlayerRuntimeImageLibrary`
  - `ARTrackedImageContentRouter`
- `Canvas AR Loading`
  - `Slider`
  - `Text`
  - `ARPlayerProgressView`

## Runtime Flow

1. Resolve the logged-in user's group manifest.
2. Index top-level `content[]` as `contentId -> content`.
3. Validate `schemaVersion`, `targets[]`, and `content[]`.
4. Validate each target's `targetId`, `contentIds[]`, `primaryContentId`, `image.url`, `image.sha256`, and physical width.
5. Apply `deletedTargetIds` by skipping deleted stable target IDs and rebuilding the runtime library from a clean local map.
6. Download or reuse cached trigger images.
7. Wait until `ARSession.state >= Ready`.
8. Create an empty mutable library through `ARTrackedImageManager.CreateRuntimeLibrary(null)`.
9. Assign it to `ARTrackedImageManager.referenceLibrary`.
10. Add each trigger via `ScheduleAddImageWithValidationJob(texture, targetId, physicalWidthMeters)`.
11. Rebuild local maps on manifest reload: `targetsById`, `targetsByGuid`, and `contentById`.
12. On `trackablesChanged`, resolve `ARTrackedImage.referenceImage.name -> targetId -> target -> primaryContentId -> content` and attach/render the matching content under the tracked image.

## New Scripts

- `ARPlayerTargetDefinition.cs`: manifest model with top-level `targets[]`, top-level `content[]`, target/content definitions, and progress DTO.
- `ARPlayerRuntimeImageLibrary.cs`: runtime mutable image library creation, test manifest generation, async add-image jobs, progress callbacks, and `targetId -> target -> contentId -> content` mapping.
- `ARTrackedImageContentRouter.cs`: subscribes to `ARTrackedImageManager.trackablesChanged` and creates simple debug content for recognized targets.
- `ARPlayerProgressView.cs`: simple `UnityEngine.UI` progress/status binding.

## Platform Risks

- ARKit requires physical target width. Treat missing dimensions as a manifest validation error.
- Mutable libraries are supported by installed ARCore/ARKit providers, but older OS/device combinations can still limit image validation and moving-image tracking.
- `ScheduleAddImageWithValidationJob` requires readable textures and `ARSession.state >= Ready`.
- Trigger images with low feature quality fail validation or track unreliably; backend quality scoring with `arcoreimg`/OpenCV remains necessary.
- Large group manifests can cause memory pressure and long add-job queues. Production should cap active groups, batch additions, and evict by group/session.
- Runtime-added targets are session-local. Persist downloaded source images and manifest metadata in app cache, then rebuild the runtime library on app/session start.

## Next Acceptance Criteria

- A clean spike scene can be opened without Makaka Business Card dependencies.
- On a supported ARCore or ARKit device, the scene creates a mutable runtime image library after AR session readiness.
- Two generated debug targets or two cached manifest targets are added with visible progress.
- Manifest reload clears and rebuilds `targetsById`, `targetsByGuid`, and `contentById`.
- `deletedTargetIds` are skipped during runtime-library rebuild; follow-up device testing must confirm provider-specific removal behavior because mutable AR libraries do not support deleting individual images in place.
- Detection logs the resolved `targetId -> primaryContentId -> content` chain.
- Debug content appears as a child of the detected `ARTrackedImage`.
- Invalid/duplicate/low-quality targets produce explicit status messages and do not block remaining targets.
