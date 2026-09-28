> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# GroupAR Backend Vertical Slice Status

Stand: 2026-05-30

## Quelle der Wahrheit

`Plattform/contracts.md` ist die Quelle der Wahrheit. Dieser Slice lädt das Manifest aus `Plattform/fixtures/manifest-test-group-local.json`, falls vorhanden, sonst aus `Plattform/fixtures/manifest-test-group-v1.json`.

Der Manifest-Endpunkt gibt keine neuen Contract-Felder aus. Insbesondere:

- Top-Level `content[]`
- `content[].contentId`
- `targets[].contentIds[]`
- `targets[].primaryContentId`
- kein `targets[].content[]`

## Start

Voraussetzung:

```txt
Node.js >= 20
```

Start im Ordner `Plattform`:

```powershell
npm run dev
```

Default-URL:

```txt
http://localhost:8787
```

API-Endpunkte sind ohne Prefix und mit `/api/v1` erreichbar. Beispiel:

```txt
http://localhost:8787/groups/grp_fixture_ar_test/manifest
http://localhost:8787/api/v1/groups/grp_fixture_ar_test/manifest
```

## Env Vars

| Name | Default | Bedeutung |
| --- | --- | --- |
| `GROUPAR_API_PORT` | `8787` | Lokaler API-Port |
| `PORT` | leer | Fallback-Port, wenn `GROUPAR_API_PORT` nicht gesetzt ist |
| `GROUPAR_API_HOST` | `0.0.0.0` | Bind Host |
| `GROUPAR_MANIFEST_FIXTURE` | leer | Optionaler Pfad zu einer anderen Manifest-Fixture |

## Fertige Endpunkte

| Endpoint | Status | Notiz |
| --- | --- | --- |
| `GET /me` | fertig | Dev-Mock-User `usr_fixture_admin` |
| `GET /me/groups` | fertig | Alias zur gruppierten Membership-Sicht für das Dashboard |
| `GET /groups` | fertig | Liefert `grp_fixture_ar_test` |
| `GET /groups/:groupId/artworks` | fertig | Listet aktive Fixture-Artworks mit aktueller Revision |
| `GET /groups/:groupId/manifest` | fertig | Lädt Fixture, unterstützt `ETag` und `If-None-Match` |
| `HEAD /groups/:groupId/manifest` | fertig | Zusatz für Validator-Checks |
| `POST /uploads/sign` | Mock fertig | Gibt Mock-signed PUT URL zurück, kein Upload über API-Server |
| `POST /artworks` | Mock fertig | Erstellt Artwork plus Draft-Revision im Speicher |
| `POST /groups/:groupId/artworks` | Mock fertig | Gruppenscope-Fassade für Artwork-Erstellung |
| `GET /revisions/:revisionId/status` | fertig | Gibt Revision-Summary plus vorhandene `missing`-Publish-Gates zurück |
| `POST /revisions/:revisionId/publish` | Mock fertig | Kanonischer revisionsbasierter Publish-Endpoint |
| `POST /artworks/:id/publish` | Legacy-Fassade | Ruft intern denselben revisionsbasierten Publish-Pfad auf |
| `POST /analytics/events` | Mock fertig | Speichert Events im Speicher |
| `GET /health` | fertig | Lokaler Healthcheck |
| `GET /derived/...` | Dev-Helfer | Liefert lokale Fixture-Medien für Manifest-URLs |

## Manifest-Verhalten

Gruppe:

```txt
grp_fixture_ar_test
```

Manifest:

```txt
GET /groups/grp_fixture_ar_test/manifest
```

ETag-Verhalten:

- `200 OK`, wenn kein `If-None-Match` geschickt wird.
- `200 OK`, wenn `If-None-Match` nicht zum aktuellen Manifest passt.
- `304 Not Modified`, wenn `If-None-Match` zum aktuellen Manifest-ETag passt.
- `304` wird nur gesendet, wenn der Client einen Validator schickt.

Beispiel:

```powershell
curl.exe -i http://localhost:8787/groups/grp_fixture_ar_test/manifest
curl.exe -i -H 'If-None-Match: "grp_fixture_ar_test-v1"' http://localhost:8787/groups/grp_fixture_ar_test/manifest
```

