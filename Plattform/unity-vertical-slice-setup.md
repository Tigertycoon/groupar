> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Unity Vertical Slice Setup

Die Szene `GroupAR_Player_Spike` lädt ihr Backend-Manifest im Editor über:

`http://localhost:8787/groups/grp_fixture_ar_test/manifest`

- Im Unity Editor funktioniert `localhost:8787`, wenn das Backend lokal läuft.
- Auf einem echten Android- oder iOS-Gerät muss statt `localhost` die LAN-IP des Rechners verwendet werden.
- Das Backend wird aus `Plattform` mit `npm run dev` gestartet.
- Fixture-CDN- und derived-Assets werden über denselben API-Server ausgeliefert.
