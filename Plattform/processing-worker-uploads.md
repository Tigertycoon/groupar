> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Processing-Worker fuer Uploads

Stand: 2026-05-30

## Ziel

Uploads werden asynchron verarbeitet, geprueft und in eine Form gebracht, die von der mobilen Unity-App ohne App-Rebuild genutzt werden kann.

Die Architektur folgt der Grundentscheidung: Es gibt keine globale Erkennungsdatenbank. Stattdessen werden Trigger, Medien und Manifeste pro Organisation und Gruppe gescoped. Die Unity-App laedt nach Login nur die Gruppen-Manifeste, fuer die der User Zugriff hat, und baut bzw. aktualisiert daraus lokal die Runtime Image Library.

Dieses Dokument ist auf den kanonischen DB-Vertrag gemappt und fuehrt kein paralleles Upload- oder Manifest-Modell ein.

## Geplanter Stack

- Frontend: Next.js + TypeScript
- Auth und Datenbank: Supabase Auth + Postgres
- API: eigene API-Schicht
- Storage: Cloudflare R2 + CDN
- Queue: Redis + BullMQ
- Worker: Docker mit FFmpeg, OpenCV, arcoreimg und glTF-Tools
- Unity: eigener AR Foundation Player
- Makaka/Imagine: nur Referenz oder selektive UI-/UX-Bausteine, keine feste Architekturgrundlage

## Grundprinzipien

- Die API und Postgres sind Source of Truth.
- Redis/BullMQ ist nur fuer Job-Orchestrierung zustaendig.
- R2 speichert rohe Uploads und abgeleitete Dateien.
- Worker sind stateless und horizontal skalierbar.
- Jeder Job ist ueber `org_id`, `group_id`, `target_type` und `target_id` gescoped.
- Uploads haengen an einer `artwork_revision`.
- Trigger-Uploads werden in `trigger_images` gespeichert.
- Content-Uploads werden in `media_assets` gespeichert.
- Abgeleitete Dateien werden in `asset_derivatives` gespeichert.
- Manifest-Rebuilds erzeugen neue `manifest_versions`.
- Eine `artwork_revision` darf erst published werden, wenn ihre benoetigten Trigger und Medien technisch `ready` sind oder bewusst ueber Review-Regeln behandelt wurden.

## Komponenten

### API

Aufgaben:

- Upload-Sessions erzeugen
- Presigned Uploads fuer R2 ausgeben
- `artworks` und `artwork_revisions` verwalten
- `trigger_images` und `media_assets` in Postgres anlegen
- `processing_jobs` in Postgres und BullMQ-Jobs erzeugen
- Review- und Publish-Workflow auf `artwork_revisions` steuern
- Manifest-Rebuilds nach Publish/Unpublish anstossen
- Zugriff auf Gruppen, Rollen und Subaccounts pruefen

### Worker

Aufgaben:

- Jobs aus BullMQ abarbeiten
- Zielobjekt aus Postgres laden
- Rohdateien aus R2 herunterladen
- Dateien pruefen und verarbeiten
- `asset_derivatives` nach R2 schreiben
- Metadaten, Scores, Warnings und Fehler in Postgres speichern
- Retrybare und permanente Fehler unterscheiden
- `manifest_versions` deterministisch neu erzeugen

### Storage

Empfohlenes Object-Key-Schema:

```txt
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/original.ext
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/original.ext
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/trigger_normalized.jpg
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/image_2048.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/video_1080p.mp4
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/model.glb
manifests/{orgId}/{groupId}/manifest-v{manifestVersion}.json
manifests/{orgId}/{groupId}/latest.json
```

`storage_key_original` liegt auf `trigger_images` oder `media_assets`. Primaere verarbeitete Dateien koennen zusaetzlich in `storage_key_processed`/`cdn_url` gespiegelt werden. Alle abgeleiteten Outputs werden als `asset_derivatives` dokumentiert.

## Queues

Empfohlene BullMQ-Queues:

| Queue | Zweck |
| --- | --- |
| `media-light` | Trigger-Pruefung, Bildoptimierung, 3D-Validierung |
| `media-heavy` | Video-Transcoding und rechenintensive Medienjobs |
| `manifest` | Manifest-Rebuilds pro Gruppe |
| `dead-letter` | dauerhaft fehlgeschlagene Jobs zur manuellen Pruefung |

Die Trennung verhindert, dass grosse Videojobs kleine Trigger- oder Bildjobs blockieren.

## Job-Typen

Kanonische Dot-Notation:

```ts
type JobType =
  | "trigger.validate"
  | "image.optimize"
  | "video.transcode"
  | "model.validate"
  | "manifest.rebuild";
```

Mapping auf Zieltabellen:

| Job-Typ | `target_type` | `target_id` |
| --- | --- | --- |
| `trigger.validate` | `trigger_image` | `trigger_images.id` |
| `image.optimize` | `media_asset` | `media_assets.id` mit `asset_type = 'image'` |
| `video.transcode` | `media_asset` | `media_assets.id` mit `asset_type = 'video'` |
| `model.validate` | `media_asset` | `media_assets.id` mit `asset_type = 'model3d'` |
| `manifest.rebuild` | `group` | `groups.id` |

Minimales Job-Payload:

```json
{
  "jobId": "uuid",
  "processingJobId": "uuid",
  "jobType": "trigger.validate",
  "orgId": "uuid",
  "groupId": "uuid",
  "targetType": "trigger_image",
  "targetId": "uuid",
  "requestedBy": "uuid"
}
```

