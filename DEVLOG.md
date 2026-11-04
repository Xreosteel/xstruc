# X Struc devlog

Newest entry first. Each scheduled run appends one entry at the top.

## 2026-11-04 · run 5 (manual, with Baji) · backlog #19 fixing view for a tablet

**Done:** Site mode, the first site-crew feature from `DECISIONS.md`.

- **Site mode** button in the header (and `#site` / `?site` in the URL). The page drops to a header, the stage, a side panel and a stepper bar; no inputs panel, inspector or schedule. All buttons are 44 px or taller; Prev / Next are 64 px; one chip per step plus "Finished floor" so a thumb can jump straight to a layer. Enters at step 1 (beam cages); `Next` after the starters shows the finished floor.
- **Stage:** tags 18 px, grid bubbles 36 px, annotations 14 px, step label 18 px; current layer solid, layers below ghosted (ghost and tags forced on, explode off). The legend moves to the bottom-left so it never sits under the step label. The 3D / Plan buttons stay in the header.
- **Side panel (landscape):** "Place now" with one tappable row per run in the layer (label + callout). Tapping a run shows its callout, bar lines, first and last line from the nearest grid with the edge distance in brackets, marks and mass.
- **Bar card:** tap a bar → mark, size and shape name, cut length (32 px), layer and direction, bar line from the nearest grid plus "line *i* of *n* @ spacing", both ends from the nearest grid, lap zones from a grid ("600 lap at the E end, lap zone from 1,680 E of grid 3"), shape code + dims, run callout, note and flags. Bars without a plan axis (starters, ligs, diagonals) show their setout text instead. In portrait the card is a bottom sheet over the stage. `gridRef(v, axis)` and `barAxis(b)` are viewer helpers for now; #20 should move them into the model so the inspector and `check.js` use them too.
- **Camera:** `fitCam` slides each preset along its own direction until the floor's bounding box fits the stage with a margin, so the floor fits in portrait, in the narrow landscape stage next to the panel, and on desktop.
- **Testing:** `window.xstruc` (model, state, selectBar, selectRun, setSite) is a test handle because a headless tap cannot hit a 12 mm bar. `scripts/smoke.js` now enters Site mode at 1024 × 768 and 768 × 1024 and asserts: UI stripped, 9 chips, tag font ≥ 18 px, smallest visible target ≥ 44 px, no page scroll, stage ≥ 380 px tall, Next lands on layer A, the bar card shows cut length / grid setout / laps and stays inside the stage, close returns to the run list, a run tag opens a run card, exit restores the full UI.

