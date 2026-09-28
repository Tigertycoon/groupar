> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Unity Vertical Slice Result

Datum: 2026-05-30

## Kurzfazit

Der Flow ist bis zum Unity-Runtime-Aufbau im Editor nachgewiesen:

Backend Manifest -> ARPlayerManifestLoader -> ARPlayerRuntimeImageLibrary -> target_add telemetry -> Content-Resolve -> Debug-Render.

Der echte Kamera-/Device-Scan eines gedruckten oder auf einem zweiten Bildschirm gezeigten Triggerbilds wurde in dieser Umgebung nicht physisch ausgefuehrt. Stattdessen wurde ein erfolgreicher Router-Test mit einem simulierten `ARTrackedImage` gegen den echten Runtime-Target- und Content-Index ausgefuehrt.

## Backend

- Gestartet aus `Plattform` mit `npm run dev`.
- Server: `http://0.0.0.0:8787`
- Healthcheck: `{"status":"ok","fixture":"Plattform\\fixtures\\manifest-test-group-local.json"}`
- Manifest-Endpoint: `http://127.0.0.1:8787/groups/grp_fixture_ar_test/manifest`
- Manifest-Smoke: `schemaVersion=1.0`, `manifestVersion=1`, `targets=4`, `content=5`
- Fixture-Contract-Check: `node scripts/check-contract-fixtures.mjs` aus `Plattform/worker` erfolgreich.

Hinweis: Die Unity-Szene war noch auf `/api/v1/groups/.../manifest` konfiguriert. Fuer den lokalen Slice wurde `ARPlayerManifestLoader.manifestUrl` auf die tatsaechlich laufende Route `/groups/grp_fixture_ar_test/manifest` gesetzt und die Szene gespeichert.

## Unity Evidence

- Szene via GladeKit geoeffnet: `Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity`
- Verifier-Artefakt: `Logs/unity-vertical-slice-editor-verifier.md`
- Runtime-Log: `Logs/unity-vertical-slice-runtime.log`
- Play-Mode-Screenshot: `Logs/unity-vertical-slice-playmode.png`
- Fixture-Triggerbild-Kopie: `Logs/unity-vertical-slice-trigger-trg_fixture_feature_box.png`

Wichtige Runtime-Werte aus dem Verifier:

- `SchemaVersion: 1.0`
- `ManifestVersion: 1`
- `GroupId: grp_fixture_ar_test`
- `IsReady: True`
- `TargetsById.Count: 4`
- `ContentById.Count: 5`
- `ARPlayerTelemetry.StatusCounts: {Success: 4}`

Relevante Logauszuege:

```text
[GroupAR] Loading AR manifest.
[GroupAR] Runtime image library ready.
[GroupAR] Target added: trg_fixture_feature_box -> med_fixture_box_scene_image.
[GroupAR] Target added: trg_fixture_scene_box -> med_fixture_logo_debug_image.
[GroupAR] Target added: trg_fixture_person_video -> med_fixture_person_video.
[GroupAR] Target added: trg_fixture_text_debug -> med_fixture_text_debug_image.
[GroupAR] All runtime AR targets processed.
[GroupAR] Showing image content 'med_fixture_box_scene_image' for target 'trg_fixture_feature_box'.
```

Telemetry-Events:

- `target_add_started`: 4
- `target_add_completed`: 4
- `target_add_failed`: 0
- Terminal status counts: `{Success: 4}`

## Tracking / Content Resolve

Das Fixture-Triggerbild fuer `trg_fixture_feature_box` liegt unter:

`Logs/unity-vertical-slice-trigger-trg_fixture_feature_box.png`

Der Verifier hat ein simuliertes `ARTrackedImage` mit `referenceImage.name = trg_fixture_feature_box` gegen den echten Runtime-Index geroutet:

```text
trg_fixture_feature_box -> primaryContentId med_fixture_box_scene_image -> content(type=image)
```

Der Router erzeugte ein aktives Render-Objekt:

```text
AR Content - med_fixture_box_scene_image
```

Das beweist die Content-Aufloesung und den Debug-Render-Pfad. Es ersetzt keinen realen Kamera-Scan auf ARCore/ARKit-Hardware.

## Renderer-Luecke

Echte Image-/Video-/Model-Renderer sind weiterhin Platzhalter bzw. nicht als echte Medienrenderer nachgewiesen. Der aktuelle Nachweis rendert Debug-/Stub-Content, nicht das eigentliche Bild, Video oder 3D-Modell aus der Content-URL.

Der Debug-Renderer/Fallback gilt fuer diesen Slice als erster Render-Nachweis. Die Produktionsluecke bleibt:

- Image-Content muss noch als Textur/Plane aus `content.url` gerendert werden.
- Video-Content muss noch ueber VideoPlayer/Material gerendert werden.
- Model3D-Content muss noch geladen, skaliert und platziert werden.

## Ampel

| Bereich | Status | Nachweis |
| --- | --- | --- |
| Manifest Load | Gruen | Backend live, Manifest erreichbar, Unity Loader hat Manifest v1 angewendet. |
| Target Add | Gruen | Runtime Image Library verarbeitete 4 Targets, `StatusCounts {Success: 4}`. |
| Tracking | Gelb | Simulierter `ARTrackedImage`-Router-Test erfolgreich; kein physischer Kamera-/Device-Scan. |
| Content Resolve | Gruen | `trg_fixture_feature_box -> med_fixture_box_scene_image -> content(type=image)` aufgeloest. |
| Content Render | Gelb | Aktives Debug-/Fallback-Objekt gerendert; echte Medienrenderer noch Platzhalter. |
