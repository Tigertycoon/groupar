> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Plattform Contracts

Status: Draft fuer Architektur-Abgleich

Zweck dieses Dokuments:

- Ein gemeinsames Vokabular fuer Backend, Datenbank, Worker und Unity festlegen.
- Die bisherigen Drift-Stellen zwischen `backend-api-entwurf.md`, `postgres-datenmodell.md`, `processing-worker-uploads.md` und `NativeARPlayerSpike.md` aufloesen.
- Vor weiterer Implementierung die stabilen Vertraege einfrieren.

## Grundentscheidungen

1. Postgres-Datenmodell ist Source of Truth.
2. Unity konsumiert ausschliesslich das hier definierte Gruppen-Manifest.
3. Worker wird an das Postgres-Modell angepasst, nicht an ein paralleles Upload-/Manifest-Modell.
4. Makaka bleibt Referenz/UX-Baustein, aber nicht Player-Architektur.
5. Manifeste sind gruppenbasiert, versioniert und immutable.
6. App-Rebuilds sind fuer neue Trigger und Medien nicht erforderlich.
7. `targetId` im Unity-Manifest ist ein stabiler fachlicher Key, keine revisionsabhaengige Datenbank-ID.

## Kanonisches Rollenmodell

DB-Rollen bleiben bewusst klein:

```txt
owner
admin
editor
reviewer
viewer
```

Rollen sind immer gescoped:

```txt
organization role: memberships.group_id is null
group role:        memberships.group_id is not null
```

Kanonische Bedeutung:

| Rolle | Scope | Bedeutung |
| --- | --- | --- |
| `owner` | Organisation | Vollzugriff, Billing, Loeschung, Rollen, alle Gruppen |
| `admin` | Organisation oder Gruppe | Verwaltung, Inhalte, Review, Publish im jeweiligen Scope |
| `editor` | Organisation oder Gruppe | Artworks/Drafts/Uploads erstellen, zur Review einreichen |
| `reviewer` | Organisation oder Gruppe | Review, Freigabe, Aenderungen anfordern, Ablehnen |
| `viewer` | Organisation oder Gruppe | Lesen veroeffentlichter Inhalte und App-Zugriff |

Capabilities sind keine eigenen Rollen:

| Capability | Bedeutung |
| --- | --- |
| `can_publish` | User darf freigegebene Revisionen veroeffentlichen |
| `can_manage_members` | User darf Mitglieder im Scope verwalten |
| `can_manage_billing` | User darf Billing sehen/aendern |
| `can_use_app` | User darf Gruppenmanifest in der App laden |
| `can_override_technical_warning` | User darf technische Warnings freigeben |

Mapping alter API-Rollennamen:

| Alter API-Name | Neuer Vertrag |
| --- | --- |
| `org_owner` | `owner` mit Organisation-Scope |
| `org_admin` | `admin` mit Organisation-Scope |
| `group_manager` | `admin` mit Gruppen-Scope |
| `creator` | `editor` mit passendem Scope |
| `reviewer` | `reviewer` mit passendem Scope |
| `publisher` | Capability `can_publish` |
| `viewer` | `viewer` mit passendem Scope |
| `app_user` | Capability/Kontext `can_use_app`, keine DB-Rolle |

Publish-Regel fuer MVP:

```txt
can_publish =
  role in (owner, admin)
  or organization.settings.allow_reviewer_publish = true and role = reviewer
```

Subaccounts:

- Subaccount ist `profiles.account_type = 'subaccount'`.
- Subaccount-Rechte kommen trotzdem aus `memberships`.
- Subaccount mit `editor` darf standardmaessig nicht publishen.
- Parent-Account darf Subaccounts nur verwalten, wenn seine eigene Rolle das erlaubt.

## Kanonische Statuswerte

### Revision Status

Workflow liegt auf `artwork_revisions`, nicht direkt auf `artworks`.

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

Diese Statuswerte gelten fuer `trigger_images`, `media_assets` und ggf. `asset_derivatives`.

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
- `rejected`, `failed_retryable`, `failed_permanent`, `deleted` duerfen nie ins Manifest.
- `superseded` bleibt fuer historische Manifeste referenzierbar, wird aber nicht neu publiziert.

### Trigger Quality Status

Technische Bildqualitaet des Triggerbildes.

```txt
pending
passed
warning
failed
```

Mapping aus Worker:

| Worker-Ergebnis | `processing_status` | `quality_status` |
| --- | --- | --- |
| ARCore Score >= 75 und Checks ok | `ready` | `passed` |
| ARCore Score 50-74 oder technische Warnung | `needs_manual_review` | `warning` |
| ARCore Score < 50 oder harter Fehler | `rejected` | `failed` |