Der Worker darf dem Queue-Payload nicht blind vertrauen. Er laedt `processing_jobs` und das Zielobjekt aus Postgres und prueft:

- Existiert `processing_jobs.id`?
- Stimmen `job_type`, `target_type` und `target_id`?
- Stimmen `org_id` und `group_id` mit dem Zielobjekt ueberein?
- Gehoert das Zielobjekt zu einer gueltigen `artwork_revision`?
- Ist der Job-Typ fuer diesen Zieltyp erlaubt?
- Wurde dieses Zielobjekt bereits erfolgreich verarbeitet?

## Statusmodell

### Revision Status

Der fachliche Workflow liegt auf `artwork_revisions`, nicht auf einem separaten Asset-Version-Modell.

```txt
draft
in_review
changes_requested
approved
published
superseded
rejected
```

Erlaubte Haupt-Transitions:

```txt
draft -> in_review
in_review -> changes_requested
changes_requested -> draft
in_review -> rejected
in_review -> approved
approved -> published
published -> superseded
```

`artworks` selbst nutzen nur Lifecycle:

```txt
active
archived
deleted
```

### Asset Processing Status

Der technische Status lebt auf `trigger_images`, `media_assets` und ggf. `asset_derivatives`.

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

MVP-Regeln:

- `ready` darf in ein Manifest.
- `needs_manual_review` darf nicht automatisch ins Manifest.
- `rejected`, `failed_retryable`, `failed_permanent` und `deleted` duerfen nie ins Manifest.
- `superseded` bleibt fuer historische Manifeste referenzierbar, wird aber nicht neu publiziert.

### Trigger Quality Status

Die technische Bildqualitaet des Triggerbildes lebt auf `trigger_images.quality_status`.

```txt
pending
passed
warning
failed
```

Mapping aus dem Worker:

| Worker-Ergebnis | `trigger_images.processing_status` | `trigger_images.quality_status` |
| --- | --- | --- |
| ARCore Score >= 75 und Checks ok | `ready` | `passed` |
| ARCore Score 50-74 oder technische Warnung | `needs_manual_review` | `warning` |
| ARCore Score < 50 oder harter Fehler | `rejected` | `failed` |

### Job Status

Der operative Status lebt in `processing_jobs`.

```txt
queued
running
succeeded
failed_retryable
failed_permanent
cancelled
dead_letter
```

## DB-Vertrag und Mapping

Der Worker nutzt die kanonischen Tabellen aus `contracts.md` und `postgres-datenmodell.md`.

| Fachliches Konzept | Kanonische Tabelle |
| --- | --- |
| Stabiles AR-Objekt | `artworks` |
| Upload-/Review-/Publish-Version | `artwork_revisions` |
| Triggerbild einer Revision | `trigger_images` |
| AR-Content einer Revision | `media_assets` |
| Worker-Output wie Thumbnail, normalisierter Trigger, transcodiertes Video | `asset_derivatives` |
| Queue-nahe Audit- und Statusquelle | `processing_jobs` |
| Gruppenmanifest-Snapshot | `manifest_versions` |

Es werden keine alternativen Tabellen fuer Upload-Versionen oder Gruppenmanifest-Snapshots eingefuehrt.

### `trigger_images`

Wichtige Worker-Felder:

- `id`
- `artwork_revision_id`
- `artwork_id`
- `org_id`
- `group_id`
- `storage_key_original`
- `storage_key_processed`
- `cdn_url`
- `mime_type`
- `width`
- `height`
- `bytes`
- `sha256`
- `physical_width_m`
- `target_key`
- `quality_status`
- `quality_score`
- `quality_report`
- `processing_status`

`target_key` ist der stabile Unity-`targetId`. `trigger_images.id` ist revisions-/upload-spezifisch und darf nicht als Unity-Target-ID verwendet werden.

### `media_assets`

Wichtige Worker-Felder:

- `id`
- `artwork_revision_id`
- `artwork_id`
- `org_id`
- `group_id`
- `asset_type`: `image`, `video`, `model3d`, `audio`, `thumbnail`
- `storage_key_original`
- `storage_key_processed`
- `cdn_url`
- `mime_type`
- `bytes`
- `sha256`
- `width`
- `height`
- `duration_seconds`
- `processing_status`
- `processing_report`
- `metadata`

### `asset_derivatives`

`asset_derivatives` ist im MVP Teil des Modells, weil der Worker mehrere Outputs erzeugt:

- normalisierte Triggerbilder
- Thumbnails
- optimierte Bilder
- transcodierte Videos
- validierte oder spaeter optimierte 3D-Dateien

Die Derivatives verweisen genau auf ein Quellobjekt: entweder `trigger_image_id` oder `media_asset_id`.

Empfohlene Felder fuer Worker-Zwecke:

- `id`
- `org_id`
- `group_id`
- `trigger_image_id`
- `media_asset_id`
- `kind`: `trigger.normalized`, `trigger.thumbnail`, `image.optimized_2048`, `image.optimized_1024`, `image.thumbnail_512`, `video.mp4_1080p`, `video.thumbnail_512`, `model.glb_validated`
- `storage_key`
- `cdn_url`
- `mime_type`
- `width`
- `height`
- `duration_seconds`
- `bytes`
- `sha256`
- `metadata`
- `processing_status`
- `created_at`

### `processing_jobs`

Wichtige Worker-Felder:

- `id`
- `org_id`
- `group_id`
- `job_type`
- `target_type`
- `target_id`
- `status`
- `priority`
- `attempts`
- `max_attempts`
- `run_after`
- `locked_by`
- `locked_at`
- `input`
- `output`
- `error_message`
- `idempotency_key`
- `started_at`
- `finished_at`

BullMQ bleibt die operative Queue. Postgres bleibt Audit- und Statusquelle.

### `manifest_versions`

Wichtige Worker-Felder:

- `id`
- `org_id`
- `group_id`
- `version_no`
- `status`
- `schema_version`
- `min_app_version`
- `previous_manifest_version_id`
- `storage_key`
- `cdn_url`
- `etag`
- `sha256`
- `manifest_json`
- `trigger_count`
- `asset_count`
- `bytes_total`
- `is_current`
- `created_by`
- `published_at`
- `revoked_at`

Beim erfolgreichen Manifest-Rebuild wird ausserdem `groups.current_manifest_version_id` auf die neue `manifest_versions.id` gesetzt.

## Idempotenz und Locks

Jeder Worker-Job muss idempotent sein.

Empfohlene Regeln:

- Pro `processing_jobs.target_type + target_id + job_type` darf nur ein verarbeitender Job aktiv sein.
- Vor Verarbeitung DB-Lock oder Advisory Lock auf das Zielobjekt nehmen.
- Wenn das Zielobjekt bereits `processing_status = ready` hat, Job sauber als `succeeded` beenden.
- Wenn die zugehoerige `artwork_revision` `superseded`, `rejected` oder geloescht ist, Job als `cancelled` beenden.
- Derivative Object-Keys duerfen deterministisch aus `artwork_revision_id`, `trigger_image_id` oder `media_asset_id` und `kind` entstehen.
- Manifest-Rebuilds erhalten einen Group-Level Lock auf `group_id`.
- Mehrere Publish-Events duerfen zu einem einzigen Manifest-Rebuild zusammengefasst werden.

## Allgemeiner Worker-Ablauf

1. Job aus Queue lesen.
2. `processing_jobs.status` auf `running` setzen.
3. Zielobjekt aus Postgres laden.
4. Scope validieren: `org_id`, `group_id`, `target_type`, `target_id`.
5. Zugehoerige `artwork_revision` laden und pruefen.
6. Lock nehmen.
7. Zielobjekt auf `processing_status = processing` setzen.
8. Raw-Datei aus `storage_key_original` in temporaeres Worker-Verzeichnis laden.
9. SHA-256, MIME-Sniffing und Groessenpruefung ausfuehren.
10. Spezifische Verarbeitung je Job-Typ ausfuehren.
11. Derivatives nach R2 schreiben.
12. `asset_derivatives`, Zielobjekt-Reports und Metadaten in Postgres speichern.
13. Zielobjekt auf `ready`, `needs_manual_review`, `rejected`, `failed_retryable` oder `failed_permanent` setzen.
14. Lock freigeben.
15. `processing_jobs.status` auf `succeeded`, `failed_retryable`, `failed_permanent`, `cancelled` oder `dead_letter` setzen.

## Job 1: Triggerbild pruefen

Job-Typ:

```txt
trigger.validate
```

Ziel:

Das Triggerbild soll mit AR Foundation/ARCore robust lokal erkennbar sein und fuer die Runtime Image Library geeignet sein.

Zieltabelle:

```txt
trigger_images
```

### Checks

Datei:

- Echtes Format per MIME-Sniffing pruefen.
- Erlaubt: JPG, PNG, WebP.
- Dekodierbarkeit pruefen.
- Maximalgroesse einhalten.
- EXIF und unnoetige Metadaten entfernen.

Aufloesung:

- Kurze Seite mindestens 640 px.
- Lange Seite maximal 4096 px im MVP.
- Seitenverhaeltnis nicht extremer als ca. 1:3 bis 3:1.

OpenCV-Vorpruefung:

- Blur-Score, z. B. Laplacian Variance.
- Kontrastscore, z. B. Histogramm-Standardabweichung.
- Feature Count, z. B. ORB/AKAZE-Keypoints.
- Warnung bei grossen homogenen Flaechen.
- Warnung bei stark repetitiven Mustern.
- Warnung bei sehr textlastigen oder spiegelnden Motiven.

ARCore:

- `arcoreimg eval-img` ausfuehren.
- Score speichern.
- Score in Entscheidung einbeziehen.

### Beispiel-Ergebnis

Das Ergebnis wird in `trigger_images.quality_report`, `trigger_images.quality_score`, `trigger_images.quality_status` und `trigger_images.processing_status` geschrieben.

```json
{
  "width": 1200,
  "height": 900,
  "aspectRatio": 1.33,
  "blurScore": 142.2,
  "contrastScore": 38.5,
  "featureCount": 620,
  "arcoreScore": 82,
  "decision": "ready",
  "warnings": []
}
```

### MVP-Regeln

| Regel | `processing_status` | `quality_status` |
| --- | --- | --- |
| `arcoreScore >= 75` und Checks ok | `ready` | `passed` |
| `arcoreScore >= 50 && < 75` | `needs_manual_review` | `warning` |
| `arcoreScore < 50` | `rejected` | `failed` |
| zu kleine Aufloesung | `rejected` | `failed` |
| extreme Aspect Ratio | `rejected` | `failed` |
| deutlich unscharf | `rejected` oder `needs_manual_review` | `failed` oder `warning` |
| zu wenig Kontrast | `rejected` oder `needs_manual_review` | `failed` oder `warning` |

