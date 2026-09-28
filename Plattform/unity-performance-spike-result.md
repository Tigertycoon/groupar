> Original design / experiment note (May 2026). Current scope and verification: [root README](../README.md) and [validation](../docs/validation.md). Historical SDK paths and logs may be absent from this extracted repository.

# Unity Performance Spike Result

Status: Implementierter Unity-Spike, noch ohne Android/iOS-Messwerte

## Was wurde gebaut?

- `ARPlayerSyntheticManifestFactory`
  - erzeugt reproduzierbare Testmanifeste fuer 25, 50, 100 und 200 Targets.
  - erzeugt pro Target ein lokales synthetisches PNG und setzt `image.url` auf eine lokale `file://`-URL.
  - setzt `targetId`, `triggerImageId`, `physicalWidthMeters`, `image.url`, `image.sha256`, `contentIds[]` und `primaryContentId`.
  - erzeugt Top-Level-`content[]` mit Debug-Primary-Content.

- `ARPlayerPerformanceProbe`
  - startet Performance-Laeufe mit konfigurierbarem Target-Count.
  - misst Gesamtzeit von `LoadManifest(manifest)` bis Coroutine-Ende/`IsReady`.
  - misst Dauer pro `target_add_started -> target_add_completed/failed`.
  - liest `ARPlayerTelemetry.StatusCounts`.
  - misst Cold/Warm Cache ueber vorhandene Trigger-Cache-Dateien.
  - schreibt eine kompakte kopierbare Log-Zeile: `GroupARPerf ...`.
  - kann optional pro Target CSV-artige Detailzeilen loggen.

- `ARPlayerTriggerImageCache`
  - hat Hilfen zum Zaehlen/Loeschen einzelner Trigger-Cache-Dateien.
  - nutzt `image.sha256` als Cache-Key.

- `GroupAR_Player_Spike.unity`
  - wurde ueber Unity MCP/GladeKit erweitert.
  - `ARPlayerPerformanceProbe` haengt an `AR Player Runtime`.
  - `ARPlayerRuntimeImageLibrary.loadOnStart` ist deaktiviert, damit Messlaeufe kontrolliert gestartet werden.
  - Makaka Business Card bleibt ungenutzt.

## Wie fuehrt man den Test aus?

1. `Assets/GroupAR/ARPlayer/Scenes/GroupAR_Player_Spike.unity` oeffnen.
2. Auf einem ARCore-/ARKit-faehigen Geraet starten.
3. Im Inspector auf `AR Player Runtime` die Komponente `ARPlayerPerformanceProbe` verwenden.
4. Ueber das Komponenten-Kontextmenue einen Lauf starten:
   - `Run 25 Targets`
   - `Run 50 Targets`
   - `Run 100 Targets`
   - `Run 200 Targets`
5. Die Unity Console nach `[GroupAR][perf] GroupARPerf ...` filtern.
6. Cold/Warm werden standardmaessig nacheinander gemessen:
   - Cold loescht die betroffenen Trigger-Cache-Dateien vor dem Lauf.
   - Warm nutzt die nach dem Cold-Lauf gefuellten Cache-Dateien.

## Log-Felder

```txt
targetCount
cache
timedOut
ready
manifestVersion
seed
totalMs
targetCompleted
success
errors
targetAvgMs
targetMinMs
targetP95Ms
targetMaxMs
cacheBefore
cacheAfter
managedMemoryMB
statusCounts
sourceFolder
```

## Contract Issue

`contracts.md` definiert das Runtime-Manifest, aber keinen standardisierten Performance-Testkorpus.

Vorschlag:

- `contracts.md` nicht um Synthetic-Testfelder erweitern.
- In der Performance-Dokumentation separat festlegen, welche echten Triggerbilder fuer Android/iOS-Messungen verwendet werden.
- Synthetische `file://`-URLs bleiben nur Unity-Spike-Fixture und duerfen nicht als Produktions-Manifest interpretiert werden.

## Offene Punkte fuer echte Android/iOS-Geraetetests

- Synthetische PNGs sind nur fuer Pipeline-/Cache-/Timing-Sanity geeignet. Belastbare ARCore-/ARKit-Erkennungswerte brauchen echte validierte Triggerbilder.
- Auf iOS/ARKit muss geprueft werden, ob 100/200 Runtime-Adds mit den gewaehlten Bildgroessen stabil bleiben.
- Auf Android/ARCore muss der Unterschied zwischen Cold `file://`-Load, R2/CDN-Download und Warm Disk Cache separat gemessen werden.
- Peak Memory sollte mit Unity Profiler/Device Profiler gemessen werden; `managedMemoryMB` ist nur ein grober Editor-/Runtime-Hinweis.
- Tracking-Zeit nach fertiger Runtime Library ist noch nicht automatisiert; dafuer braucht der Spike echte physische Target-Sets.
