> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Backend-API-Entwurf für gruppenbasierte AR-Plattform

Stand: 2026-05-30

Status: An `contracts.md` angepasst.

## Zielbild

Die API-Schicht verbindet Web-Dashboard, mobile Unity-App, Supabase Auth, Postgres, Cloudflare R2/CDN und Worker-System. Organisationen wie Schulen, Firmen oder Kunden können Gruppen anlegen. Innerhalb dieser Gruppen laden User Triggerbilder und AR-Content hoch. Die mobile Unity-App lädt nach Login nur die Daten der Gruppen, auf die der User Zugriff hat.

Wichtige Architekturentscheidung:

- Keine globale Erkennungsdatenbank.
- Pro Organisation und Gruppe gescopte, versionierte und immutable Manifeste.
- Lokale AR-Erkennung auf dem Gerät über AR Foundation Runtime Image Library.
- Neue Trigger und Medien sollen ohne App-Rebuild nutzbar sein.
- Postgres ist Source of Truth.
- Unity konsumiert ausschließlich das kanonische Gruppenmanifest aus `contracts.md`.

Geplanter Stack:

- Frontend: Next.js + TypeScript
- Backend/API: Supabase Auth + Postgres + eigene API-Schicht
- Storage: Cloudflare R2/CDN
- Queue: Redis + BullMQ
- Worker: Docker, FFmpeg, OpenCV, arcoreimg, glTF tools
- Unity: eigener AR Foundation Player
- Makaka/Imagine: Referenz oder selektive UI-/UX-Bausteine, keine Player-Architektur

## Contract-Abgleich

Dieses Dokument folgt den kanonischen Begriffen aus `contracts.md`:

- Workflow-Status liegen auf `artwork_revisions`, nicht direkt auf `artworks`.
- `artworks` haben nur Lifecycle-Status: `active`, `archived`, `deleted`.
- Rollen heißen `owner`, `admin`, `editor`, `reviewer`, `viewer`.
- Publish- und App-Rechte sind Capabilities, keine eigenen Rollen.
- `targetId` im Unity-Manifest ist `trigger_images.target_key`.
- Manifest-Top-Level nutzt `targets[]`, nicht `artworks[]` oder `assets[]`.
- Manifest-Content ist ein Top-Level-Array `content[]`; Targets referenzieren Content nur über `contentIds[]` und `primaryContentId`.
- Manifest referenziert `asset_derivatives`, nicht Originaldateien.
- R2 Object Keys verwenden `raw/...`, `derived/...` und `manifests/...`.
- Job-Typen verwenden Dot-Notation, z. B. `trigger.validate`.

## API-Konventionen

Base URL:

```txt
/api/v1
```

Authentifizierung:

```http
Authorization: Bearer <supabase_jwt>
```

Zeitformat:

```txt
ISO 8601 UTC, z. B. 2026-05-30T12:00:00Z
```

ID-Beispiele:

```txt
usr_123
org_school_1
grp_biology_8a
art_cell_001
rev_cell_003
tri_cell_003
med_cell_model_001
der_model_glb_001
mfst_018
job_trigger_validate_001
```

Einheitliches Fehlerformat:

```json
{
  "error": {
    "code": "Forbidden",
    "message": "You do not have access to this group.",
    "requestId": "req_abc123",
    "details": {}
  }
}
```

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

Struktur:

```txt
Organization
  Group
    Membership
    Artwork
      ArtworkRevision
        TriggerImage
          AssetDerivative
        MediaAsset
          AssetDerivative
        ReviewEvent
      ManifestVersion
      AnalyticsEvent
```

Ein `Artwork` ist die stabile fachliche AR-Einheit. Eine `ArtworkRevision` ist die bearbeitbare und reviewbare Version. Veröffentlichte Revisionen werden als unveränderlicher Snapshot in `manifest_versions` übernommen.

## Rollen und Capabilities

DB-Rollen:

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

| Rolle | Scope | Bedeutung |
| --- | --- | --- |
| `owner` | Organisation | Vollzugriff, Billing, Löschung, Rollen, alle Gruppen |
| `admin` | Organisation oder Gruppe | Verwaltung, Inhalte, Review, Publish im jeweiligen Scope |
| `editor` | Organisation oder Gruppe | Artworks, Drafts und Uploads erstellen, zur Review einreichen |
| `reviewer` | Organisation oder Gruppe | Review, Freigabe, Änderungen anfordern, Ablehnen |
| `viewer` | Organisation oder Gruppe | Lesen veröffentlichter Inhalte und App-Zugriff |

Capabilities:

| Capability | Bedeutung |
| --- | --- |
| `can_publish` | User darf freigegebene Revisionen veröffentlichen |
| `can_manage_members` | User darf Mitglieder im Scope verwalten |
| `can_manage_billing` | User darf Billing sehen oder ändern |
| `can_use_app` | User darf Gruppenmanifest in der App laden |
| `can_override_technical_warning` | User darf technische Warnings freigeben |

Publish-Regel für MVP:

```txt
can_publish =
  role in (owner, admin)
  or organization.settings.allow_reviewer_publish = true and role = reviewer
```

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

## Rechteprüfung

