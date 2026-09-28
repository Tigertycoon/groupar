> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# AR Player Performance-Spike

Status: Plan fuer naechsten Unity-Implementierungsschritt

## Ziel

Der Spike klaert, wie viele aktive Runtime-Image-Targets pro Gruppe praktikabel sind und ab wann die App Targets in Pakete, Prioritaeten oder progressive Aktivierung aufteilen muss.

Zu testen:

```txt
25 Targets
50 Targets
100 Targets
200 Targets
```

Plattformen:

```txt
Android ARCore
iOS ARKit
Unity XR Simulation nur als Editor-Sanity-Check
```

## Hypothesen

- 25 Targets sollte fuer MVP ohne besondere Optimierung akzeptabel sein.
- 50 Targets ist wahrscheinlich das sichere Default-Limit fuer schwachere Geraete.
- 100 Targets ist ein realistisches Gruppenlimit, wenn Triggerbilder klein, gecacht und qualitativ gut sind.
- 200 Targets ist eher ein Stresstest und vermutlich nur mit Pack-/Prioritaetsstrategie sinnvoll.

Bis Messwerte vorliegen:

```txt
MVP activeTargetCount: 100
Soft warning: > 50
Hard experimental: > 100
```

## Testdaten

Pro Target wird ein Manifest-Eintrag erzeugt:

```txt
targets[].targetId
targets[].contentIds[]
targets[].primaryContentId
targets[].physicalWidthMeters
targets[].image.url
targets[].image.sha256
```

Top-Level-Content wird separat erzeugt:

```txt
content[].contentId
content[].type
content[].role
content[].url
content[].sha256
content[].byteSize
```

Die Trigger-Sets muessen aus echten, validierten Bildern bestehen. Generierte Debug-Texturen sind fuer API-/Progress-Tests okay, aber nicht fuer belastbare ARCore/ARKit-Erkennungswerte.

## Messwerte

Manifest:

- JSON-Groesse unkomprimiert und gzip/brotli.
- Deserialisierungszeit.
- Zeit fuer `contentId -> content` und `targetId -> target` Indexaufbau.

Cache/Download:

- Cold download time fuer Triggerbilder.
- Warm cache load time.
- Peak Disk Cache Size.
- Cache-Hit-Rate.

Runtime Library:

- Zeit bis `ARSession.state >= Ready`.
- Zeit pro `ScheduleAddImageWithValidationJob`.
- Gesamtdauer bis alle Targets verarbeitet sind.
- Anzahl `Success`, `ErrorInvalidImage`, `ErrorDuplicateImage`, `ErrorUnknown`.
- Main-thread frame spikes waehrend Target-Addition.
- Peak Memory nach 25/50/100/200 Targets.

Tracking:

- Zeit von fertiger Library bis erste Erkennung.
- Wiedererkennungszeit nach Sichtverlust.
- False-negative Beobachtungen pro Target-Set.
- Verhalten bei mehreren sichtbaren Triggern.

UX:

- Progress-Update-Frequenz.
- Zeit bis erster sinnvoller AR-Screen.
- Ob Target-Aufbau abbrechbar oder fortsetzbar ist.

## Vorgehen

1. Testmanifest-Generator bauen, der 25/50/100/200 Targets und top-level `content[]` erzeugt.
2. Triggerbilder in vier Paketen vorbereiten, alle mit `physicalWidthMeters` und Quality-Score.
3. Unity-Testszene mit `ARPlayerRuntimeImageLibrary` und Telemetrie-Komponente erweitern.
4. Pro Plattform Cold-Run und Warm-Run messen.
5. Je Target-Count mindestens drei Laeufe machen.
6. Ergebnisse als CSV/JSON speichern und in Analytics-Eventnamen spiegeln.
7. Danach Limits und Lade-Strategie in `contracts.md` finalisieren.

## Instrumentierung in Unity

Neue oder erweiterte Scripts:

- `ARPlayerPerformanceProbe`: misst Stopwatch-Zeiten, Frame-Spikes, Memory und Target-Status.
- `ARPlayerSyntheticManifestFactory`: erzeugt lokale Testmanifeste mit top-level `targets[]` und `content[]`.
- `ARPlayerCacheProbe`: misst Triggerbild-Cache cold/warm separat vom AR-Add-Job.

Events:

```txt
manifest_deserialize_started
manifest_deserialize_completed
target_add_started
target_add_completed
target_add_failed
runtime_library_ready
tracking_first_detected
```

## Entscheidungsfragen

- Bleibt ein Gruppenmanifest bei 100 Targets noch schnell genug fuer App-Start?
- Muessen Targets in Pakete nach Raum, Kurs, Kampagne oder zuletzt genutzt aktiviert werden?
- Soll Unity beim App-Start nur die ersten N Targets laden und den Rest nachziehen?
- Brauchen wir pro Gruppe ein manifestiertes `activeTargetCount`-Limit aus dem Backend?
- Wann werden Medien geladen: vor Target-Addition, bei Erkennung oder predictive prefetch?

## Akzeptanzkriterien

- Fuer 25/50/100/200 Targets liegen Android- und iOS-Messwerte vor.
- Cold und Warm Cache sind getrennt gemessen.
- Runtime-Library-Aufbau und Tracking-Erkennung sind getrennt gemessen.
- Fehlerhafte Targets blockieren den Rest des Manifests nicht.
- Progressanzeige bleibt waehrend langer Target-Addition sichtbar und aktualisiert.
- Eine Empfehlung fuer MVP-Limit, Warnlimit und Packstrategie ist dokumentiert.
