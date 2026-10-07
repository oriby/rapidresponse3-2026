# SurgeTriage (prototype)

An AI decision-support layer for 911/311 call centers during call-volume spikes. It groups duplicate
calls into master incidents, scores priority P0–P4 with explainable reasons, upgrades priority when
new details arrive, spots one root cause behind different complaint types, deflects repeat
non-emergency callers, and suggests unit preemption. **It only recommends. A human dispatcher makes every final decision.**

> Decision-support prototype. Not for live dispatch.

## Run it

This prototype has **no server, no database, and no build step**. Everything runs in the browser on seeded data.

1. Open `index.html` in Chrome or Edge. Double-clicking it works. The page needs internet access for the Tailwind, Leaflet, and map-tile CDNs.
2. Click **▶ Replay surge**. It streams 200 seeded calls over 2 minutes. Use 2× or 4× to go faster.
3. Open **Call Simulator** to type calls yourself and see caller deflection.

Tests (Node 18+): `npm test`

## What to watch during the replay

| Scenario | What you should see |
|---|---|
| BQE multi-car crash (25 callers) | Starts at P2 because a driver is fleeing. Caller #8 ("car on fire") upgrades it to P1, and caller #14 ("person trapped") upgrades it to P0. Each upgrade shows a red toast, and the reasons cite the caller. |
| Washington Heights water main | "No water", "low pressure", "flooding", and "sinkhole" become 4 separate incidents. Then a purple banner appears: *4 incidents may share one cause: Possible water main break*. You can confirm or dismiss it. |
| Bronx shots fired | P1, then P0. A banner suggests rerouting Unit 4 from a P3 noise call about 0.7 km away. **Reroute** and **Ignore** are human-only actions. |
| Astoria kitchen fire | A later "fire is out, everyone is safe" call suggests a downgrade. It never happens automatically; the dispatcher has to click **Accept downgrade**. |
| Noise / parking / cold thefts | These group into a few incidents. The top bar shows duplicates merged with the % reduction (about 75%). |
| Simulator → "repeat noise" sample | Shows *"This issue was already reported by N people…"* with **Add new details / Get text updates / Submit anyway**. Anything with a life threat, weapon, fire, or vulnerable person is never deflected. |

## Files

- `js/engine.js`: the pure, unit-tested logic. It holds the extractor, the priority engine (hard overrides, then the 0–100 score), the dedupe windows, the pg_trgm-style trigram similarity, root-cause patterns, and the deflection rule.
- `js/store.js`: the in-memory pipeline that replaces the API and database (extract → dedupe → merge → score → history → preemption).
- `js/seed.js`: 200 NYC surge calls, 8 units, and 3 pre-existing P3/P4 incidents that already have units assigned.
- `js/app.js` + `index.html`: the dashboard (queue, Leaflet map, detail panel, top-bar stats) and the Call Simulator.

## Prototype shortcuts (vs. the full spec)

- **Extraction is rules-based, not an LLM.** `Engine.extract()` returns the exact JSON shape the spec asks Claude to produce, so a Claude call can replace it on a server later. Unrecognized text becomes `unclassified` and is flagged for review instead of guessed. Priority is always assigned by the deterministic engine and never by the extractor.
- **No Supabase or PostGIS.** Distance uses haversine and text similarity uses a JS port of pg_trgm trigrams. All state lives in memory, so reloading the page resets it.
- The root-cause scan runs every 30 s, and also every 30 s of replay time so it keeps up at 4× speed.

## How this differs from CAD

CAD (computer-aided dispatch) routes individual calls: each call becomes a record that a call-taker codes and a
dispatcher assigns. During a surge, 25 calls about one crash become 25 rows to read, the 14th caller's
"someone is trapped" can sit unnoticed at the bottom of a queue, and nothing links a sinkhole report to a
no-water report two blocks away. **SurgeTriage understands incidents.** It merges callers into one master incident,
combines everything they report, re-scores priority every time a new fact arrives and shows the reason, and
connects different complaints that share one cause. It also tells repeat non-emergency callers the issue is already
known. It sits on top of CAD as a recommendation layer and does not replace it or the dispatcher.