Die OpenCV-Schwellwerte sollten mit echten Testbildern kalibriert werden. Der ARCore-Score ist ein guter MVP-Indikator, ersetzt aber nicht vollstaendig visuelle Review-Regeln.

### Outputs

- Normalisiertes Triggerbild als `asset_derivatives.kind = 'trigger.normalized'`.
- Thumbnail als `asset_derivatives.kind = 'trigger.thumbnail'`.
- Primaerer Trigger-Output optional gespiegelt in `trigger_images.storage_key_processed` und `trigger_images.cdn_url`.
- Scores und Warnings in `trigger_images.quality_report`.
- Optional spaeter: plattformspezifische Analyse fuer ARKit/ARCore getrennt.

## Job 2: Bild optimieren

Job-Typ:

```txt
image.optimize
```

Zieltabelle:

```txt
media_assets where asset_type = 'image'
```

Ziel:

Hochgeladene Bilder sollen fuer App und Web effizient nutzbar sein, ohne das Original zu verlieren.

### Checks

- Echtes Format per MIME-Sniffing pruefen.
- Erlaubt: JPG, PNG, WebP.
- Dekodierbarkeit pruefen.
- Maximalgroesse und maximale Pixelanzahl pruefen.
- Schutz vor Image-Bombs.
- Farbraum nach sRGB normalisieren.
- EXIF und unnoetige Metadaten entfernen.
- Alpha-Kanal bei PNG/WebP erhalten, wenn relevant.

### Outputs

Empfohlene Derivatives:

```txt
asset_derivatives.kind = image.optimized_2048 -> image_2048.webp
asset_derivatives.kind = image.optimized_1024 -> image_1024.webp
asset_derivatives.kind = image.thumbnail_512  -> thumb_512.webp
```

MVP reicht auch:

```txt
asset_derivatives.kind = image.optimized_2048 -> image_2048.webp
asset_derivatives.kind = image.thumbnail_512  -> thumb_512.webp
```

Primaerer optimierter Output kann in `media_assets.storage_key_processed` und `media_assets.cdn_url` gespiegelt werden. Vollstaendige Verarbeitungsergebnisse landen in `media_assets.processing_report`.

## Job 3: Video transcodieren

Job-Typ:

```txt
video.transcode
```

Zieltabelle:

```txt
media_assets where asset_type = 'video'
```

Ziel:

Videos sollen in einem stabilen, breit unterstuetzten Format fuer mobile Wiedergabe verfuegbar sein.

### Analyse mit `ffprobe`

Zu pruefen:

- Container lesbar
- Video-Codec lesbar
- Dauer
- Aufloesung
- Framerate
- Bitrate
- Audio vorhanden oder nicht
- Dateigroesse

### Transcode mit `ffmpeg`

MVP-Output:

- MP4 Container
- H.264 Video
- `yuv420p`
- AAC Audio, falls Audio vorhanden
- `faststart` fuer progressive Wiedergabe
- maximal 1080p
- Thumbnail aus Sekunde 1 oder bei 10 Prozent der Dauer

Beispiel-Derivatives:

```txt
asset_derivatives.kind = video.mp4_1080p     -> video_1080p.mp4
asset_derivatives.kind = video.thumbnail_512 -> thumb_512.jpg
```

### Beispiel-Metadaten

Das Ergebnis wird in `media_assets.processing_report`, `media_assets.duration_seconds`, `media_assets.width`, `media_assets.height` und `asset_derivatives.metadata` gespeichert.

```json
{
  "durationSec": 24.2,
  "width": 1920,
  "height": 1080,
  "codec": "h264",
  "audioCodec": "aac",
  "sizeBytes": 18200000
}
```

### MVP-Regeln

- Maximal 200 MB Upload.
- Maximal 60 Sekunden Dauer.
- Maximal 1080p Output.
- Videos ohne Audio sind erlaubt.
- Videos mit Audio werden auf AAC normalisiert.
- Nicht dekodierbare Videos werden abgelehnt.

## Job 4: 3D-Datei pruefen

Job-Typ:

```txt
model.validate
```

Zieltabelle:

```txt
media_assets where asset_type = 'model3d'
```

Ziel:

3D-Dateien sollen fuer mobile AR nutzbar, validiert und in ihrer Komplexitaet begrenzt sein.

### MVP-Entscheidung

Fuer das MVP wird GLB empfohlen. glTF mit externen Dateien ist spaeter moeglich, erzeugt aber mehr Fehlerquellen bei Upload, Pfaden, Texturen und CDN-Auslieferung.

### Checks

- Datei ist `.glb`.
- MIME und Dateisignatur plausibel.
- `gltf-validator` erfolgreich.
- Keine externen Remote-URIs.
- Maximalgroesse eingehalten.
- Triangle Count begrenzen.
- Node-/Mesh-/Material-Anzahl begrenzen.
- Texturanzahl und Texturaufloesung begrenzen.
- Animationen erlaubt, aber Anzahl und Dauer begrenzen.
- Keine Pfad-Traversal-Probleme, falls spaeter ZIP/glTF-Pakete erlaubt werden.

### Outputs

MVP:

- Validiertes Original-GLB als `asset_derivatives.kind = 'model.glb_validated'`.
- Primaerer nutzbarer GLB-Key optional gespiegelt in `media_assets.storage_key_processed` und `media_assets.cdn_url`.
- Metadaten zu Groesse, Meshes, Materialien, Texturen, Animationen und Triangles in `media_assets.processing_report`.

Spaeter:

- Draco-Kompression.
- KTX2/BasisU Texturen.
- Automatische LODs.
- Serverseitige Preview-Renderings.