## Unity-URLs

Unity muss für den lokalen Slice erreichen können:

```txt
GET http://localhost:8787/groups
GET http://localhost:8787/groups/grp_fixture_ar_test/manifest
GET http://localhost:8787/derived/...
POST http://localhost:8787/analytics/events
```

Im Unity Editor auf demselben Rechner funktioniert `localhost`. Auf einem echten iOS-/Android-Gerät zeigt `localhost` auf das Gerät selbst. Dann muss die Manifest-Fixture oder spätere CDN-Konfiguration eine erreichbare LAN-/Tunnel-URL verwenden, z. B. `http://192.168.x.y:8787/...`.

## Was ist echt?

- Contract-Formatprüfung des geladenen Manifests.
- Fixture-Auswahl: `manifest-test-group-local.json` bevorzugt, sonst `manifest-test-group-v1.json`.
- Group-scoped Manifest: nur `grp_fixture_ar_test` ist sichtbar.
- ETag/If-None-Match inklusive korrektem `304`.
- Lokales Ausliefern der in der Fixture referenzierten `/derived/...`-Assets.
- In-Memory-Datenmodell mit den MVP-Tabellennamen:
  - `orgs`/`organizations`
  - `groups`
  - `memberships`
  - `artworks`
  - `revisions`
  - `trigger_images`
  - `media_assets`
  - `asset_derivatives`
  - `manifest_versions`
  - `analytics_events`

## Was ist Mock?

- Auth ist ein Dev-Mock-User, noch kein Supabase JWT.
- Memberships und Capabilities sind Seed-Daten aus der Fixture.
- `POST /uploads/sign` erzeugt eine Mock-signed URL; es nimmt keine Datei entgegen und speichert keine Uploads.
- R2, Redis, BullMQ und Worker sind noch nicht angebunden.
- `POST /artworks` und `POST /groups/:groupId/artworks` persistieren nur im Prozessspeicher.
- `POST /revisions/:revisionId/publish` validiert gegen In-Memory-Status, baut aber noch kein neues Manifest.
- Analytics werden nur im Prozessspeicher gehalten.

## Geklaert fuer den MVP-Slice

### Publish-Endpoint-Scope

`contracts.md` legt fest, dass der Workflow auf `artwork_revisions` liegt. Der Slice bietet deshalb jetzt den kanonischen Endpoint `POST /revisions/:revisionId/publish` an. `POST /artworks/:id/publish` bleibt nur als Legacy-Fassade bestehen und sucht wie bisher die angefragte oder neueste Revision des Artworks.

### Revision-Status

`GET /revisions/:revisionId/status` erfindet kein neues Dashboard-Aggregat. Die Antwort nutzt die vorhandene Revision-Summary aus dem Backend-Entwurf (`revisionNumber`, `triggerStatus`, `primaryContentStatus`) und die bereits vom Publish-Fehler genutzte `missing`-Liste fuer nicht erfuellte Publish-Gates.

## Lokaler Test

Durchgefuehrt am 2026-05-30 gegen `http://localhost:8787`:

- `node --check api/server.mjs`
- `node --check dashboard/app.js`
- HTTP-Smoke fuer `GET /api/v1/me/groups`, `GET /api/v1/groups/grp_fixture_ar_test/artworks`, `GET /api/v1/revisions/rev_fixture_feature_box_001/status`, `POST /api/v1/revisions/rev_fixture_feature_box_001/publish`, `GET /api/v1/groups/grp_fixture_ar_test/manifest`
- `POST /api/v1/groups/grp_fixture_ar_test/artworks` plus anschliessender Statusabruf der neuen Draft-Revision
- Dashboard-Manifest-Link Runtime-Test: Default `http://localhost:8787`, Query-Parameter, `window.GROUPAR_API_BASE_URL` und `localStorage` erzeugen jeweils die erwartete `/api/v1/groups/:groupId/manifest` URL

## Dateien

```txt
Plattform/package.json
Plattform/api/server.mjs
Plattform/backend-vertical-slice-status.md
Plattform/fixtures/manifest-test-group-local.json
Plattform/fixtures/manifest-test-group-v1.json
```