### Job Status

```txt
queued
running
succeeded
failed_retryable
failed_permanent
cancelled
dead_letter
```

## Kanonische Job-Typen

Wir verwenden Dot-Notation:

```txt
trigger.validate
image.optimize
video.transcode
model.validate
manifest.rebuild
```

Alte Namen werden ersetzt:

| Alter Name | Neuer Name |
| --- | --- |
| `trigger_quality` | `trigger.validate` |
| `image_optimize` | `image.optimize` |
| `video_transcode` | `video.transcode` |
| `model_optimize` | `model.validate` |
| `manifest_build` | `manifest.rebuild` |

Wichtig:

- `model.validate` validiert im MVP nur GLB-Dateien und erzwingt Limits.
- Echte 3D-Optimierung wie Draco/KTX2 ist spaeter ein neuer Job, z.B. `model.optimize`.

## Kanonisches Datenmodell

MVP-Tabellen:

```txt
profiles
organizations
groups
memberships
artworks
artwork_revisions
trigger_images
media_assets
asset_derivatives
processing_jobs
manifest_versions
review_events
analytics_events
subscriptions optional
```

`asset_derivatives` ist MVP, nicht spaeter.

Grund:

- Worker erzeugt schon im MVP mehrere Outputs: Thumbnails, normalisierte Triggerbilder, optimierte Bilder, transcodierte Videos.
- Ein einzelnes `storage_key_processed` reicht nur fuer den ersten einfachen Fall.

### Stable Target Key

`targetId` in Unity ist `trigger_images.target_key`.

Neue Spalte:

```sql
trigger_images.target_key text not null
```

Regeln:

- `target_key` ist stabil ueber Revisionen und Re-Uploads.
- Neue Revisionen eines bestehenden Trigger-Slots uebernehmen denselben `target_key`.
- `trigger_images.id` bleibt revisions-/upload-spezifisch und darf nicht als Unity-`targetId` verwendet werden.
- `artworks.id` ist stabil, aber nicht eindeutig genug fuer mehrere Trigger pro Artwork.

MVP mit einem Trigger pro Artwork:

```txt
target_key = "target_" + artwork_id
```

Robustere Empfehlung:

```txt
target_key = "trg_" + stable_random_id
```

Bei spaeterem Multi-Trigger pro Artwork sollte eine eigene Tabelle `artwork_targets` eingefuehrt werden:

```txt
artwork_targets(id, artwork_id, target_key, display_name, sort_order, lifecycle_status)
```

### Content Identity

Manifest-Content ist ein eigenes Top-Level-Array, immer.

```txt
content[]
```

Auch wenn MVP nur ein Primary-Content nutzt, bleibt die Kardinalitaet ein Array.
Targets referenzieren Content nur ueber IDs:

```txt
targets[].contentIds[]
targets[].primaryContentId
```

`content[].contentId` ist im MVP `media_assets.id`.

Optional spaeter:

```txt
media_assets.content_key
```

falls Content ueber Revisionen hinweg logisch stabil bleiben muss.

## Kanonisches Manifest-Schema fuer Unity

`schemaVersion` ist ein String.

Kanonischer Top-Level-Name:

```txt
targets[]
```

Nicht verwenden:

```txt
artworks[]
assets[]
```

Beispiel:

```json
{
  "schemaVersion": "1.0",
  "manifestVersion": 18,
  "manifestId": "mfst_018",
  "generatedAt": "2026-05-30T12:01:00Z",
  "etag": "grp_biology_8a-v18",
  "organization": {
    "id": "org_school_1",
    "name": "Schule Nord"
  },
  "group": {
    "id": "grp_biology_8a",
    "name": "Biologie 8A"
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
      "contentId": "med_cell_model_001",
      "type": "model3d",
      "role": "primary",
      "url": "https://cdn.example.com/derived/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/model.glb",
      "contentType": "model/gltf-binary",
      "byteSize": 3120044,
      "sha256": "9af1c...",
      "metadata": {
        "placement": "onImage",
        "scale": 1.0,
        "loop": true
      }
    },
    {
      "contentId": "med_cell_preview_001",
      "type": "image",
      "role": "thumbnail",
      "url": "https://cdn.example.com/derived/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/thumb_512.webp",
      "contentType": "image/webp",
      "byteSize": 84211,
      "sha256": "1ac88..."
    }
  ],
  "targets": [
    {
      "targetId": "trg_q8s2k1",
      "artworkId": "art_cell_001",
      "revisionId": "rev_cell_003",
      "triggerImageId": "tri_cell_003",
      "title": "Zelle mit 3D-Modell",
      "locale": "de-DE",
      "tags": ["biologie", "zelle"],
      "updatedAt": "2026-05-30T12:00:00Z",
      "physicalWidthMeters": 0.18,
      "image": {
        "url": "https://cdn.example.com/derived/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/trigger_normalized.jpg",
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
      "contentIds": ["med_cell_model_001", "med_cell_preview_001"],
      "primaryContentId": "med_cell_model_001"
    }
  ],
  "deletedTargetIds": [],
  "requiredApp": {
    "minVersion": "1.0.0",
    "recommendedVersion": "1.2.0"
  }
}
```