## Job 5: Manifest-Neuberechnung

Job-Typ:

```txt
manifest.rebuild
```

Zieltabelle:

```txt
manifest_versions
```

Ziel:

Nach Publish, Unpublish oder relevanten Aenderungen wird das Gruppen-Manifest neu erzeugt. Die Unity-App kann danach ohne App-Rebuild neue Trigger und Medien laden.

### Trigger fuer Manifest-Rebuild

- `artwork_revision` wird published.
- Published Revision wird superseded.
- Published Revision wird geloescht, archived oder revoked.
- Published Trigger oder Content-Derivative wird neu erzeugt.
- Gruppen-/Rollenmodell aendert sich, sofern Manifest-Inhalt oder Zugriff betroffen ist.

### Ablauf

1. Group-Level Lock auf `group_id` nehmen.
2. Aktuelle `groups.current_manifest_version_id` laden.
3. Published `artwork_revisions` der Gruppe laden.
4. Zugehoerige `trigger_images` mit `processing_status = ready` und `quality_status = passed` laden.
5. Zugehoerige `media_assets` mit `processing_status = ready` laden.
6. Fuer jedes Triggerbild `asset_derivatives.kind = 'trigger.normalized'` mit `processing_status = ready` laden.
7. Fuer jedes Medium den passenden Content-Derivative laden: `image` -> `image.optimized_2048`, `video` -> `video.mp4_1080p`, `model3d` -> `model.glb_validated`.
8. Top-Level-`content[]` aus den manifestfaehigen `media_assets` und ihren Derivatives erzeugen.
9. `content[].contentId` im MVP aus `media_assets.id` setzen; spaeter optional aus `media_assets.content_key`.
10. `content[].url`, `content[].contentType`, `content[].byteSize` und `content[].sha256` aus dem jeweils gewaehlten `asset_derivatives`-Eintrag setzen.
11. `targets[]` aus `trigger_images` erzeugen.
12. `targets[].image` immer aus `asset_derivatives.kind = 'trigger.normalized'` setzen.
13. Pro Target `contentIds[]` aus den zugehoerigen Top-Level-Content-Eintraegen setzen.
14. Pro Target `primaryContentId` setzen: bevorzugt Content mit `role = 'primary'`, sonst erstes deterministisch sortiertes `contentId`.
15. `deletedTargetIds` aus der vorherigen aktuellen Manifest-Version berechnen.
16. Deterministisch sortieren, z. B. `content[]` nach `contentId` und `targets[]` nach `targetId`.
17. Manifest-JSON mit Top-Level-`content[]`, `targets[]` und `deletedTargetIds` erzeugen.
18. `etag` und `sha256` berechnen.
19. Manifest unter versioniertem Object-Key nach R2 schreiben.
20. Optional `latest.json` aktualisieren.
21. Neue Zeile in `manifest_versions` mit `status = published` schreiben.
22. Vorherige aktuelle Manifest-Version auf `superseded` setzen.
23. `groups.current_manifest_version_id = manifest_versions.id` setzen.
24. CDN-Cache fuer `latest.json` invalidieren oder kurze TTL verwenden.

### `deletedTargetIds` Algorithmus

MVP-Algorithmus:

1. Wenn es keine vorherige aktuelle `manifest_versions` gibt, ist `deletedTargetIds = []`.
2. Lade `previousTargetIds` aus `previous_manifest.manifest_json.targets[].targetId`.
3. Baue `nextTargetIds` aus den neu erzeugten `targets[].targetId`.
4. Setze `deletedTargetIds = previousTargetIds - nextTargetIds`.
5. Sortiere `deletedTargetIds` stabil alphabetisch.

Damit landen Targets in `deletedTargetIds`, wenn ihre Revision unpublished, superseded, archived, geloescht oder wegen nicht manifestfaehigem Trigger/Content aus dem neuen Manifest gefallen ist. Wenn derselbe stabile `trigger_images.target_key` in einer neuen Revision wieder erscheint, wird er nicht als geloescht gemeldet.

### Beispiel-Manifest

Das Manifest folgt dem kanonischen Unity-Vertrag: `schemaVersion` ist ein String, Content liegt als Top-Level-`content[]` vor, Targets liegen in `targets[]`, und Targets referenzieren Content nur ueber `contentIds[]` und `primaryContentId`.

