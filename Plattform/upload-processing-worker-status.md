> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Upload-/Processing-Worker MVP Status

Stand: 2026-05-30

Quelle der Wahrheit:

- `Plattform/contracts.md`
- `Plattform/processing-worker-uploads.md`
- `Plattform/fixtures/manifest-test-group-v1.json`
- `Plattform/static-test-manifest-r2.md`

Wichtig: Der Worker produziert Daten fuer das Contract-Manifest. Er erzeugt kein eigenes Manifest-Format.

## Kurzstatus

| Bereich | Status |
| --- | --- |
| Worker-Package unter `Plattform/worker` | fertig als MVP-Scaffold |
| Contract-nahe Typen | fertig |
| Derivative Object-Key Builder | fertig |
| SHA-256, byteSize, contentType | fertig |
| PNG/JPEG/WebP width/height Probe | fertig |
| Trigger-Normalisierung | fertig, benoetigt `sharp` |
| Trigger-Thumbnail | fertig, benoetigt `sharp` |
| OpenCV-Heuristiken | vorbereitet, nutzt optional Python + OpenCV |
| arcoreimg | optionaler Hook vorbereitet |
| Image-Optimierung | fertig, benoetigt `sharp` |
| Video-Transcoding | vorbereitet, benoetigt `ffmpeg` |
| GLB-Basisvalidierung | fertig fuer Magic/Version/Groesse |
| BullMQ Queue Adapter | vorbereitet |
| Datenhygiene fuer Manifest-Rebuild | fertig |
| Worker-Job-Smoke-Tests | fertig |
| Supabase/Postgres Adapter | offen |
| Cloudflare R2 Adapter | offen |
| Manifest-Rebuild | nicht Teil dieses Upload-Workers; nutzt die erzeugten Derivatives |

## Verifikation

Ausgefuehrt am 2026-05-30:

```txt
cd Plattform/worker
npm run check
npm run build
npm run check:fixtures
npm run check:jobs
```

Ergebnis:

- TypeScript-Check: bestanden.
- Build: bestanden.
- Fixture-Contract-Check: bestanden.
- Worker-Job-Contract-Smoke-Check: bestanden.
- Der neue Smoke-Check prueft, dass `asset_derivatives` processed Bytes/SHA/URL enthalten, Parent-Zeilen Raw-Bytes/SHA ohne processed `cdn_url` behalten und Wrong-Job-Type-Fehler `processing_jobs.status = failed_permanent` setzen.
- `dist` wurde durch den Build aktualisiert; `node_modules` war bereits vorhanden.

## Implementierte Dateien

```txt
Plattform/worker/package.json
Plattform/worker/tsconfig.json
Plattform/worker/Dockerfile
Plattform/worker/README.md
Plattform/worker/src/contracts/types.ts
Plattform/worker/src/contracts/objectKeys.ts
Plattform/worker/src/db/ProcessingDatabase.ts
Plattform/worker/src/storage/Storage.ts
Plattform/worker/src/storage/LocalStorage.ts
Plattform/worker/src/media/fileInfo.ts
Plattform/worker/src/media/ImageProcessor.ts
Plattform/worker/src/media/quality.ts
Plattform/worker/src/tools/opencv.ts
Plattform/worker/src/tools/arcoreimg.ts
Plattform/worker/src/tools/ffmpeg.ts
Plattform/worker/src/tools/glb.ts
Plattform/worker/src/jobs/triggerValidate.ts
Plattform/worker/src/jobs/imageOptimize.ts
Plattform/worker/src/jobs/videoTranscode.ts
Plattform/worker/src/jobs/modelValidate.ts
Plattform/worker/src/jobs/router.ts
Plattform/worker/src/queue/bullmq.ts
Plattform/worker/scripts/opencv_analyze.py
Plattform/worker/scripts/check-contract-fixtures.mjs
Plattform/worker/scripts/check-worker-job-contracts.mjs
```

## Contract Issues

### Contract Issue 1: `processed` vs. kanonischer Status `ready`

Aufgabenformulierung nennt:

```txt
uploaded -> processing -> processed/failed
```

