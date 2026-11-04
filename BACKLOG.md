# X Struc backlog

Ordered. Each scheduled run takes the **top unchecked item**, finishes it, ticks it, and logs in `DEVLOG.md`.
An item too big for one run is split into sub-items in place (keep the order). Never skip ahead without a note in the devlog saying why.

Conventions every item must respect are in `CLAUDE.md`.

## Phase 1 · assisted MVP: input panel + kernel

- [ ] **1. Model inputs panel.** Add a collapsible "Model inputs" section to the left sidebar: slab length, width, thickness, cover, concrete grade, lap length, bottom spacing, top spacing. Changing a value rebuilds the model and the scene (dispose old meshes, rebuild instanced meshes, tags, schedule, stats). The current Level 1 example stays as the default preset. Keep the model block between the MODEL markers so `scripts/check.js` still runs it.
- [ ] **2. Callout grammar.** Write `parseCallout(text)` that returns `{count, type, size, spacing, layer, direction, role, raw}` for Australian notation: `N12-200`, `N12 @ 200`, `N12-200 CTS`, `17N16-250 T`, `N16-200 T&B EW`, `SL82 TOP`, `RL918 B`, `2-N16 TRIMMERS`, `ADD N16-200 T1 x 3000`, layers `T/B/T1/T2/B1/B2/A/B/C/D`, directions `EW/BW/E-W/N-S/X/Y`. Add `scripts/test-grammar.js` with at least 40 cases taken from the notation reference (link in README) and wire it into `npm test` alongside `check.js`.
- [ ] **3. Callouts drive the mats.** In the inputs panel, a textarea with one callout per line (default: the four mats of the example). Parsed callouts replace the hard-coded `MATS` array. Unknown or ambiguous lines show an inline error with the reason and do not crash the build.
- [ ] **4. Shape-code library.** Replace the placeholder hook allowances (`hooks: 240`, `hooks: 200`, nominal 300 cogs) with a `SHAPES` table: straight, L (cog one end), LL (cog both ends), Z, U, closed lig, L starter. Cog and hook lengths and pin diameters by bar size from AS 3600 standard hooks/cogs (look up the clause; cite it in a comment). Schedule rows show the shape code and the bending dimensions (A, B, C…) instead of a word.
- [ ] **5. Lap and development lengths by size and grade.** Table keyed by bar size and f'c (slab, beam, column/wall cases as in the Newcastle B23 notes), used when the inputs panel's lap field is set to "per table" instead of a fixed number. Current project requirement (600 all bars) stays the default.
- [ ] **6. Mesh (SL/RL) as a reinforcement type.** `SL82 T` in a callout lays 6.0 × 2.4 sheets with side and end laps, renders the wires, and adds a mesh schedule / cutting list below the bar schedule.
- [ ] **7. Geometry editing.** Openings, set-downs, steps and the balcony become editable lists in the inputs panel (x0, y0, x1, y1, depth). Add/remove rows; the model rebuilds.

## Phase 1b · viewer polish

- [ ] **8. Stair flight in the stair void.** Waist 180, risers/goings from the void size, main bars cranked at the landing, distribution bars, top bars into the landing, starters from the slab. New layer group "STAIR" after the top mats.
- [ ] **9. Per-layer placing drawing (2D).** A canvas view per layer that reads like a placing drawing: bars as lines, tags with distribution lines, setout dimensions from grids, cogs as ticks. Switch between 3D and the 2D sheet; keep selection in sync.
- [ ] **10. Section cut tool.** A movable section plane (N–S or E–W) that clips the model and shows a true section with the layer stack and cover.
- [ ] **11. Tag declutter.** Replace greedy collision hiding with leader lines when a tag is pushed off its run; keep the active layer's tags always visible.
- [ ] **12. Performance.** three-mesh-bvh for picking, LOD for far bars (lines), bundle check: viewer still 60 fps at 50k bars.

## Phase 2 · outputs

- [ ] **13. Copy bar schedule as CSV / TSV.** A "Copy" button (downloads are blocked inside the artifact viewer, so copy to clipboard with a fallback that selects the text).
- [ ] **14. Revision diff.** Keep the previous model in memory; show bars added / removed / changed in red / green and the mass delta per mark.
- [ ] **15. Determinism snapshot test.** `scripts/snapshot.js` writes the schedule (marks, lengths, qty, kg) to `test/snapshot.json`; the check fails if it changes without `--update`.

## Phase 3 · drawing input

- [ ] **16. DXF reader.** Parse LINE, LWPOLYLINE, TEXT, MTEXT, INSERT (exploded) from a DXF uploaded through a file input; map layers by name patterns to slab outline / openings / callouts; show the result on the 2D sheet before building.
- [ ] **17. Scale calibration.** Two-point click plus a typed distance; dimension-entity check.
- [ ] **18. Callout-to-zone association.** Leader tracing, distribution-line extent, then point-in-polygon, with a confidence score shown on each tag.

## Done notes

- #1–3 (2026-11-04): `buildModel(cfg)` builds everything from grids, thickness, cover, f'c, lap, callouts and feature toggles; `parseCallout(text, {scheme})` is the grammar (62 test cases in `scripts/test-grammar.js`); the inputs panel rebuilds the scene live with inline errors. Extras/trimmers/additional bars from callouts are still example-driven (see #7). `scripts/smoke.js` runs the page in headless Chromium with a local three.js.

## Parked (needs a human decision first)

- Crank vs splice-bar detail at shallow set-downs (currently Z-bars; many firms use splice bars). Ask the engineer.
- Layer direction convention when the drawing is silent (currently outer layers E–W).
- N10 mass and mesh sheet masses: verify against a current InfraBuild / ARC catalogue before shipping.
