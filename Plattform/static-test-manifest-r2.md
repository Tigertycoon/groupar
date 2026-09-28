> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Static Test Manifest und R2/CDN Setup

Quelle der Wahrheit fuer Schema und Begriffe: `Plattform/contracts.md`.

Fixture:

```text
Plattform/fixtures/manifest-test-group-v1.json
```

Lokale Fixture ohne R2/CDN:

```text
Plattform/fixtures/manifest-test-group-local.json
Plattform/fixtures/cdn-root/
Plattform/fixtures/prepare-fixture-cdn.ps1
```

Die Fixture ist ein statisches Gruppen-Manifest fuer Backend- und Unity-Tests.
Sie enthaelt:

- `schemaVersion = "1.0"`
- `manifestVersion = 1`
- Top-Level `content[]`
- `targets[]` mit `contentIds[]` und `primaryContentId`
- `deletedTargetIds` mit stabilen `targetId`/`target_key`-Werten
- keine verschachtelten `target.content[]`

## Lokale Fixture ohne R2/CDN

Fuer lokale Backend- und Unity-Tests ohne Cloudflare R2 verwende:

```text
Plattform/fixtures/manifest-test-group-local.json
```

Dieses Manifest hat dieselbe Struktur wie
`Plattform/fixtures/manifest-test-group-v1.json`, aber alle Asset-URLs zeigen
auf:

```text
http://localhost:8787/derived/...
```

Die Dateien fuer diesen lokalen Host liegen bytegleich unter:

```text
Plattform/fixtures/cdn-root/derived/...
```

Vor dem Test die lokale CDN-Root vorbereiten und verifizieren:

```powershell
powershell -ExecutionPolicy Bypass -File .\Plattform\fixtures\prepare-fixture-cdn.ps1
```

Das Script:

- erstellt fehlende Unterordner unter `Plattform/fixtures/cdn-root/`
- kopiert die dokumentierten Quelldateien bytegleich an die Manifest-Pfade
- prueft ByteSize und SHA-256 der Quellen
- prueft ByteSize und SHA-256 der kopierten Dateien
- prueft, dass alle URLs aus `manifest-test-group-local.json` auf vorhandene
  Dateien unter `cdn-root` zeigen
- prueft, dass `byteSize` und `sha256` im lokalen Manifest zu den tatsaechlich
  ausgelieferten Dateien passen

Lokalen Static Server starten:

```powershell
Set-Location .\Plattform\fixtures\cdn-root
python -m http.server 8787
```

Alternative ohne Verzeichniswechsel:

```powershell
python -m http.server 8787 --directory .\Plattform\fixtures\cdn-root
```

Unity/Backend sollen fuer lokale Tests diese Manifest-Datei verwenden:

```text
Plattform/fixtures/manifest-test-group-local.json
```

Bei Tests im Unity Editor funktioniert `http://localhost:8787`. Auf einem echten
Mobilgeraet zeigt `localhost` auf das Geraet selbst. Dann muss der Host im
Manifest durch die LAN-IP des Entwicklungsrechners ersetzt werden, z.B.
`http://192.168.1.23:8787`, und Firewall/Netzwerk muessen den Zugriff erlauben.

## Testdateien

Die SHA-256-Werte im Manifest wurden aus vorhandenen lokalen Dateien berechnet.
Damit Unity die Fixture live gegen einen CDN testen kann, muessen exakt diese
Bytes unter den im Manifest angegebenen R2/CDN-Objektpfaden liegen.