`Plattform/contracts.md` definiert fuer `trigger_images`, `media_assets` und `asset_derivatives` aber:

```txt
upload_pending
uploaded
queued
processing
ready
needs_manual_review
rejected
failed_retryable
failed_permanent
superseded
deleted
```

Vorschlag:

- Im Code und in der DB nur Contract-Status verwenden.
- `processed` hoechstens als UI-Label oder API-Alias fuer `ready` verwenden.
- Kein neuer DB-Status `processed`, solange `contracts.md` nicht explizit geaendert wird.

Umsetzung im Worker:

- Erfolgreich verarbeitete Assets werden `ready`.
- Technisch fertige, aber abgelehnte Trigger werden `rejected`.
- Tool-/Infrastrukturfehler werden `failed_retryable` oder spaeter `failed_permanent`.

### Contract Issue 2: Image-Derivative-Pfade sind im Contract nicht vollstaendig ausgeschrieben

`contracts.md` definiert diese Image-Derivative-Kinds:

```txt
image.optimized_2048
image.optimized_1024
image.thumbnail_512
```

Die R2 Object Key Convention in `contracts.md` listet aber bei Media-Derivatives nur Video, Thumbnail und Model explizit. Fuer Image-Optimierung ist kein vollstaendiger Pfad aufgefuehrt.

Vorschlag:

```txt
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/image_2048.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/image_1024.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/thumb_512.webp
```

Umsetzung im Worker:

- Der Worker nutzt diese Pfade, weil `processing-worker-uploads.md` und die Fixture-Logik sie bereits vorzeichnen.
- `contracts.md` wurde nicht still geaendert.

### Contract Issue 3: `quality.arcoreScore` Optionalitaet

`contracts.md` zeigt `quality.arcoreScore` im Manifest-Beispiel als Zahl. Gleichzeitig soll `arcoreimg` im Worker optional sein.

Vorschlag:

- Im DB-Report `arcoreScore: null` erlauben, wenn `arcoreimg` nicht installiert ist.
- Manifest-Rebuild sollte `arcoreScore` nur ausgeben, wenn ein valider Score vorliegt, oder der Contract sollte `null` explizit erlauben.

Umsetzung im Worker:

- Der Hook ist optional.
- Wenn `arcoreimg` fehlt, schreibt der Worker `arcoreimg_unavailable` in `quality_report.warnings`.
- Der Upload-Worker erzeugt noch kein Manifest und erzwingt daher keine neue Manifest-Struktur.

## Flow

API-seitiger Upload-Flow:

```txt
upload_pending
-> uploaded
-> queued
```

Worker-Flow:

```txt
queued
-> processing
-> ready | needs_manual_review | rejected | failed_retryable | failed_permanent
```

`processing_jobs.status`:

```txt
queued
-> running
-> succeeded | failed_retryable | failed_permanent | cancelled | dead_letter
```

Der Worker prozessiert nicht synchron im API-Request. Die API legt `processing_jobs` an und enqueued einen BullMQ-Job. Der Worker holt den Job asynchron aus `media-light` oder `media-heavy`.

## Datenhygiene fuer Manifest-Rebuild

`asset_derivatives` ist die kanonische Quelle fuer alle verarbeiteten Worker-Outputs. Die Felder `cdn_url`, `mime_type`, `bytes`, `sha256`, Dimensionen und Dauer in `asset_derivatives` kommen vom tatsaechlich erzeugten Output.

`trigger_images` und `media_assets` behalten im Worker nur Raw-Dateimetadaten, die zu `storage_key_original` gehoeren. Die Jobs setzen `storage_key_processed` und `cdn_url` auf `null`, damit keine processed URL mit Raw-`sha256` oder Raw-`bytes` in derselben Parent-Zeile steht. Manifest-Rebuilds duerfen processed Manifestdaten daher aus `asset_derivatives` lesen, nicht aus den Parent-Tabellen.

Wrong-Job-Type-Faelle werden permanent abgeschlossen:

- falscher `target_type` fuer `trigger.validate`, `image.optimize`, `video.transcode` oder `model.validate`
- falscher `media_assets.asset_type` fuer Image-, Video- oder Model-Jobs
- `manifest.rebuild`, wenn es versehentlich im Upload-Worker landet

In diesen Faellen setzt der Worker `processing_jobs.status = failed_permanent`; wenn das Zielobjekt bereits geladen wurde, wird auch dessen `processing_status` auf `failed_permanent` gesetzt.

## Triggerbild-Job

Job:

```txt
trigger.validate
```

Input:

- `target_type = trigger_image`
- `target_id = trigger_images.id`
- `trigger_images.storage_key_original`

Fertig:

- Raw-Datei herunterladen.
- SHA-256 berechnen.
- `byteSize`, `contentType`, `width`, `height` ermitteln.
- Trigger mit `sharp` nach sRGB/JPEG normalisieren.
- Thumbnail erzeugen.
- `asset_derivatives.kind = trigger.normalized` schreiben.
- `asset_derivatives.kind = trigger.thumbnail` schreiben.
- `trigger_images` behaelt Raw-Metadaten zu `storage_key_original`; processed Output-Metadaten stehen in `asset_derivatives`.
- OpenCV-Hook fuer Blur/Kontrast/Feature Count vorbereiten.
- arcoreimg-Hook vorbereiten.
- `quality_report` mit `status`, `score`, `warnings`, `arcoreScore`, `blurScore`, `contrastScore`, `featureCount` schreiben.

Stub:

- OpenCV laeuft nur, wenn Python + `cv2` im Runtime-Image verfuegbar sind.
- arcoreimg laeuft nur, wenn `ARCOREIMG_PATH` gesetzt ist oder `arcoreimg` im PATH liegt.

## Image-Job

Job:

```txt
image.optimize
```

Input:

- `target_type = media_asset`
- `target_id = media_assets.id`
- `media_assets.asset_type = image`

Fertig:

- Raw-Datei herunterladen.
- SHA-256, `byteSize`, `contentType`, `width`, `height` ermitteln.
- `image.optimized_2048` mit `sharp` erzeugen.
- `image.thumbnail_512` mit `sharp` erzeugen.
- `asset_derivatives` fuer beide Outputs schreiben.
- `media_assets` behaelt Raw-Metadaten zu `storage_key_original`; processed Output-Metadaten stehen in `asset_derivatives`.

Stub/offen:

- `image.optimized_1024` ist als Contract-Kind vorhanden, aber im MVP-Job noch nicht standardmaessig erzeugt.
- Ob `image_2048.webp` offiziell im Contract ergaenzt wird, ist Contract Issue 2.

## Video-Job

Job:

```txt
video.transcode
```

Input:

- `target_type = media_asset`
- `target_id = media_assets.id`
- `media_assets.asset_type = video`

Vorbereitet:

- Raw-Datei herunterladen.
- SHA-256 und `byteSize` ermitteln.
- FFmpeg-Plan fuer H.264 MP4 mit `+faststart`.
- Thumbnail-Plan fuer `video.thumbnail_512`.
- `asset_derivatives.kind = video.mp4_1080p`.
- `asset_derivatives.kind = video.thumbnail_512`.
- `media_assets` behaelt Raw-Metadaten zu `storage_key_original`; processed Output-Metadaten stehen in `asset_derivatives`.

Stub/offen:

- Dauer/Framerate/Codec-Details brauchen noch `ffprobe`.
- Job laeuft nur, wenn `ffmpeg` installiert ist oder `FFMPEG_PATH` gesetzt ist.
- Harte Limits aus dem Contract muessen im finalen DB/API-Layer vor und im Worker nochmals waechterartig geprueft werden.

## GLB-Job

Job:

```txt
model.validate
```

Input:

- `target_type = media_asset`
- `target_id = media_assets.id`
- `media_assets.asset_type = model3d`

Fertig:

- Datei herunterladen.
- SHA-256, `byteSize`, `contentType` ermitteln.
- GLB Magic `glTF` pruefen.
- GLB Version 2 pruefen.
- deklarierte GLB-Laenge gegen Dateigroesse pruefen.
- Groessenlimit 50 MB pruefen.
- `asset_derivatives.kind = model.glb_validated` schreiben.
- `media_assets` behaelt Raw-Metadaten zu `storage_key_original`; validierter Output steht in `asset_derivatives`.