Jede API-Aktion prüft:

1. Authenticated User.
2. Aktives Profil.
3. Aktive Organisation.
4. Aktive Gruppe.
5. Membership im passenden Scope.
6. Rolle plus Capabilities.
7. Workflow-Status.
8. Quotas.
9. Ressource liegt im erlaubten Scope.

Clients dürfen `organizationId`, `groupId`, Storage-Keys, `targetKey` oder Rollen nicht blind vorgeben. Die API leitet Scopes und Storage-Pfade serverseitig aus Postgres ab.

Subaccounts:

- Subaccount ist `profiles.account_type = 'subaccount'`.
- Subaccount-Rechte kommen aus `memberships`.
- Subaccount mit `editor` darf standardmäßig nicht publishen.
- Parent-Account darf Subaccounts nur verwalten, wenn seine eigene Rolle das erlaubt.

## Endpoint-Liste

### Auth und User Context

```http
GET /me
GET /me/permissions
GET /me/permissions?groupId=:groupId
GET /me/groups
GET /me/organizations
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /me` | authenticated |
| `GET /me/permissions` | authenticated |
| `GET /me/groups` | authenticated |
| `GET /me/organizations` | authenticated |

Beispiel:

```http
GET /api/v1/me
Authorization: Bearer <supabase_jwt>
```

Response:

```json
{
  "user": {
    "id": "usr_123",
    "email": "teacher@example.com",
    "displayName": "Anna Weber",
    "accountType": "primary"
  },
  "organizations": [
    {
      "id": "org_school_1",
      "name": "Schule Nord",
      "role": "admin",
      "capabilities": ["can_publish", "can_manage_members", "can_use_app"]
    }
  ],
  "groups": [
    {
      "id": "grp_biology_8a",
      "organizationId": "org_school_1",
      "name": "Biologie 8A",
      "role": "admin",
      "capabilities": ["can_publish", "can_manage_members", "can_use_app"]
    }
  ]
}
```

Beispiel:

```http
GET /api/v1/me/permissions?groupId=grp_biology_8a
```

Response:

```json
{
  "groupId": "grp_biology_8a",
  "role": "admin",
  "capabilities": ["can_publish", "can_manage_members", "can_use_app"],
  "permissions": [
    "artwork:create",
    "revision:update",
    "revision:submit_review",
    "revision:publish",
    "manifest:read"
  ]
}
```

### Organisationen

```http
GET /organizations
POST /organizations
GET /organizations/:orgId
PATCH /organizations/:orgId
DELETE /organizations/:orgId
GET /organizations/:orgId/members
POST /organizations/:orgId/members
PATCH /organizations/:orgId/members/:userId
DELETE /organizations/:orgId/members/:userId
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /organizations` | authenticated, nur eigene Organisationen |
| `POST /organizations` | authenticated, falls Self-Service erlaubt |
| `GET /organizations/:orgId` | org member |
| `PATCH /organizations/:orgId` | `owner`, `admin` im Organisation-Scope |
| `DELETE /organizations/:orgId` | `owner` im Organisation-Scope |
| `GET /organizations/:orgId/members` | `owner`, `admin` oder `can_manage_members` im Organisation-Scope |
| `POST /organizations/:orgId/members` | `owner`, `admin` oder `can_manage_members` im Organisation-Scope |
| `PATCH /organizations/:orgId/members/:userId` | `owner`, `admin` oder `can_manage_members` im Organisation-Scope |
| `DELETE /organizations/:orgId/members/:userId` | `owner`, `admin` oder `can_manage_members` im Organisation-Scope |

Request:

```http
POST /api/v1/organizations
```

```json
{
  "name": "Schule Nord",
  "slug": "schule-nord"
}
```

Response:

```json
{
  "id": "org_school_1",
  "name": "Schule Nord",
  "slug": "schule-nord",
  "lifecycleStatus": "active",
  "createdAt": "2026-05-30T10:00:00Z"
}
```

### Gruppen

```http
GET /organizations/:orgId/groups
POST /organizations/:orgId/groups
GET /groups/:groupId
PATCH /groups/:groupId
DELETE /groups/:groupId
GET /groups/:groupId/members
POST /groups/:groupId/members
PATCH /groups/:groupId/members/:userId
DELETE /groups/:groupId/members/:userId
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /organizations/:orgId/groups` | org member |
| `POST /organizations/:orgId/groups` | `owner`, `admin` im Organisation-Scope |
| `GET /groups/:groupId` | group member oder org member mit Zugriff |
| `PATCH /groups/:groupId` | `owner`, `admin` im Organisation- oder Gruppen-Scope |
| `DELETE /groups/:groupId` | `owner`, `admin` im Organisation-Scope |
| `GET /groups/:groupId/members` | `owner`, `admin` oder `can_manage_members` im passenden Scope |
| `POST /groups/:groupId/members` | `owner`, `admin` oder `can_manage_members` im passenden Scope |
| `PATCH /groups/:groupId/members/:userId` | `owner`, `admin` oder `can_manage_members` im passenden Scope |
| `DELETE /groups/:groupId/members/:userId` | `owner`, `admin` oder `can_manage_members` im passenden Scope |

Request:

```http
POST /api/v1/organizations/org_school_1/groups
```

```json
{
  "name": "Biologie 8A",
  "description": "AR-Material für Biologieunterricht",
  "visibility": "private"
}
```

Response:

```json
{
  "id": "grp_biology_8a",
  "organizationId": "org_school_1",
  "name": "Biologie 8A",
  "description": "AR-Material für Biologieunterricht",
  "visibility": "private",
  "lifecycleStatus": "active",
  "createdAt": "2026-05-30T10:15:00Z"
}
```

### Artworks und Revisionen

```http
GET /groups/:groupId/artworks
POST /groups/:groupId/artworks
GET /artworks/:artworkId
PATCH /artworks/:artworkId
POST /artworks/:artworkId/archive
POST /artworks/:artworkId/restore
DELETE /artworks/:artworkId
GET /artworks/:artworkId/revisions
POST /artworks/:artworkId/revisions
GET /revisions/:revisionId
PATCH /revisions/:revisionId
DELETE /revisions/:revisionId
GET /revisions/:revisionId/status
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /groups/:groupId/artworks` | `viewer`, `editor`, `reviewer`, `admin`, `owner` im passenden Scope |
| `POST /groups/:groupId/artworks` | `editor`, `admin`, `owner` im passenden Scope |
| `GET /artworks/:artworkId` | group member mit Dashboard-Zugriff |
| `PATCH /artworks/:artworkId` | `editor` für eigene Drafts, sonst `admin`, `owner` |
| `POST /artworks/:artworkId/archive` | `admin`, `owner` |
| `POST /artworks/:artworkId/restore` | `admin`, `owner` |
| `DELETE /artworks/:artworkId` | `owner`, optional `admin` nach Organisationseinstellung |
| `GET /artworks/:artworkId/revisions` | group member mit Dashboard-Zugriff |
| `POST /artworks/:artworkId/revisions` | `editor`, `admin`, `owner` |
| `GET /revisions/:revisionId` | group member mit Dashboard-Zugriff |
| `PATCH /revisions/:revisionId` | `editor` bei `draft` oder `changes_requested`, sonst `admin`, `owner` |
| `DELETE /revisions/:revisionId` | `editor` bei eigener unveröffentlichter Revision, sonst `admin`, `owner` |
| `GET /revisions/:revisionId/status` | group member mit Dashboard-Zugriff |

Artwork erstellen:

```http
POST /api/v1/groups/grp_biology_8a/artworks
```

```json
{
  "title": "Zelle mit 3D-Modell",
  "description": "AR-Ansicht einer Pflanzenzelle",
  "locale": "de-DE",
  "tags": ["biologie", "zelle"]
}
```

Response:

```json
{
  "artwork": {
    "id": "art_cell_001",
    "groupId": "grp_biology_8a",
    "title": "Zelle mit 3D-Modell",
    "description": "AR-Ansicht einer Pflanzenzelle",
    "locale": "de-DE",
    "tags": ["biologie", "zelle"],
    "lifecycleStatus": "active",
    "createdAt": "2026-05-30T10:20:00Z"
  },
  "revision": {
    "id": "rev_cell_001",
    "artworkId": "art_cell_001",
    "revisionNumber": 1,
    "status": "draft",
    "triggerStatus": "missing",
    "primaryContentStatus": "missing"
  }
}
```

Neue Revision aus veröffentlichter Version:

```http
POST /api/v1/artworks/art_cell_001/revisions
```

```json
{
  "sourceRevisionId": "rev_cell_002",
  "changeNote": "Aktualisiertes 3D-Modell"
}
```

Response:

```json
{
  "id": "rev_cell_003",
  "artworkId": "art_cell_001",
  "revisionNumber": 3,
  "status": "draft",
  "changeNote": "Aktualisiertes 3D-Modell",
  "createdAt": "2026-05-30T10:25:00Z"
}
```

### Trigger Upload

MVP: ein stabiler Trigger-Slot pro Artwork. Jede Revision hat höchstens ein `trigger_images`-Upload für diesen Slot; der stabile Unity-Key bleibt `trigger_images.target_key`.

