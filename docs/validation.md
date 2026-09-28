# Validation

Publication checks performed on **2026-09-28**:

- **Unity 6000.3.19f1**: fresh import and C# compilation without the original paid SDK/demo folders; no missing scripts in the GroupAR scene. The editor validator loads the real manifest, resolves primary content references, decodes all four synthetic target PNGs, checks their hashes and rejects corrupted bytes. [Saved result](evidence/unity-editor-validation.txt).
- **API**: seven automated tests against a real ephemeral HTTP server cover dashboard delivery, ETag/HEAD behavior, all nine media files and their hashes, incomplete-publication rejection, unknown scopes, analytics deduplication and malformed JSON.
- **Worker**: strict TypeScript compilation, manifest contract checks and three job-contract smoke cases. These use fake storage/database/image adapters and do not demonstrate a running distributed queue.
- **Image processing**: a separate smoke check executes the real Sharp adapter for JPEG normalization, WebP optimization and thumbnail dimensions.
- **Dependency audit**: npm reported zero known vulnerabilities after updating Sharp, file-type and esbuild. This is a dated dependency observation, not a security certification.

GitHub Actions repeats the platform checks using Node 22. Unity checks are local because no Unity CI license is configured. No Unity CI badge is implied by the platform badge.

Not established: Android/iOS builds, real camera recognition, tracking stability, real image/video/model rendering in Unity, performance on hardware, persistent authentication/storage, R2/Supabase/Redis integration, or full dashboard workflow acceptance.

The May 2026 notes describe earlier experiments and intended design. They are historical context, not a replacement for this publication's checks.