```json
{
  "schemaVersion": "1.0",
  "manifestVersion": 42,
  "manifestId": "manifest-uuid",
  "generatedAt": "2026-05-30T12:00:00Z",
  "etag": "grp_example-v42",
  "organization": {
    "id": "org-id",
    "name": "Organisation"
  },
  "group": {
    "id": "group-id",
    "name": "Gruppe"
  },
  "cache": {
    "maxAgeSeconds": 3600,
    "staleWhileRevalidateSeconds": 86400
  },
  "limits": {
    "activeTargetCount": 100,
    "maxMovingImages": 1
  },
  "content": [
    {
      "contentId": "media-asset-id",
      "type": "video",
      "role": "primary",
      "url": "https://cdn.example.com/derived/org/group/artwork/revision/media/media-asset-id/video_1080p.mp4",
      "contentType": "video/mp4",
      "byteSize": 18200000,
      "sha256": "9af1c...",
      "metadata": {
        "placement": "onImage",
        "scale": 1.0,
        "loop": true
      }
    },
    {
      "contentId": "media-thumbnail-id",
      "type": "image",
      "role": "thumbnail",
      "url": "https://cdn.example.com/derived/org/group/artwork/revision/media/media-thumbnail-id/image_2048.webp",
      "contentType": "image/webp",
      "byteSize": 84211,
      "sha256": "1ac88..."
    }
  ],
  "targets": [
    {
      "targetId": "trg_q8s2k1",
      "artworkId": "artwork-id",
      "revisionId": "revision-id",
      "triggerImageId": "trigger-image-id",
      "title": "Example",
      "locale": "de-DE",
      "tags": [],
      "updatedAt": "2026-05-30T12:00:00Z",
      "physicalWidthMeters": 0.18,
      "image": {
        "url": "https://cdn.example.com/derived/org/group/artwork/revision/trigger/trigger-image-id/trigger_normalized.jpg",
        "contentType": "image/jpeg",
        "width": 1600,
        "height": 1200,
        "byteSize": 421234,
        "sha256": "77bb7f7a..."
      },
      "quality": {
        "status": "passed",
        "score": 0.82,
        "featureCount": 735,
        "arcoreScore": 82,
        "warnings": []
      },
      "contentIds": ["media-asset-id", "media-thumbnail-id"],
      "primaryContentId": "media-asset-id"
    }
  ],
  "deletedTargetIds": ["trg_removed_001"],
  "requiredApp": {
    "minVersion": "1.0.0",
    "recommendedVersion": "1.2.0"
  }
}
```

### Unity-Vertrag

Die Unity-App:

- ruft nach Login die erlaubten Gruppen ab.
- laedt fuer jede erlaubte Gruppe das aktuelle Manifest.
- vergleicht `manifestVersion`, `etag` oder `sha256` mit lokalem Cache.
- liest Top-Level-`content[]` und indexiert es als `contentId -> content`.
- liest `targets[]`, nicht `assets[]`.
- verwendet `targetId = trigger_images.target_key`.
- validiert `physicalWidthMeters`.
- validiert, dass jedes `targets[].contentIds[]` auf `content[].contentId` zeigt.
- validiert, dass `targets[].primaryContentId` in `targets[].contentIds[]` und in Top-Level-`content[]` existiert.
- laedt nur neue oder geaenderte Triggerbilder und Content-Dateien.
- entfernt lokale Targets, die in `deletedTargetIds` stehen oder nicht mehr im aktuellen Manifest enthalten sind.
- baut die Runtime Image Library aus `target.image`.
- loest Tracking ueber `targetId -> target -> primaryContentId -> content` auf.
- spielt im MVP den Content aus `primaryContentId` aus.

## Fehlerfaelle

### Permanente Fehler

Diese Fehler sollten nicht automatisch erneut versucht werden:

- Datei nicht dekodierbar.
- Dateityp nicht erlaubt.
- MIME-Sniffing widerspricht erlaubtem Typ.
- Upload-Limit ueberschritten.
- Aufloesung zu klein oder zu gross.
- Triggerqualitaet zu niedrig.
- `arcoreimg` Score zu niedrig.
- Video zu lang.
- Video-Codec nicht lesbar.
- 3D-Modell invalid.
- GLB/gltf referenziert externe URLs.
- Triangle Count oder Texturaufloesung zu hoch.
- Security-/Malware-Scan fehlgeschlagen.

### Retrybare Fehler

Diese Fehler duerfen mit Backoff erneut versucht werden:

- R2 temporaer nicht erreichbar.
- Redis Timeout.
- Postgres Timeout.
- Worker-Prozess wurde beendet.
- FFmpeg-Prozess wurde durch Ressourcenlimit abgebrochen.
- Netzwerkfehler beim Lesen oder Schreiben von Objects.
- temporaerer CDN-/Storage-Fehler.

### Fehlerformat

Fehler landen in `processing_jobs.error_message`, `processing_jobs.output` und im zieltabellenspezifischen Report, also in `trigger_images.quality_report` oder `media_assets.processing_report`.

```json
{
  "code": "TRIGGER_ARCORE_SCORE_TOO_LOW",
  "message": "Trigger image quality is too low for reliable tracking.",
  "details": {
    "arcoreScore": 38,
    "minimum": 50
  }
}
```

## Retry-Policy

Empfehlung:

- `media-light`: 3 Versuche, exponential backoff, Start bei 30 Sekunden.
- `media-heavy`: 2 Versuche, exponential backoff, Start bei 2 Minuten.
- `manifest`: 5 Versuche, exponential backoff, Start bei 15 Sekunden.
- Nach finalem Fehler: `processing_jobs.status = dead_letter` und zieltabellenspezifisch `failed_permanent` oder `failed_retryable`.

BullMQ-Optionen:

```ts
{
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 30000
  },
  removeOnComplete: {
    age: 86400,
    count: 10000
  },
  removeOnFail: false
}
```

## Benoetigte CLI-Tools

MVP-Docker-Image:

- `ffmpeg`
- `ffprobe`
- OpenCV, z. B. Python/OpenCV oder native Bindings
- `arcoreimg`
- `gltf-validator`
- `gltf-transform`, optional aber nuetzlich
- `sharp`/`libvips` oder ImageMagick
- `file` fuer MIME-Sniffing
- `exiftool`, optional
- `clamav`, optional aber fuer Schulen/Firmen sinnvoll

## Docker-Worker

Empfohlene Struktur:

```txt
worker/
  src/
    queues/
    jobs/
      trigger.validate.ts
      image.optimize.ts
      video.transcode.ts
      model.validate.ts
      manifest.rebuild.ts
    services/
      storage.ts
      database.ts
      derivatives.ts
      manifest.ts
    cli/
      ffmpeg.ts
      opencv.ts
      arcoreimg.ts
      gltfValidator.ts
  Dockerfile
```

Empfohlene Worker-Prozesse:

- `worker:media-light`
- `worker:media-heavy`
- `worker:manifest`

Damit koennen CPU- und Memory-Limits unterschiedlich gesetzt werden.

## Security und Betrieb

MVP-Sicherheitsregeln:

- Keine Ausfuehrung von User-Dateien.
- Alle CLI-Aufrufe mit Timeout.
- Alle temporaeren Dateien pro Job in eigenem Verzeichnis.
- Temp-Verzeichnis nach Job entfernen.
- Maximal erlaubte Input- und Output-Groessen erzwingen.
- Keine Remote-URIs in 3D-Dateien erlauben.
- Keine Shell-String-Konkatenation fuer User-Dateinamen.
- User-Dateinamen nur als Metadaten speichern, nicht fuer lokale Pfade verwenden.
- SHA-256 fuer Raw und Derivatives speichern.
- Optional Malware-Scan fuer Originaldateien.

## Minimale MVP-Regeln fuer Upload-Limits

| Typ | MVP-Limit |
| --- | ---: |
| Triggerbild | JPG/PNG/WebP, max. 10 MB |
| Trigger-Aufloesung | min. 640 px kurze Seite, max. 4096 px lange Seite |
| Trigger-Seitenverhaeltnis | ca. 1:3 bis 3:1 |
| Trigger ARCore Score | >= 75 ready, 50-74 review, < 50 reject |
| Bild | max. 20 MB, max. 4096 px lange Seite |
| Video Upload | max. 200 MB |
| Video Dauer | max. 60 Sekunden |
| Video Output | MP4 H.264, max. 1080p |
| 3D | GLB, max. 50 MB |
| 3D Komplexitaet | max. 100k Triangles, Texturen max. 2048 px |
| Gruppe | MVP max. 100 aktive Targets |
| Manifest | Ziel: < 10 MB |

Diese Werte sind bewusst konservativ. Sie schuetzen die mobile AR-App vor zu grossen Manifests, schweren Videos und zu komplexen 3D-Modellen. Spaeter koennen Limits pro Plan, Organisation oder Rolle angehoben werden.

## Empfohlene MVP-Umsetzungsschritte

1. Kanonische Tabellen fuer `artworks`, `artwork_revisions`, `trigger_images`, `media_assets`, `asset_derivatives`, `processing_jobs` und `manifest_versions` finalisieren.
2. Upload-Session und R2-Presigned-Upload in der API implementieren.
3. BullMQ mit `media-light`, `media-heavy` und `manifest` einrichten.
4. API so verdrahten, dass Uploads `trigger_images` oder `media_assets` erzeugen.
5. `trigger.validate` fuer `trigger_images` implementieren.
6. `image.optimize` fuer `media_assets.asset_type = 'image'` implementieren.
7. `video.transcode` fuer `media_assets.asset_type = 'video'` implementieren.
8. `model.validate` fuer `media_assets.asset_type = 'model3d'` implementieren.
9. Review-/Publish-Workflow an `artwork_revisions` und Processing-Status koppeln.
10. `manifest.rebuild` implementieren und `manifest_versions` schreiben.
11. Unity-App gegen kanonisches Manifest mit `targets[]`, `content[]` und `targetId = trigger_images.target_key` anbinden.

## Offene Entscheidungen

### 1. GLB-only im MVP oder glTF-Pakete erlauben?

Empfehlung: Im MVP nur GLB erlauben.

Grund: GLB ist eine einzelne Datei, einfacher zu validieren, einfacher auszuliefern und weniger fehleranfaellig. glTF mit externen Texturen kann spaeter als ZIP-Paket mit strenger Pfadpruefung folgen.

### 2. Exakte OpenCV-Schwellwerte fuer Trigger

Empfehlung: Die ersten Schwellwerte konservativ setzen und nach echten Testbildern kalibrieren.

Noch offen:

- minimaler Blur-Score
- minimaler Kontrastscore
- minimaler Feature Count
- Umgang mit textlastigen Bildern
- separate Grenzwerte fuer ARCore und ARKit

### 3. `arcoreimg` Packaging und Lizenzthemen

Empfehlung: Vor finaler Worker-Implementierung pruefen, wie `arcoreimg` legal und technisch im Docker-Image verteilt werden darf.

Noch offen:

- darf es direkt ins Worker-Image?
- muss es beim Build separat eingebunden werden?
- gibt es Versionsbindung an ARCore SDK?

### 4. Private oder oeffentliche CDN-URLs?

Empfehlung: Fuer MVP koennen Derivatives ueber signierte URLs oder kurzlebige API-vermittelte URLs ausgeliefert werden, wenn Inhalte nicht oeffentlich sein duerfen.

Noch offen:

- Sind Gruppeninhalte vertraulich?
- Sollen Manifest und Medien komplett privat sein?
- Wie lange duerfen signierte URLs gueltig sein?
- Muss die Unity-App URLs regelmaessig refreshen?

### 5. Manifest-Signierung

Empfehlung: Spaetestens fuer produktive Firmen-/Schulnutzung Manifest-Hash und Signatur einfuehren.

Optionen:

- Nur HTTPS + `etag`/`sha256` im MVP.
- HMAC-Signatur pro Manifest.
- Ed25519-Signatur, Public Key in App oder API-Konfiguration.