```http
POST /revisions/:revisionId/trigger-images/upload-intent
POST /trigger-images/:triggerImageId/upload-complete
GET /revisions/:revisionId/trigger-images
GET /trigger-images/:triggerImageId
DELETE /trigger-images/:triggerImageId
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `POST /revisions/:revisionId/trigger-images/upload-intent` | `editor`, `admin`, `owner` bei bearbeitbarer Revision |
| `POST /trigger-images/:triggerImageId/upload-complete` | `editor`, `admin`, `owner` bei bearbeitbarer Revision |
| `GET /revisions/:revisionId/trigger-images` | group member mit Dashboard-Zugriff |
| `GET /trigger-images/:triggerImageId` | group member mit Dashboard-Zugriff |
| `DELETE /trigger-images/:triggerImageId` | `editor` bei eigener bearbeitbarer Revision, sonst `admin`, `owner` |

Upload Intent Request:

```http
POST /api/v1/revisions/rev_cell_003/trigger-images/upload-intent
```

```json
{
  "filename": "zell_trigger.jpg",
  "contentType": "image/jpeg",
  "byteSize": 824120,
  "sha256": "77bb7f7a...",
  "physicalWidthMeters": 0.18
}
```

Upload Intent Response:

```json
{
  "triggerImageId": "tri_cell_003",
  "targetKey": "trg_q8s2k1",
  "processingStatus": "upload_pending",
  "qualityStatus": "pending",
  "upload": {
    "method": "PUT",
    "url": "https://r2.example.com/signed-put-url",
    "expiresAt": "2026-05-30T10:35:00Z",
    "headers": {
      "Content-Type": "image/jpeg",
      "x-amz-checksum-sha256": "77bb7f7a..."
    }
  },
  "objectKey": "raw/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/trigger/tri_cell_003/original",
  "maxByteSize": 10485760
}
```

Upload Complete Request:

```http
POST /api/v1/trigger-images/tri_cell_003/upload-complete
```

```json
{
  "sha256": "77bb7f7a..."
}
```

Upload Complete Response:

```json
{
  "triggerImageId": "tri_cell_003",
  "targetKey": "trg_q8s2k1",
  "processingStatus": "queued",
  "qualityStatus": "pending",
  "job": {
    "id": "job_trigger_validate_001",
    "type": "trigger.validate",
    "status": "queued"
  }
}
```

Worker-Ergebnis, interner Endpoint:

```http
POST /api/v1/internal/jobs/job_trigger_validate_001/complete
```

```json
{
  "triggerImageId": "tri_cell_003",
  "processingStatus": "ready",
  "qualityStatus": "passed",
  "quality": {
    "score": 0.82,
    "featureCount": 735,
    "arcoreScore": 82,
    "warnings": []
  },
  "derivatives": [
    {
      "id": "der_trigger_norm_001",
      "kind": "trigger.normalized",
      "storageKey": "derived/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/trigger/tri_cell_003/trigger_normalized.jpg",
      "cdnUrl": "https://cdn.example.com/derived/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/trigger_normalized.jpg",
      "mimeType": "image/jpeg",
      "width": 1600,
      "height": 1200,
      "bytes": 421234,
      "sha256": "77bb7f7a..."
    }
  ]
}
```

### Media Upload

```http
POST /revisions/:revisionId/media-assets/upload-intent
POST /media-assets/:mediaAssetId/upload-complete
GET /revisions/:revisionId/media-assets
GET /media-assets/:mediaAssetId
PATCH /media-assets/:mediaAssetId
DELETE /media-assets/:mediaAssetId
```

Unterstützte Medientypen:

```txt
image
video
model3d
audio
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `POST /revisions/:revisionId/media-assets/upload-intent` | `editor`, `admin`, `owner` bei bearbeitbarer Revision |
| `POST /media-assets/:mediaAssetId/upload-complete` | `editor`, `admin`, `owner` bei bearbeitbarer Revision |
| `GET /revisions/:revisionId/media-assets` | group member mit Dashboard-Zugriff |
| `GET /media-assets/:mediaAssetId` | group member mit Dashboard-Zugriff |
| `PATCH /media-assets/:mediaAssetId` | `editor` bei bearbeitbarer Revision, sonst `admin`, `owner` |
| `DELETE /media-assets/:mediaAssetId` | `editor` bei bearbeitbarer Revision, sonst `admin`, `owner` |

Upload Intent Request:

```http
POST /api/v1/revisions/rev_cell_003/media-assets/upload-intent
```

```json
{
  "filename": "plant_cell.glb",
  "contentType": "model/gltf-binary",
  "byteSize": 4822112,
  "sha256": "9af1c...",
  "mediaType": "model3d",
  "role": "primary"
}
```

Upload Intent Response:

```json
{
  "mediaAssetId": "med_cell_model_001",
  "processingStatus": "upload_pending",
  "upload": {
    "method": "PUT",
    "url": "https://r2.example.com/signed-put-url",
    "expiresAt": "2026-05-30T10:40:00Z",
    "headers": {
      "Content-Type": "model/gltf-binary",
      "x-amz-checksum-sha256": "9af1c..."
    }
  },
  "objectKey": "raw/org_school_1/grp_biology_8a/art_cell_001/rev_cell_003/media/med_cell_model_001/original"
}
```

Upload Complete Request:

```http
POST /api/v1/media-assets/med_cell_model_001/upload-complete
```

```json
{
  "sha256": "9af1c..."
}
```

Upload Complete Response:

```json
{
  "mediaAssetId": "med_cell_model_001",
  "processingStatus": "queued",
  "job": {
    "id": "job_model_validate_001",
    "type": "model.validate",
    "status": "queued"
  }
}
```

Worker-Verarbeitung nach Medientyp:

| Typ | Job-Typ | Verarbeitung |
| --- | --- | --- |
| `image` | `image.optimize` | Dimensionsprüfung, optimierte Derivate, Thumbnail |
| `video` | `video.transcode` | FFmpeg Probe, Thumbnail, MP4/HLS-Transcodes |
| `model3d` | `model.validate` | GLB-Validierung, Limits, validiertes GLB-Derivat |
| `audio` | später | Probe, Normalisierung, Formatkonvertierung |

