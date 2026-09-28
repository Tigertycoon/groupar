# GroupAR

[![Platform checks](https://github.com/Tigertycoon/groupar/actions/workflows/platform.yml/badge.svg)](https://github.com/Tigertycoon/groupar/actions/workflows/platform.yml)

**A manifest-driven AR content pipeline built with Unity/C#, Node.js and TypeScript.**

GroupAR explores how a group can publish image targets and associated media to a native AR player without rebuilding the app for every content change. It connects runtime image-library construction, content routing and client telemetry with a shared platform contract.

**Status: development prototype.** Unity currently renders debug placeholders. Dashboard workflows are simulated, the API uses in-memory data and mock identity, and production worker adapters are not connected. Physical ARCore/ARKit tracking has not been validated for this publication.

## My contribution

Niklas / Tigertycoon: the GroupAR player, shared data contracts, platform prototype and processing-worker code. The project demonstrates Unity AR Foundation integration alongside API and asynchronous media-processing design. Publication cleanup, regression checks and documentation were prepared with Codex assistance.

| Component | Implemented | Current boundary |
| --- | --- | --- |
| Unity AR player | Manifest loading with ETags, runtime target registration, SHA256-keyed image cache, target/content routing, telemetry and cold/warm performance probe | Image/video/model renderers are placeholders; device measurements are pending |
| Node.js API | Group-scoped manifests, conditional HTTP, revision publish gates, deduplicated analytics and local media delivery | Mock identity and in-memory state; no persistent database or real uploads |
| Web dashboard | Group/artwork views, revision workflow and processing-state exploration | Browser-local simulation; manifest links point to the API |
| TypeScript worker | Image processing, video and GLB job handlers, quality reports, derivative records and BullMQ wiring | Production storage/database adapters and a deployed queue are pending |

## Run the platform locally

Install **Node.js 22+**, then from the repository root:

```sh
npm --prefix Plattform start
```

Open **http://localhost:8787/**. The server provides the dashboard, API and original synthetic test media. The demo sign-in uses fixture data; no account is created. State resets when its process or page is restarted.

The server binds to `127.0.0.1` by default. The [Unity setup guide](docs/unity-setup.md) explains device-network configuration.

## Open the Unity player

Open this repository in **Unity 6000.3.19f1** and load:

`Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity`

AR Foundation, ARCore and ARKit **6.3.4** are resolved through Unity Package Manager. Start the local API before entering Play Mode. The scene requests the fixture manifest on startup. AR simulation/provider availability depends on the editor and target platform; a successful editor import does not establish physical image tracking.

No paid Asset Store package is required by this publication. [Setup and limits](docs/unity-setup.md).

## Verify the code

```sh
npm --prefix Plattform test
npm --prefix Plattform/worker ci
npm --prefix Plattform/worker run check
npm --prefix Plattform/worker run check:fixtures
npm --prefix Plattform/worker run check:jobs
npm --prefix Plattform/worker run check:images
```

GitHub Actions runs the platform checks. Unity compilation, scene references, manifest decoding and cache integrity were separately checked in the installed editor. See [validation and evidence](docs/validation.md).

## Navigate the project

- [Unity player](Assets/GroupAR/ARPlayer/Scripts): runtime AR and caching code.
- [API](Plattform/api/server.mjs), [dashboard](Plattform/dashboard) and [worker](Plattform/worker/src).
- [Architecture](docs/architecture.md) and shared [manifest/job contracts](Plattform/contracts.md).
- [Publication notes](docs/publication-notes.md): extracted scope and fixture provenance.
- The German documents in `Plattform/` retain the original design and experiment notes; proposed architecture is distinguished from working code.

## License

The authored code, documentation and synthetic fixtures are [MIT licensed](LICENSE). Unity and npm dependencies retain their own licenses and are installed separately; see [third-party notices](THIRD_PARTY_NOTICES.md).
Independent reimplementation: I had previously implemented this concept as an internal prototype for an employer; this code has been completely rewritten and contains no elements from that version.