### 6. Manifest-Aktualisierung und Cache-Invalidierung

Empfehlung: `latest.json` mit kurzer TTL oder API-vermitteltem Lookup ausliefern.

Noch offen:

- Pullt die App regelmaessig?
- Gibt es Push Notifications?
- Wie schnell muessen Unpublishes auf Geraeten verschwinden?
- Reicht der definierte `deletedTargetIds`-Diff gegen die vorherige aktuelle Manifest-Version oder braucht die App spaeter kumulative Diffs ueber mehrere Versionen?

### 7. Review-Workflow

Empfehlung: `needs_manual_review` technisch getrennt vom fachlichen Review behandeln.

Noch offen:

- Wer darf technische Warnings ueberstimmen?
- Wird `needs_manual_review` nach Freigabe zu `ready` oder bleibt der Status mit separatem Override erhalten?
- Gibt es Organisation-Admins, Gruppen-Admins und Reviewer getrennt?
- Muss jede Veroeffentlichung fachlich freigegeben werden?
- Duerfen Subaccounts selbst publishen?

### 8. Maximal aktive Targets pro Gruppe

Empfehlung: MVP mit 100 aktiven Targets pro Gruppe starten.

Noch offen:

- Pro Gruppe, pro Organisation oder pro User limitieren?
- Performance-Ziele fuer schwache Android-Geraete?
- Muss die App nach Standort, Kurs, Projekt oder Kategorie weiter filtern?

### 9. Revision- und Manifest-Versionierung

Empfehlung: Manifest referenziert konkrete `artwork_revision_id`, `trigger_images.id`, `media_assets.id` und stabile `trigger_images.target_key`.

Noch offen:

- Soll alter Content bis zum erfolgreichen Download der neuen Revision parallel gueltig bleiben?
- Braucht die App Rollback-Unterstuetzung auf alte `manifest_versions`?
- Wie lange bleiben alte Derivatives in R2?
- Muessen `deletedTargetIds` spaeter auch fuer Manifest-Diff-Endpunkte ueber mehrere Versionen aggregiert werden?

### 10. Video-Qualitaetsprofile

Empfehlung: MVP nur ein 1080p-Profil plus Thumbnail.

Spaeter moeglich:

- 720p fuer schwache Geraete.
- Adaptive Streaming, falls lange Videos wichtig werden.
- getrennte Profile fuer WLAN/Mobilfunk.

### 11. 3D-Optimierung

Empfehlung: MVP nur validieren und Limits erzwingen.

Spaeter moeglich:

- Draco.
- KTX2.
- automatische Texturverkleinerung.
- automatische Preview.
- LODs.

### 12. Moderation und Compliance

Empfehlung: Fuer Schulen und Firmen frueh eine Audit-Spur anlegen.

Noch offen:

- Malware-Scan Pflicht?
- Content-Moderation fuer Bilder/Videos?
- Audit-Log fuer Upload, Review, Publish, Unpublish?
- Aufbewahrungsfristen fuer geloeschte Trigger, Medien und Derivatives?

### 13. Mandantenfaehigkeit und Rollen

Empfehlung: Jede Query und jeder Job muss `org_id` und `group_id` enthalten und validieren.

Noch offen:

- Rollenmodell exakt definieren.
- Subaccounts: duerfen sie eigene Uploads sehen oder alle Gruppeninhalte?
- Organisationsuebergreifende Admin-Rollen?
- RLS in Supabase direkt nutzen oder nur ueber eigene API-Schicht?

### 14. Unity Runtime Image Library Details

Empfehlung: Manifest liefert normalisierte Triggerbilder und Metadaten, Unity erzeugt lokal die Runtime Image Library.

Noch offen:

- Zielplattformen: ARCore, ARKit oder beide?
- Unterschiedliche Trigger-Anforderungen pro Plattform?
- Maximale Target-Anzahl pro Runtime Library?
- Muss die App Gruppen gleichzeitig laden oder aktiv zwischen Gruppen wechseln?

### 15. Worker-Skalierung

Empfehlung: Separate Worker fuer light, heavy und manifest starten.

Noch offen:

- Cloud-Provider fuer Worker?
- CPU-/Memory-Limits pro Job-Typ?
- maximale parallele FFmpeg-Jobs?
- horizontale Skalierung nach Queue-Laenge?

### 16. Redundanz zwischen Source-Tabelle und `asset_derivatives`

Empfehlung: `asset_derivatives` ist die kanonische Quelle fuer Worker-Outputs. `storage_key_processed` und `cdn_url` auf `trigger_images` oder `media_assets` duerfen nur als bequeme Spiegelung fuer den primaeren Output dienen.

Noch offen:

- Welche Derivative gilt je Asset-Typ als primaerer Output?
- Bleiben `storage_key_processed` und `cdn_url` dauerhaft erhalten oder werden sie spaeter aus Derivatives berechnet?
- Wie werden alte Derivatives bereinigt, wenn Revisionen superseded oder geloescht werden?

## Kurzfazit

Der Processing-Worker ist die technische Qualitaetsschleuse zwischen User-Upload und AR-Runtime. Er arbeitet direkt gegen den kanonischen DB-Vertrag: Trigger liegen in `trigger_images`, Content in `media_assets`, Outputs in `asset_derivatives`, Jobs in `processing_jobs` und Gruppenmanifeste in `manifest_versions`. Dadurch koennen Organisationen neue Trigger und Inhalte veroeffentlichen, ohne die Unity-App neu ausliefern zu muessen.
