# Third-party notices

- Unity Engine and Unity Package Manager dependencies (AR Foundation, ARCore/ARKit providers, XR Management, URP, Input System and test framework) retain Unity's applicable licenses. `Packages/manifest.json` and `packages-lock.json` declare those dependencies; their implementation is not vendored here.
- npm dependencies retain their individual licenses. Exact versions are recorded in `Plattform/worker/package-lock.json` and installed with `npm ci`.
- Synthetic fixture images are original generated data. The tiny video contains only an FFmpeg-generated test pattern. FFmpeg is used as an external executable and is not redistributed.
- Optional OpenCV and ARCore image-quality command-line tools are separate dependencies. Their binaries and data sets are not included.
- Commercial Makaka, Imagine and OpenCV for Unity packages from the original experiment folder are excluded. References in old design notes explain prior evaluation, not bundled code or authorship.