| Zweck | Lokale Datei | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Trigger `trg_fixture_feature_box` | `Assets/StreamingAssets/OpenCVForUnityExamples/features2d/box.png` | 50728 | `1094629c1e2ebbc8a9ae2c9c63e18c1dff0f5f1481146e02f3b11a3d30feb20a` |
| Trigger `trg_fixture_scene_box` und Image-Content `med_fixture_box_scene_image` | `Assets/StreamingAssets/OpenCVForUnityExamples/features2d/box_in_scene.png` | 122490 | `8b0225ff76244a42bd1400c0904f8b7afea7d97b7d8115495e42e98ad347bd51` |
| Trigger `trg_fixture_person_video` und Thumbnail `med_fixture_person_thumbnail` | `Assets/StreamingAssets/OpenCVForUnityExamples/dnn/person.jpg` | 113880 | `cdcbab947e46110fc2b77784ac54ddbbab2640f1e44cb5e91fc8984a9793a7d1` |
| Trigger `trg_fixture_text_debug` und Image-Content `med_fixture_text_debug_image` | `Assets/StreamingAssets/OpenCVForUnityExamples/text/test_text.jpg` | 72490 | `08343687d21b82d0eb22677cc09dc4206c49d23ad09ef8832d7d150a532b1a46` |
| Video-Content `med_fixture_person_video` | `Assets/StreamingAssets/OpenCVForUnityExamples/768x576_mp4.mp4` | 3483280 | `395cc487049954ea1c9d67236dd4daa809078889b50aebd5c940122b86d516c4` |
| Debug-Image-Content `med_fixture_logo_debug_image` | `Assets/Imagine/ImageTracker/Demos/Textures/imagetrackerlogo.png` | 16429 | `0481439f7900443ec00f2b2cd9304ca7a89ac07ff7a94a1f7979be36c224f14d` |

Hinweis: Im Projekt wurden lokale Bilder und Videos gefunden, aber keine
`*.glb` oder `*.gltf`-Datei. Deshalb enthaelt die Fixture echte `image`- und
`video`-Content-Eintraege, aber keinen erfundenen `model3d`-Eintrag.

## R2/CDN Objektpfade

Das Manifest nutzt als Beispiel-CDN:

```text
https://cdn.example.com/
```

Fuer einen echten Unity-Lauf gibt es zwei Moeglichkeiten:

1. `cdn.example.com` durch den realen CDN-Host ersetzen und das Manifest danach
   erneut speichern.
2. Den Test-CDN so konfigurieren, dass diese URLs auf den R2-Bucket zeigen.

Die Dateien muessen unter diesen Objektpfaden liegen:

```text
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.png
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/media/med_fixture_box_scene_image/image_2048.png

derived/org_fixture_school/grp_fixture_ar_test/art_fixture_scene_box/rev_fixture_scene_box_001/trigger/tri_fixture_scene_box_001/trigger_normalized.png
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_logo_debug/rev_fixture_logo_debug_001/media/med_fixture_logo_debug_image/debug_logo.png

derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/trigger/tri_fixture_person_video_001/trigger_normalized.jpg
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_video/video_1080p.mp4
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_thumbnail/thumb_512.jpg

derived/org_fixture_school/grp_fixture_ar_test/art_fixture_text_debug/rev_fixture_text_debug_001/trigger/tri_fixture_text_debug_001/trigger_normalized.jpg
derived/org_fixture_school/grp_fixture_ar_test/art_fixture_text_debug/rev_fixture_text_debug_001/media/med_fixture_text_debug_image/debug_text.jpg
```

Fuer diese statische Fixture gilt: Wenn keine echten Worker-Derivatives erzeugt
werden, kopiere die lokalen Quelldateien bytegleich an die oben genannten
Objektpfade. Sobald ein Worker Bilder normalisiert, Videos transcodiert oder
Thumbnails neu erzeugt, muessen `byteSize` und `sha256` im Manifest gegen die
tatsaechlichen Derivative-Dateien aktualisiert werden.

## URLs, die Unity erreichen muss

Unity muss alle `targets[].image.url` herunterladen koennen:

```text
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/trigger/tri_fixture_feature_box_001/trigger_normalized.png
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_scene_box/rev_fixture_scene_box_001/trigger/tri_fixture_scene_box_001/trigger_normalized.png
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/trigger/tri_fixture_person_video_001/trigger_normalized.jpg
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_text_debug/rev_fixture_text_debug_001/trigger/tri_fixture_text_debug_001/trigger_normalized.jpg
```

Unity muss ausserdem alle per `primaryContentId` oder `contentIds[]`
referenzierten `content[].url` erreichen koennen:

```text
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_feature_box/rev_fixture_feature_box_001/media/med_fixture_box_scene_image/image_2048.png
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_video/video_1080p.mp4
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_person_video/rev_fixture_person_video_001/media/med_fixture_person_thumbnail/thumb_512.jpg
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_logo_debug/rev_fixture_logo_debug_001/media/med_fixture_logo_debug_image/debug_logo.png
https://cdn.example.com/derived/org_fixture_school/grp_fixture_ar_test/art_fixture_text_debug/rev_fixture_text_debug_001/media/med_fixture_text_debug_image/debug_text.jpg
```

## SHA-256 berechnen

PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "Assets\StreamingAssets\OpenCVForUnityExamples\features2d\box.png"
```

Mehrere Dateien:

```powershell
$files = @(
  "Assets\StreamingAssets\OpenCVForUnityExamples\features2d\box.png",
  "Assets\StreamingAssets\OpenCVForUnityExamples\features2d\box_in_scene.png",
  "Assets\StreamingAssets\OpenCVForUnityExamples\dnn\person.jpg",
  "Assets\StreamingAssets\OpenCVForUnityExamples\text\test_text.jpg",
  "Assets\StreamingAssets\OpenCVForUnityExamples\768x576_mp4.mp4",
  "Assets\Imagine\ImageTracker\Demos\Textures\imagetrackerlogo.png"
)

foreach ($file in $files) {
  $item = Get-Item -LiteralPath $file
  $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $file
  [pscustomobject]@{
    Path = $file
    Bytes = $item.Length
    Sha256 = $hash.Hash.ToLowerInvariant()
  }
}
```

Node.js:

```bash
node -e "const fs=require('fs'),crypto=require('crypto'); for (const p of process.argv.slice(1)) { const b=fs.readFileSync(p); console.log(JSON.stringify({ path:p, bytes:b.length, sha256:crypto.createHash('sha256').update(b).digest('hex') })); }" "Assets/StreamingAssets/OpenCVForUnityExamples/features2d/box.png"
```

Die Hashes muessen ueber die Datei berechnet werden, die Unity tatsaechlich
downloadet. Wenn ein CDN komprimiert ausliefert, darf sich der Dateiinhalt selbst
nicht veraendern; HTTP-Kompression ist ok, serverseitige Bildoptimierung mit
neuen Bytes wuerde den Hash brechen.

## Worker/Backend-Generierung

Ein spaeterer Worker sollte das Manifest nicht aus Clientdaten bauen, sondern aus
publizierten Datenbank-Snapshots:

1. Gruppe laden und Zugriff/Status pruefen.
2. Aktuelle publizierte Revisionen der Gruppe sammeln.
3. Fuer `content[]` alle `media_assets` mit `processing_status = 'ready'`
   laden.
4. Fuer jedes `media_asset` genau die passende `asset_derivatives`-Datei als
   `content[].url`, `content[].byteSize` und `content[].sha256` ausgeben.
5. `content[].contentId` im MVP aus `media_assets.id` bilden.
6. Fuer `targets[]` alle manifestfaehigen `trigger_images` laden.
7. `targets[].targetId` aus `trigger_images.target_key` setzen.
8. `targets[].image` aus der `asset_derivatives`-Zeile mit
   `kind = 'trigger.normalized'` bauen.
9. `targets[].contentIds[]` aus den Media-IDs der Revision bilden.
10. `targets[].primaryContentId` auf das Primary-Media der Revision setzen und
    pruefen, dass es in `content[]` existiert.
11. `deletedTargetIds` aus archivierten/geloeschten stabilen `target_key`-Werten
    bilden, nie aus `trigger_images.id`.
12. Manifest als immutable `manifest_versions`-Snapshot speichern.

## Contract Checkliste

Die Fixture ist gegen diese Punkte aus `contracts.md` aufgebaut:

- `schemaVersion` ist String `"1.0"`.
- `manifestVersion` ist Integer.
- `group.id` und `group.name` sind gesetzt.
- `content[]` ist Top-Level.
- `content[].contentId` wird verwendet, nicht `content[].id`.
- `targets[].contentIds[]` referenziert nur IDs aus `content[].contentId`.
- `targets[].primaryContentId` ist in `targets[].contentIds[]` enthalten.
- `targets[]` enthalten kein verschachteltes `content[]`.
- Jedes Target hat `image.url`, `image.sha256` und `physicalWidthMeters`.
- `deletedTargetIds` enthaelt stabile `target_key`/`targetId`-Werte.

## Contract Issues

Keine blockierenden Contract-Widersprueche fuer diese Fixture.

Nicht als Contract-Aenderung umgesetzt: Es gibt aktuell keine lokale GLB/GLTF
Testdatei im Projekt. Vorschlag fuer spaeter: Eine kleine, lizenzklare
`model.glb` als Fixture-Asset ergaenzen und dann einen `model3d`-Content-Eintrag
mit echtem `sha256` in dieses Manifest aufnehmen.