Manifest-Regeln:

- `schemaVersion` ist immer String, z.B. `"1.0"`.
- `manifestVersion` ist integer und steigt pro Gruppe monoton.
- `targetId` ist stabil und wird in Unity als `referenceImage.name` verwendet.
- `content` ist ein Top-Level-Array.
- `targets[].contentIds` enthaelt IDs aus `content[].contentId`.
- `targets[].primaryContentId` muss in `targets[].contentIds` und `content[].contentId` existieren.
- `physicalWidthMeters` ist fuer jedes Target verpflichtend.
- `image.sha256` ist Cache-Key fuer Triggerbilder.
- `content[].sha256` ist Cache-Key fuer Medien.
- `deletedTargetIds` enthaelt stabile `targetId`-Werte, nicht DB-IDs.

## Unity Runtime Contract

Unity muss:

1. Manifest laden.
2. `schemaVersion` pruefen.
3. `targets[]` lesen.
4. `content[]` lesen und als `contentId -> content` indexieren.
5. Pro Target `targetId`, `image.url`, `image.sha256`, `physicalWidthMeters`, `contentIds[]`, `primaryContentId` validieren.
6. Triggerbild herunterladen oder aus Cache laden.
7. Runtime Image Library aufbauen.
8. `ScheduleAddImageWithValidationJob(texture, targetId, physicalWidthMeters)` verwenden.
9. Bei Tracking `ARTrackedImage.referenceImage.name` als `targetId` behandeln.
10. `targetId -> target -> primaryContentId -> content` aufloesen.
11. Primary-Content anzeigen.
12. Fehler pro Target isolieren.
13. Target-Fehler an Analytics melden.

Unity-MVP darf nur `role = primary` anzeigen.

Unity-Modell muss trotzdem das Top-Level-`content[]` deserialisieren, nicht nur `contentId`.

`physicalWidthMeters` Validierung in Unity:

```txt
required: > 0
MVP hard range: 0.03 <= physicalWidthMeters <= 5.00
warning range: 0.05 <= physicalWidthMeters <= 2.00
```

Die Grenzwerte sind konfigurierbar und muessen durch echte Tests validiert werden.

Offen fuer Performance-Spike:

```txt
pending: Lieferstrategie fuer 50/100/200 Targets
pending: ein Manifest pro Gruppe vs. Packs
pending: progressive Target-Aktivierung
pending: Ladezeit ARCore vs. ARKit
```

## Backend API Contract

Manifest-Endpoint:

```http
GET /api/v1/groups/:groupId/manifest
```

Antwort ist exakt das kanonische Manifest-Schema.

Diff-Endpoint ist optional spaeter:

```http
GET /api/v1/groups/:groupId/manifest/diff?sinceVersion=18
```

MVP reicht:

- Vollmanifest
- `ETag`
- `If-None-Match`
- lokale App-Caches nach `sha256`

API darf keine Client-gelieferten Scopes blind uebernehmen.

Jede API-Aktion prueft:

1. Authenticated User.
2. Aktives Profil.
3. Aktive Organisation.
4. Aktive Gruppe.
5. Membership im passenden Scope.
6. Rolle plus Capabilities.
7. Workflow-Status.
8. Quotas.
9. Ressource liegt im erlaubten Scope.

## Upload und Processing Lifecycle

Trigger Upload:

```txt
upload_pending
-> uploaded
-> queued
-> processing
-> ready | needs_manual_review | rejected | failed_retryable | failed_permanent
```

Media Upload:

```txt
upload_pending
-> uploaded
-> queued
-> processing
-> ready | needs_manual_review | rejected | failed_retryable | failed_permanent
```

Review und Publish:

```txt
revision draft
-> in_review
-> approved
-> published
-> manifest.rebuild queued
-> manifest_versions published
```

Publish darf nur erfolgen, wenn:

