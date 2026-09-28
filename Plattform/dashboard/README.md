# Dashboard prototype

Start `npm --prefix Plattform start` from the repository root and open http://localhost:8787/.

The German interface illustrates groups, artworks, draft revisions, trigger/media selection, processing states and publishing. Sign-in and workflow actions are simulated in browser memory. The manifest link points to the local API. The app deep link is an integration placeholder; no external QR service is called.

Use the fixture sign-in values. No account is created and uploads are not sent to cloud storage. File names containing `warn`, `fail` or `error` drive the simulated processing outcomes.

See the root README and `docs/architecture.md` for implemented boundaries.