### Asset Derivatives

```http
GET /trigger-images/:triggerImageId/derivatives
GET /media-assets/:mediaAssetId/derivatives
GET /asset-derivatives/:derivativeId
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /trigger-images/:triggerImageId/derivatives` | group member mit Dashboard-Zugriff |
| `GET /media-assets/:mediaAssetId/derivatives` | group member mit Dashboard-Zugriff |
| `GET /asset-derivatives/:derivativeId` | group member mit Dashboard-Zugriff |

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

Manifest-Einträge dürfen nur auf Derivatives mit `processing_status = ready` zeigen.

### Review und Freigabe

Review läuft auf `artwork_revisions`.

```http
POST /revisions/:revisionId/submit-review
POST /revisions/:revisionId/review/approve
POST /revisions/:revisionId/review/request-changes
POST /revisions/:revisionId/review/reject
GET /revisions/:revisionId/review-events
GET /groups/:groupId/review-queue
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `POST /revisions/:revisionId/submit-review` | `editor`, `admin`, `owner` bei bearbeitbarer Revision |
| `POST /revisions/:revisionId/review/approve` | `reviewer`, `admin`, `owner` |
| `POST /revisions/:revisionId/review/request-changes` | `reviewer`, `admin`, `owner` |
| `POST /revisions/:revisionId/review/reject` | `reviewer`, `admin`, `owner` |
| `GET /revisions/:revisionId/review-events` | group member mit Dashboard-Zugriff |
| `GET /groups/:groupId/review-queue` | `reviewer`, `admin`, `owner` |

Submit Review Request:

```http
POST /api/v1/revisions/rev_cell_003/submit-review
```

```json
{
  "message": "Bitte für die Klasse 8A freigeben."
}
```

Response:

```json
{
  "revisionId": "rev_cell_003",
  "status": "in_review",
  "submittedAt": "2026-05-30T11:00:00Z"
}
```

Request Changes:

```http
POST /api/v1/revisions/rev_cell_003/review/request-changes
```

```json
{
  "reason": "Triggerbild hat zu wenige eindeutige Merkmale.",
  "requiredChanges": [
    "Kontrastreicheres Bild verwenden",
    "Keine wiederholenden Muster"
  ]
}
```

Approve:

```http
POST /api/v1/revisions/rev_cell_003/review/approve
```

```json
{
  "note": "Inhalt fachlich geprüft.",
  "overrideTechnicalWarning": false
}
```

Approve Response:

```json
{
  "revisionId": "rev_cell_003",
  "status": "approved",
  "approvedAt": "2026-05-30T11:30:00Z"
}
```

Wenn ein Trigger `quality_status = warning` hat, ist `overrideTechnicalWarning = true` nur mit `can_override_technical_warning` erlaubt.

### Publish

```http
POST /revisions/:revisionId/publish
POST /artworks/:artworkId/unpublish
GET /revisions/:revisionId/publication
GET /groups/:groupId/publications
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `POST /revisions/:revisionId/publish` | `can_publish` |
| `POST /artworks/:artworkId/unpublish` | `can_publish` |
| `GET /revisions/:revisionId/publication` | group member mit Dashboard-Zugriff |
| `GET /groups/:groupId/publications` | group member mit Dashboard-Zugriff |

Publish darf nur erfolgen, wenn:

- Revision ist `approved`, außer `owner` oder `admin` darf Review nach Einstellung überspringen.
- Mindestens ein Trigger ist `ready`.
- Trigger `quality_status` ist `passed` oder erlaubtes `warning`.
- Mindestens ein Primary-Content ist `ready`.
- Nötige Derivatives sind `ready`.
- Quotas sind ok.
- User hat `can_publish`.

Publish Request:

```http
POST /api/v1/revisions/rev_cell_003/publish
```

```json
{
  "versionNote": "Erste Version für Unterrichtseinheit",
  "effectiveAt": "2026-05-30T12:00:00Z"
}
```

Publish Response:

```json
{
  "artworkId": "art_cell_001",
  "revisionId": "rev_cell_003",
  "status": "published",
  "manifest": {
    "id": "mfst_018",
    "version": 18,
    "status": "queued",
    "job": {
      "id": "job_manifest_rebuild_018",
      "type": "manifest.rebuild",
      "status": "queued"
    }
  },
  "publishedAt": "2026-05-30T12:00:00Z"
}
```

Beim Publish sollte die API:

1. Revision-Status validieren.
2. Trigger- und Medien-Derivatives validieren.
3. Review-Regeln und technische Warnings prüfen.
4. Bisher veröffentlichte Revision desselben Artworks auf `superseded` setzen.
5. Neue Revision auf `published` setzen.
6. `manifest.rebuild` Job erzeugen.
7. Neue `manifest_versions` Version erzeugen.
8. Audit-Log- und Review-Event schreiben.

### Manifest für Unity-App

