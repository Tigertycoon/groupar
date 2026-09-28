# Upload Processing Worker MVP

Quelle der Wahrheit: `../contracts.md`.

Dieser Worker-Baustein verarbeitet Uploads asynchron und schreibt contract-faehige
`asset_derivatives`. Er erzeugt kein eigenes Manifest-Format.

## Status

Siehe `../upload-processing-worker-status.md`.

## Queues

- `media-light`: `trigger.validate`, `image.optimize`, `model.validate`
- `media-heavy`: `video.transcode`
- `manifest`: `manifest.rebuild` ist nicht Teil dieses Bausteins, nutzt aber die
  erzeugten `asset_derivatives`

## Lokale Checks

```bash
npm ci
npm run check
npm run check:fixtures
```

`check:fixtures` validiert die vorhandene Manifest-Fixture gegen die wichtigsten
Contract-Regeln: Top-Level-`content[]`, `contentId`, `contentIds[]`,
`primaryContentId` und keinen verschachtelten Content direkt im Target.

## Publication checks

Node.js 22 or newer. `npm run check:jobs` runs three job-contract smoke cases; `npm run check:images` runs the real Sharp adapter. `npm run worker` initializes the package but does not start a connected processing service: database/storage adapters must be provided. See the root README.