Stub/offen:

- `gltf-validator` ist noch nicht verdrahtet.
- Triangle Count, Texturanzahl und Texturgroessen sind noch offen.
- Fixture enthaelt noch keine GLB-Datei.

## Queue

Fertig:

- BullMQ Adapter in `src/queue/bullmq.ts`.
- Queue-Routing:
  - `media-light`: `trigger.validate`, `image.optimize`, `model.validate`
  - `media-heavy`: `video.transcode`
  - `manifest`: `manifest.rebuild`
- Retry-/Backoff-Konfiguration vorbereitet.

Offen:

- Redis-URL und Worker-Prozess-Deployment.
- Supabase/Postgres DB-Adapter.
- Cloudflare R2 Storage-Adapter.
- Manifest-Worker fuer `manifest.rebuild`.

## Wie aus `ready` Assets ein manifestfaehiger `asset_derivatives`-Datensatz entsteht

Beispiel `trigger.normalized`:

```json
{
  "org_id": "org_fixture_school",
  "group_id": "grp_fixture_ar_test",
  "trigger_image_id": "tri_fixture_feature_box_001",
  "media_asset_id": null,
  "kind": "trigger.normalized",
  "storage_key": "derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.jpg",
  "cdn_url": "https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.jpg",
  "mime_type": "image/jpeg",
  "width": 1600,
  "height": 1200,
  "bytes": 421234,
  "sha256": "77bb7f7a...",
  "metadata": {
    "sourceSha256": "raw-file-sha256"
  },
  "processing_status": "ready"
}
```

Manifest-Rebuild verwendet diesen Datensatz fuer:

```txt
targets[].image.url
targets[].image.contentType
targets[].image.width
targets[].image.height
targets[].image.byteSize
targets[].image.sha256
```

Beispiel `video.mp4_1080p`:

```json
{
  "org_id": "org_fixture_school",
  "group_id": "grp_fixture_ar_test",
  "trigger_image_id": null,
  "media_asset_id": "med_fixture_person_video",
  "kind": "video.mp4_1080p",
  "storage_key": "derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_video/video_1080p.mp4",
  "cdn_url": "https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_video/video_1080p.mp4",
  "mime_type": "video/mp4",
  "bytes": 3483280,
  "sha256": "395cc487...",
  "metadata": {
    "sourceSha256": "raw-file-sha256"
  },
  "processing_status": "ready"
}
```

Manifest-Rebuild verwendet diesen Datensatz fuer:

```txt
content[].contentId = media_assets.id
content[].url = asset_derivatives.cdn_url
content[].contentType = asset_derivatives.mime_type
content[].byteSize = asset_derivatives.bytes
content[].sha256 = asset_derivatives.sha256
targets[].contentIds[] = media_assets.id values of the revision
targets[].primaryContentId = primary media_assets.id
```

## Keine eigene Manifest-Struktur

Der Worker erzeugt keine verschachtelten Content-Arrays direkt in Targets, keine alternative Content-ID neben `contentId`, keine alternative Top-Level-Asset-Liste und kein paralleles Upload-/Manifest-Modell.

Das Manifest bleibt exakt der Contract:

```txt
Top-Level content[]
Top-Level targets[]
targets[].contentIds[]
targets[].primaryContentId
content[].contentId
```

## Naechste Schritte

1. `npm install` in `Plattform/worker` ausfuehren.
2. Supabase/Postgres Adapter fuer `ProcessingDatabase` implementieren.
3. Cloudflare R2 Adapter fuer `ObjectStorage` implementieren.
4. FFprobe-Metadaten fuer Video ergaenzen.
5. `gltf-validator` fuer GLB ergaenzen.
6. Docker-Image mit `arcoreimg` legal/technisch klaeren und einbauen.
7. Manifest-Worker separat auf Basis der erzeugten `asset_derivatives` bauen.