- Revision ist `approved`, ausser Admin/Owner darf Review ueberspringen.
- Mindestens ein Trigger ist `ready`.
- Trigger `quality_status` ist `passed` oder erlaubtes `warning`.
- Mindestens ein Primary-Content ist `ready`.
- Quotas sind ok.
- User hat `can_publish`.

## Asset Derivatives

Neue MVP-Tabelle:

```sql
asset_derivatives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  group_id uuid not null references groups(id),
  trigger_image_id uuid references trigger_images(id),
  media_asset_id uuid references media_assets(id),
  kind text not null,
  storage_key text not null,
  cdn_url text,
  mime_type text not null,
  width integer,
  height integer,
  duration_seconds numeric(10,3),
  bytes bigint not null,
  sha256 text not null,
  metadata jsonb not null default '{}',
  processing_status asset_processing_status not null default 'ready',
  created_at timestamptz not null default now()
)
```

Constraint-Regel:

```txt
exactly one of trigger_image_id or media_asset_id must be non-null
```

Kanonische Derivative-Kinds:

```txt
trigger.normalized
trigger.thumbnail
image.optimized_2048
image.optimized_1024
image.thumbnail_512
video.mp4_1080p
video.thumbnail_512
model.glb_validated
```

Manifest referenziert Derivatives, nicht Originaldateien.

## R2 Object Key Convention

Originale:

```txt
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/original
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/original
```

Derivatives:

```txt
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/trigger_normalized.jpg
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/video_1080p.mp4
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/model.glb
```

Manifeste:

```txt
manifests/{orgId}/{groupId}/manifest-v{manifestVersion}.json
manifests/{orgId}/{groupId}/latest.json
```

User-Dateinamen duerfen nie in Object Keys verwendet werden.

## Analytics Contract

Unity sendet mindestens:

```txt
app_opened
manifest_checked
manifest_downloaded
target_add_started
target_add_completed
target_add_failed
trigger_detected
content_view_started
content_view_completed
content_error
```

`target_add_failed` Payload:

```json
{
  "groupId": "grp_biology_8a",
  "manifestVersion": 18,
  "targetId": "trg_q8s2k1",
  "triggerImageId": "tri_cell_003",
  "platform": "android",
  "status": "ErrorInvalidImage",
  "message": "Target add failed: ErrorInvalidImage"
}
```

## Performance Pending

Dieser Abschnitt wird erst nach Unity-Performance-Spike finalisiert. Der konkrete Spike-Plan liegt in `Plattform/ar-player-performance-spike.md`.

Zu messen:

```txt
25 Targets
50 Targets
100 Targets
200 Targets
```

Pro Plattform:

```txt
Android ARCore
iOS ARKit
```

Messwerte:

- Manifest-Downloadzeit.
- Triggerbild-Downloadzeit warm/kalt.
- Cache-Hit-Rate.
- Zeit pro `ScheduleAddImageWithValidationJob`.
- Gesamtdauer Runtime-Library-Aufbau.
- Peak Memory.
- Fehler pro Target.
- Tracking-Erkennungszeit nach fertiger Library.

Bis die Messung vorliegt, gilt MVP-Limit:

```txt
max 100 aktive Targets pro Gruppe
```

Die App muss Fortschritt anzeigen und darf Target-Aufbau nicht als stillen Blocking-Screen behandeln.

## Anpassungsaufgaben

### DB anpassen

- `trigger_images.target_key` hinzufuegen.
- `asset_derivatives` ins MVP aufnehmen.
- `asset_processing_status` erweitern.
- `job_status` erweitern.
- Job-Typen auf Dot-Notation umstellen.

### API anpassen

- API-Status weg von direktem Artwork-Workflow, hin zu Revision-Workflow.
- Rollennamen auf kanonisches Modell mappen.
- Manifest-Response exakt auf dieses Schema umstellen.
- `content[]` statt einzelnes Content-Objekt verwenden.
- `targetId = target_key` ausgeben.

### Worker anpassen

- Worker-Dokumentation auf `trigger_images`, `media_assets`, `asset_derivatives`, `processing_jobs` und `manifest_versions` mappen.
- Kein paralleles Upload-/Manifest-Modell im Worker-Dokument fuehren.
- Job-Typen auf Dot-Notation umstellen.
- `needs_manual_review` sauber in DB schreiben.
- Manifest mit `targets[]` und `content[]` erzeugen.

### Unity anpassen

- Manifestmodell auf kanonisches Schema erweitern.
- `content[]` deserialisieren.
- Primary-Content aus `content[]` waehlen.
- `physicalWidthMeters` Range validieren.
- Target-Add-Telemetrie senden.
- Performance-Spike fuer 25/50/100/200 Targets erstellen.