**Check:** `check: OK` · `grammar: OK (62 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshots `smoke-6-site-1024.png`, `smoke-6-site-768.png`)

**Parked:** nothing new. Bars at fit zoom are thin in the headless render (16 mm at 25 m); on a tablet the fixer pinches in. A "bars as thick lines when far" LOD is already #12.

**Next run:** backlog #20 (setout from grids on every bar): move `gridRef` / `barAxis` into the model as `b.grid = {line, from, to, laps}`, show it in the desktop inspector, and assert it in `check.js`.

## 2026-11-04 · run 4 (manual, with Baji) · backlog #4 shape-code library

**Done:** real bending geometry on every bar, shape codes and bending dimensions on the schedule.

- `bendGeom(type, size, role)`: pin diameter from the AS 3600 Cl 17.2.3.2 rule (5db main bars, 4db N fitments, 3db R fitments), hook and cog geometry per Cl 13.1.2.7 (extension max(4db, 70); cog has the same bar length as the 180° hook). Values match the research table (Findings 1 / `research/01-bar-bending-shape-codes.md`) for R6–N40; 126 assertions in `scripts/test-shapes.js`.
- `cutLength(pts, g, hookEnds)`: Σ straight legs minus the sharp-corner overshoot at each bend (2·rc·tan(θ/2) − rc·θ), plus 135° hook steel on fitments. The `hooks: 240/200` placeholders are gone. Cut lengths are rounded up to 5 mm; the inspector shows the drawn centreline length beside the cut length when they differ.
- `classify(b)`: CIA core codes S, L, LL, CC (cranked), ZL (cog + crank), T (closed tie) with dims A/B/C/D measured to the bar extremities (centreline leg + db/2 per corner). The schedule has a Dims column and groups marks by code + length + dims; the inspector shows code, name, bends and pin.
- Thin-slab cogs: a drawn cog shorter than the standard cog depth is flagged on the bar, the mark (! in the schedule) and as one model warning. In the 200 example every top-bar cog is flagged (standard N12 cog is 169 deep, outside). Scheduled as drawn; question raised for Baji.
- Cranks: Z-bars at the set-down and the balcony cog + Z now crank at 1:6 or flatter with a ≥300 crank (SRIA TN5 2025), offset one bar alongside the mat. Z-bar cut length 1,232 → 1,630.
- Stock length: `pieces(a, b, size, odd, exS, exE)` leaves room for end cogs so no cut length exceeds 12 m; beam longitudinal bars and `placeLine` bars (edge bars, trimmers, additional) now split with staggered laps too. `check.js` fails on any bar over 12,000.
- Example totals moved from 1,452 bars / 75 marks / 5,266 kg to 1,458 / 78 / 5,300 kg (longer cranks, hook steel, splits).

**Check:** `check: OK` · `grammar: OK (62 cases)` · `shapes: OK (126 assertions)` · `smoke: OK`

**Parked:** cog length for top bars in thin slabs (engineer to specify, e.g. "N12 cogs 100 long" or turn the cog horizontal); XREO's shape dialect and whether scheduled dims stop at the outside of a cog (both already in the planning doc); per-shop hook/cog allowance table (research recommends it be editable) — not built yet.

**Next run:** backlog #5 (lap and development lengths by size and grade; Findings 2 has the rule table) or #7 (geometry editing). Take #5 if Baji has answered the lap-engine question, otherwise #7.

## 2026-11-04 · run 3 (manual, with Baji) · backlog #1–3

**Done:** model inputs panel, callout grammar, callouts drive the mats.

- `index.html` refactored: everything between the MODEL markers is now `buildModel(cfg)` plus `parseCallout(text, {scheme})` and `DEFAULT_CFG`; the viewer builds and tears down the scene from a model object, so the page rebuilds live.
- Inputs panel (left sidebar): grid lines E–W and N–S (mm), slab thickness, cover, f'c, lap (all bars), a callouts textarea (one mat per line, layers A–D, direction E-W / N-S), feature toggles (beams, columns + starters, set-down, step, balcony, openings + trims, extra bars, edge bars + cogs), "Reset to Level 1 example" and "Plain slab". Errors and warnings show inline under the textarea; invalid fields are outlined.
- Geometry features are now derived from the grids (IB1 on grid 2, EB1 on grids A and 1, step in the NE bay, set-down near grid 1/C, stair void near the last grid, riser near grid 1) and are dropped with a warning when they don't fit.
- Grammar covers: counts (`17N16`, `2-N16`, `3 NO. N16`), types N/R/S/W, spacing (`-200`, `@ 200`, `AT 200`, `200 CTS/CRS`), positions (T, B, T&B, T1/T2/B1/B2, EF/NF/FF, central), directions (EW/each way, E-W, N-S, horiz/vert), roles (add/extra, trim, starter, lig/ties, distribution, edge, diagonal), lengths (`x 3000`, `3000 LONG`), mesh (`SL82 T`, `RL918 B`, `3-L11TM BTM`, `2 LAYERS SL82`), thickness (`200 THK`), ABCD scheme for the panel. Mesh and role callouts are recognised but not yet modelled (backlog #6, #7).
- Checks: `scripts/check.js` builds the default example (identical output to run 0: 1,452 bars in pour, 75 marks, 5,266 kg), a plain slab, a no-feature slab, a two-mat slab and a 5 × 4 grid, and asserts error paths; `scripts/test-grammar.js` 62 cases; `scripts/smoke.js` loads the page in headless Chromium (no console errors, live edit, presets, schedule click). `npm test` runs check + grammar.

**Check:** `check: OK` · `grammar: OK (62 cases)` · `smoke: OK`

**Parked:** nothing new. Planning doc questions from runs 1–2 still open.

**Next run:** backlog #4, the shape-code library (use Findings 1 in the planning doc / `xstruc/research/01-bar-bending-shape-codes.md`).

## 2026-11-03 · run 0 (manual, with Baji)

**Done:** prototype viewer built and published; repo set up for scheduled development.

**What exists now**

- Example Level 1 floor: 14.5 × 9.5 m, 200 thick, grids 1–4 / A–C, 12 columns 400 × 400 below (shown as already poured, with 8N24 starters projecting 950 for the columns above).
- Reo layers A (bottom 1st, N16-200 E–W), B (bottom 2nd, N12-200 N–S), C (top 3rd, N12-150 N–S), D (top 4th, N12-150 E–W); laps 600 on all bars (project requirement); 12 m stock, staggered laps.
- Top bars cogged (L) at free edges and void faces; N12 edge bars top and bottom.
- 70 wet-area set-down with Z-bar splices T&B; 200 step up (NE bay) on a 300 nib with paired L-bars T&B.
- Balcony 5000 × 1800, 180 thick, down 50: cog + Z cantilever bars anchored 1500 into the slab, distribution bars cogged, edge bars.
- Beams: IB1 on grid 2 (600 × 400, 3N20 B, 3N16 T, N12 ligs @200) and EB1 edge beams on grids A and 1 (500 × 400, 2N16 T&B, R10 ligs @300), bars with end cogs; column stubs stop at beam soffits.
- Extras: N16 over flat-plate columns, N16 mid-span, N16 over IB1, 2-N12 diagonals at opening corners; 2-bar trimmers T&B at the stair void and riser.
- UI: fixing-order stepper (formwork → beams → A → B → chairs → C → D → starters) with ghosting and explode, tags per run with distribution lines, grid bubbles and dimension strings, true top-down plan view, inspector per bar / run / mark, live bar schedule (75 marks, ~1,450 bars, ~5.3 t).

**Check:** `check: OK — bars 1622 (1452 in this pour), runs 44, marks 75, chairs 123, steel 5266 kg`

**Parked (engineer to confirm):** Z-bar vs splice-bar detail at the 70 set-down; default layer direction when a drawing is silent; N10 and mesh masses to verify against a current catalogue; hook/cog allowances are placeholders until backlog #4.

**Next run:** backlog #1, the model inputs panel.