```http
GET /groups/:groupId/manifest
HEAD /groups/:groupId/manifest
GET /groups/:groupId/manifest/diff?sinceVersion=:manifestVersion
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `GET /groups/:groupId/manifest` | `viewer` oder höher mit `can_use_app` |
| `HEAD /groups/:groupId/manifest` | `viewer` oder höher mit `can_use_app` |
| `GET /groups/:groupId/manifest/diff` | optional später, `viewer` oder höher mit `can_use_app` |

Empfohlene Request Headers:

```http
If-None-Match: "grp_biology_8a-v18"
Accept-Encoding: gzip, br
```

Mögliche Responses:

```txt
200 OK
304 Not Modified
401 Unauthenticated
403 Forbidden
404 GroupNotFound
409 ManifestNotReady
```

Der Response Body von `GET /groups/:groupId/manifest` ist exakt das kanonische Manifest-Schema aus `contracts.md`.

Manifest-Regeln:

- Manifest-Content liegt ausschließlich im Top-Level-Array `content[]`.
- Targets enthalten keine eingebetteten Content-Objekte.
- Targets referenzieren Content nur über `contentIds[]` und `primaryContentId`.
- `content[].contentId` ist der referenzierbare Content-Key.
- Manifest-URLs dürfen nur auf `asset_derivatives` mit `processing_status = ready` zeigen.

### Analytics Events

```http
POST /analytics/events
POST /analytics/events/batch
GET /groups/:groupId/analytics
GET /artworks/:artworkId/analytics
```

Rollenprüfung:

| Endpoint | Rollen |
| --- | --- |
| `POST /analytics/events` | authenticated User mit `can_use_app` und Zugriff auf `groupId` |
| `POST /analytics/events/batch` | authenticated User mit `can_use_app` und Zugriff auf `groupId` |
| `GET /groups/:groupId/analytics` | `admin`, `owner` |
| `GET /artworks/:artworkId/analytics` | `admin`, `owner` |

Kanonische Unity-Events:

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

Batch Request:

```http
POST /api/v1/analytics/events/batch
```

```json
{
  "events": [
    {
      "eventId": "evt_device_uuid_001",
      "type": "target_add_failed",
      "occurredAt": "2026-05-30T12:15:12Z",
      "groupId": "grp_biology_8a",
      "manifestVersion": 18,
      "targetId": "trg_q8s2k1",
      "triggerImageId": "tri_cell_003",
      "sessionId": "sess_abc",
      "platform": "android",
      "device": {
        "appVersion": "1.0.0"
      },
      "properties": {
        "status": "ErrorInvalidImage",
        "message": "Target add failed: ErrorInvalidImage"
      }
    }
  ]
}
```

Response:

```json
{
  "accepted": 1,
  "rejected": 0
}
```

### Interne Worker-Endpunkte

Diese Endpunkte sind nicht für Web-Frontend oder Unity-App gedacht. Sie werden über Service Token, mTLS oder ein internes Netzwerk geschützt.

```http
POST /internal/jobs/:jobId/started
POST /internal/jobs/:jobId/progress
POST /internal/jobs/:jobId/complete
POST /internal/jobs/:jobId/fail
```

Rollenprüfung:

```txt
internal_worker_service
```

Kanonische Job-Typen:

```txt
trigger.validate
image.optimize
video.transcode
model.validate
manifest.rebuild
```

Beispiel Failure:

```json
{
  "mediaAssetId": "med_cell_model_001",
  "processingStatus": "failed_permanent",
  "error": {
    "code": "ModelValidationFailed",
    "message": "GLB validation failed.",
    "details": {
      "validatorErrors": 3
    }
  }
}
```

## Signed Upload Flow für Cloudflare R2

Der Upload läuft immer über eine Intent-API. Das Dashboard lädt Dateien direkt zu R2 hoch, bekommt aber keine freien Schreibrechte auf Buckets oder Object Keys.

Flow:

1. Client erstellt Artwork und Draft-Revision oder nutzt bestehende bearbeitbare Revision.
2. Client ruft `upload-intent` für Trigger oder Media auf.
3. API prüft Auth, Profil, Organisation, Gruppe, Rolle, Capability, Revision-Status, Dateityp, Dateigröße und Quota.
4. API erzeugt `trigger_images` oder `media_assets` Row mit `processing_status = upload_pending`.
5. API erzeugt serverseitig den R2 Object Key.
6. API erzeugt eine kurzlebige signed PUT URL.
7. Client lädt die Datei direkt zu R2 hoch.
8. Client ruft `upload-complete` auf.
9. API prüft per R2 HEAD Objekt, Größe, Content-Type und optional Checksum.
10. API setzt `processing_status = uploaded`.
11. API setzt `processing_status = queued` und queued passenden BullMQ-Job.
12. Worker setzt `processing_status = processing`.
13. Worker verarbeitet Datei und schreibt Derivatives nach R2.
14. Worker meldet Ergebnis an die API.
15. API setzt Status auf `ready`, `needs_manual_review`, `rejected`, `failed_retryable` oder `failed_permanent`.

R2 Object Keys:

```txt
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/original
raw/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/original
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/trigger_normalized.jpg
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/trigger/{triggerImageId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/video_1080p.mp4
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/thumb_512.webp
derived/{orgId}/{groupId}/{artworkId}/{revisionId}/media/{mediaAssetId}/model.glb
manifests/{orgId}/{groupId}/manifest-v{manifestVersion}.json
manifests/{orgId}/{groupId}/latest.json
```

Regeln:

- User-Dateinamen dürfen nie in Object Keys verwendet werden.
- Clients dürfen Object Keys nie selbst bestimmen.
- Upload URLs sollten kurzlebig sein, z. B. 10 bis 15 Minuten.
- Uploads werden erst nach `upload-complete` verarbeitet.
- `upload-complete` muss idempotent sein.
- API prüft serverseitig Content-Type, Größe und Quota erneut.
- Originale bleiben privat.
- Manifest referenziert Derivatives, nicht Originaldateien.

## Statusmodelle

### Artwork Lifecycle Status

```txt
active
archived
deleted
```

### Revision Status

Workflow liegt auf `artwork_revisions`.

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

### Asset Processing Status

Gilt für `trigger_images`, `media_assets` und `asset_derivatives`.

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
- `rejected`, `failed_retryable`, `failed_permanent`, `deleted` dürfen nie ins Manifest.
- `superseded` bleibt für historische Manifeste referenzierbar, wird aber nicht neu publiziert.

### Trigger Quality Status

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

### Manifest Status

```txt
queued
generating
published
failed_retryable
failed_permanent
```

## Fehlercodes

| Code | HTTP | Bedeutung |
| --- | --- | --- |
| `Unauthenticated` | 401 | Kein oder ungültiges Token |
| `ProfileInactive` | 403 | Profil ist deaktiviert |
| `Forbidden` | 403 | User hat keinen Zugriff auf Ressource |
| `InvalidRole` | 403 | Rolle reicht nicht für die Aktion |
| `CapabilityRequired` | 403 | Erforderliche Capability fehlt |
| `CanPublishRequired` | 403 | `can_publish` fehlt |
| `OrganizationNotFound` | 404 | Organisation existiert nicht oder ist nicht sichtbar |
| `GroupNotFound` | 404 | Gruppe existiert nicht oder ist nicht sichtbar |
| `ArtworkNotFound` | 404 | Artwork existiert nicht oder ist nicht sichtbar |
| `RevisionNotFound` | 404 | Revision existiert nicht oder ist nicht sichtbar |
| `TriggerImageNotFound` | 404 | Triggerbild existiert nicht oder ist nicht sichtbar |
| `MediaAssetNotFound` | 404 | Medium existiert nicht oder ist nicht sichtbar |
| `AssetDerivativeNotFound` | 404 | Derivative existiert nicht oder ist nicht sichtbar |
| `ProcessingJobNotFound` | 404 | Job existiert nicht oder ist nicht sichtbar |
| `InvalidStateTransition` | 409 | Aktion passt nicht zum aktuellen Status |
| `UploadIntentExpired` | 410 | Signed Upload URL ist abgelaufen |
| `UnsupportedMediaType` | 415 | Dateityp wird nicht unterstützt |
| `FileTooLarge` | 413 | Datei überschreitet Größenlimit |
| `QuotaExceeded` | 409 | Organisations- oder Gruppenquota überschritten |
| `ChecksumMismatch` | 422 | Upload-Checksum stimmt nicht |
| `PhysicalWidthInvalid` | 422 | `physicalWidthMeters` fehlt oder liegt außerhalb der erlaubten Range |
| `TechnicalWarningRequiresOverride` | 422 | Technische Warning erfordert manuelle Freigabe |
| `TriggerQualityFailed` | 422 | Triggerbild ist nicht publishfähig |
| `AssetStillProcessing` | 409 | Asset ist noch nicht bereit |
| `RevisionNotReviewable` | 422 | Revision kann nicht zur Review eingereicht werden |
| `RevisionNotPublishable` | 422 | Revision erfüllt Publish-Anforderungen nicht |
| `ManifestNotReady` | 409 | Manifest wird noch generiert oder ist fehlgeschlagen |
| `ManifestVersionNotFound` | 404 | Angefragte Manifest-Version existiert nicht |
| `ManifestSchemaUnsupported` | 422 | Client unterstützt Manifest-Schema nicht |
| `TargetLimitExceeded` | 409 | Gruppe überschreitet das aktive Target-Limit |
| `DuplicateEvent` | 200 oder 202 | Analytics Event wurde bereits verarbeitet |
| `RateLimited` | 429 | Zu viele Requests |
| `InternalError` | 500 | Unerwarteter Serverfehler |

## Beispiel: GET /groups/:groupId/manifest

Request:

```http
GET /api/v1/groups/grp_biology_8a/manifest
Authorization: Bearer <supabase_jwt>
If-None-Match: "grp_biology_8a-v17"
Accept-Encoding: gzip, br
```

Response Headers:

```http
HTTP/1.1 200 OK
Content-Type: application/json
ETag: "grp_biology_8a-v18"
Cache-Control: private, max-age=3600, stale-while-revalidate=86400
```

Response Body:

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

Unity-Hinweise:

- `targetId` wird in Unity als `referenceImage.name` verwendet.
- `content[]` ist ein Top-Level-Array und wird in Unity als `contentId -> content` indexiert.
- `image.url` wird heruntergeladen oder aus lokalem Cache geladen.
- `image.sha256` ist Cache-Key für Triggerbilder.
- `targets[].contentIds` enthält IDs aus `content[].contentId`.
- `targets[].primaryContentId` muss in `targets[].contentIds` und `content[].contentId` existieren.
- `content[].sha256` ist Cache-Key für Medien.
- `physicalWidthMeters` ist pro Target verpflichtend.
- `deletedTargetIds` enthält stabile `targetId`-Werte, keine DB-IDs.
- Unity-MVP darf nur den über `primaryContentId` referenzierten Content anzeigen, muss aber das komplette Top-Level-`content[]` deserialisieren.

## Manifest Diff

Optionaler späterer Endpoint:

```http
GET /api/v1/groups/grp_biology_8a/manifest/diff?sinceVersion=17
```

Response:

```json
{
  "schemaVersion": "1.0",
  "fromVersion": 17,
  "toVersion": 18,
  "generatedAt": "2026-05-30T12:01:00Z",
  "addedOrUpdatedTargets": [
    {
      "targetId": "trg_q8s2k1",
      "artworkId": "art_cell_001",
      "revisionId": "rev_cell_003",
      "triggerImageId": "tri_cell_003"
    }
  ],
  "deletedTargetIds": []
}
```

MVP-Empfehlung: Vollmanifest plus `ETag`, `If-None-Match` und lokale App-Caches nach `sha256` reicht für den Start. Der Diff bleibt zunächst auf Targets und `deletedTargetIds` beschränkt; Content-Diff kann später ergänzt werden.

## Security- und Datenschutz-Hinweise

- API prüft jeden Gruppen- und Organisationszugriff serverseitig.
- R2 Keys werden nie clientseitig gebaut.
- User-Dateinamen werden nicht in Object Keys übernommen.
- Signed Upload URLs sind kurzlebig.
- Analytics Events sollten idempotente `eventId`s haben.
- Bei Schulen und Minderjährigen sollten Analytics standardmäßig pseudonymisiert werden.
- Manifest-Zugriff sollte nur nach Login und `can_use_app` möglich sein.
- Interne Worker-Endpunkte brauchen separate Service-Authentifizierung.
- Jede Review-, Publish- und Rollenänderung sollte auditierbar sein.
- Manifest-Versionen sind immutable und bleiben für historische Referenzen abrufbar.

## Empfohlene MVP-Reihenfolge

1. Auth/User Context mit kanonischen Rollen und Capabilities
2. Organisationen, Gruppen und Memberships
3. Artwork plus initiale `artwork_revisions`
4. Signed Upload Flow für `trigger_images`
5. Signed Upload Flow für `media_assets`
6. Worker-Jobs und `asset_derivatives`
7. Review/Freigabe auf Revisionen
8. Publish mit `manifest.rebuild`
9. Gruppenmanifest mit Top-Level-`content[]`, `targets[]`, `ETag` und `manifest_versions`
10. Unity-App Manifest-Download, Cache und Runtime Image Library
11. Analytics Events aus Unity
12. Optional Manifest-Diffs und erweitertes Reporting

## Offene Entscheidungen

- Ob Gruppenmanifeste zur Laufzeit aus Postgres/`manifest_versions` gelesen oder als JSON-Snapshot aus R2/CDN ausgeliefert werden. Der Vertrag bleibt in beiden Fällen identisch.
- Ob Manifest-Diffs vor dem Performance-Spike nötig sind oder Vollmanifest plus `ETag` für die erste Version reicht.
- Ob optimierte Derivatives öffentlich über CDN, signiert über CDN oder über kurzlebige Download-URLs ausgeliefert werden.
- Welche konkreten Quotas gelten: pro Organisation, Gruppe, User, Storage-Typ und aktive Targets.
- Ob `owner` und `admin` Review im Produkt wirklich überspringen dürfen oder ob auch sie immer Review brauchen.
- Ob Reviewer publishen dürfen, wenn `organization.settings.allow_reviewer_publish = true`, oder ob Publish strikt bei `owner/admin` bleiben soll.
- Wie streng `quality_status = warning` behandelt wird und wer `can_override_technical_warning` bekommt.
- Wann Multi-Trigger pro Artwork eingeführt wird. MVP nutzt einen Trigger pro Artwork; später sollte `artwork_targets` eingeführt werden.
- Ob `media_assets.content_key` eingeführt wird, falls Content über Revisionen hinweg logisch stabil bleiben muss.
- Welche Analytics bei Schulen und Minderjährigen erlaubt sind und welche Felder pseudonymisiert oder deaktiviert werden müssen.
- Wie lange alte Manifest-Versionen, Originale und Derivatives aufbewahrt werden.
- Welche App-Versionen neue Manifest-Felder oder neue Content-Typen unterstützen müssen.
- Ob `arcoreimg`-Scores als harte Publish-Regel gelten oder nur als technische Empfehlung.
- Welche Grenzwerte für `physicalWidthMeters` nach echten Tests final gelten.
- Wie die App große Gruppen lädt: ein Manifest pro Gruppe, Packs, progressive Target-Aktivierung oder weitere Strategie.
- Welche Performance-Grenzen für 25, 50, 100 und 200 Targets auf Android ARCore und iOS ARKit akzeptabel sind.
