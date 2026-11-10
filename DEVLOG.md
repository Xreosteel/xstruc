# X Struc devlog

Newest entry first. Each scheduled run appends one entry at the top.

## 2026-11-10 · run 10 (scheduled) · backlog #9c sheet on site and in print

**Done (built, tested, committed locally — NOT pushed, see Blocker):** the placing sheet joins Site mode and prints on A3.

- Site mode: a **Sheet** chip (44 px, `#btnSiteSheet`) beside 3D / Plan in the header toggles the current layer's placing sheet; the stepper keeps picking the layer, the 3D / Plan chips return to the model, `setSite` no longer turns the sheet off. On the sheet a tap picks a bar within 22 px (a 44 px target) and a tag's hit box is grown to at least 44 px; the card opens as before. Two pointers pinch-zoom about their midpoint (`fingers` map, `pinch`; the end of a pinch is not a tap); the wheel zoom shares `zoomAt`. The title strip keeps to a sixth of the stage in site mode (the run list beside the sheet carries the callouts), and the scale note drops to the title's second line on a narrow stage so it no longer collides with the title.
- Mark highlight on the sheet: `highlightMark(m)` is shared by the schedule row and new mark chips on the site run card (`.markchip`, 44 px). With the sheet up it steps to the mark's layer (in 3D it still jumps to the finished floor when the layer is not placed yet) and the sheet draws `sheetMarksFor(S, mark)` (headless, between the MODEL markers): every label of that mark across the layer's runs, filled in the layer colour, with "MARK A38 HIGHLIGHTED: 10 × N16 · 1,790 LG" in the title band. Site mode gets a mark card (`siteCardMark`); `apply()` keeps it while a mark is highlighted.
- Print: `@page A3 landscape, 10 mm margins`; `beforeprint` (and the `print` media-query change) call `printPrep(true)`: `html.print` hides everything but the stage, sized 400 × 277 mm, the sheet is turned on if it was not, and `sheetFit` picks the largest standard scale that fits the drawable area with `sheetPrintScale(bounds, dw, dh)` (preferred scales of AS 1100.101 / ISO 5455 plus 1:25 / 1:75 / 1:125 / 1:150; `PRINT_SCALES`, `PAPER_MM`), white paper, canvas at 2.5× (~240 dpi), "SCALE 1 : 75 @ A3 · N ↑" and "X STRUC · EXAMPLE FLOOR · PRINTED <date>" top right; `afterprint` restores the screen layout (and leaves the sheet off if it was off). A **Print sheet · A3** button under the sheet toggle calls `window.print()` in a try/catch (no `window.open`, no download; in a sandboxed viewer nothing happens and Ctrl/Cmd+P is the way). Printing from the 3D view without the sheet shows a one-line note instead of the dark UI.
- `check.js`: for every one-layer sheet of every config, every mark on the sheet has ≥ 1 highlight label and every label names a bar of that mark on that sheet, none on the finished floor; the print scale for A3 and A4 landscape is a standard scale, fits the drawable area, and is the largest that fits (mutation-checked: a wrong scale pick and empty labels both fail).
- `smoke.js`: at 1024 × 768 and 768 × 1024 the Sheet chip shows the layer A sheet (8 tags, BM ghosted), the chip is ≥ 44 px, a tap on a bar opens its card with the cut length, a synthetic two-pointer pinch zooms ×2 and keeps the selection, the 3D chip leaves the sheet; a schedule row steps the sheet to layer C and draws the mark's labels (`drawnMarks`); `printPrep(true)` lays out 1512 × 1047 px (A3 less margins), 1 : 75, canvas 3780 px wide, chrome hidden; `page.pdf` (Chromium fires beforeprint / afterprint) writes `smoke-12-print-A3.pdf` — looked at it: the sheet alone on the page, grids, tags, strip; `printPrep(false)` restores the stage. New screenshots `smoke-11-sheet-mark.png`, `smoke-12-print-A3.png`, `smoke-13-site-sheet-1024.png`, `smoke-13-site-pinch-768.png` (looked at all four).
- Example totals unchanged: 1,458 bars / 78 marks / 5,300 kg.

**Check:** `check: OK` · `grammar: OK (82 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshots `smoke-12-print-A3.png`, `smoke-13-site-sheet-1024.png`, `smoke-13-site-pinch-768.png`, `smoke-11-sheet-mark.png`)

**Blocker — push denied:** `git push origin main` → 403 "Permission to Xreosteel/xstruc.git denied to bajixy"; the GitHub MCP (installation) → 403 "Resource not accessible by integration"; `repos/Xreosteel/xstruc` reports `push: false` for this session's token. This session had no `add_repo` / `register_repo_root` tool (the claude-code-remote server only offered the scheduled-task tools), so the repo was attached read-only. Earlier runs pushed as the Claude GitHub App. The two commits of this run (`feat: placing sheet on site and in print (#9c)` and this devlog) are saved to the X Struc project as `xstruc/patches/run-10-9c.patch` (apply with `git am`), and `index.html`, `scripts/*`, `DEVLOG.md`, `BACKLOG.md` are saved there too. The viewer artifact was republished from the tested `index.html`. GitHub Pages is therefore one run behind the artifact until the patch lands.

**Parked:** nothing engineering. For Baji: give the scheduled run push access again (the Claude GitHub App on Xreosteel/xstruc, or the task's repo attachment with "push"), then the next run applies the patch first.

**Next run:** first `git am` `xstruc/patches/run-10-9c.patch` from the project (or re-apply from the project copies of the files) and push; check the Pages run. Then backlog #7 (geometry editing: openings, set-downs, steps and the balcony as editable lists in the inputs panel, x0 y0 x1 y1 depth, add / remove rows, model rebuilds). It is big: split it (7a openings + balcony as lists, 7b set-down + step) and do 7a.

## 2026-11-05 · run 9 (scheduled) · backlog #9b tags and marks on the placing sheet

**Done:** the one-layer placing sheet now reads like a placing drawing: run tags on their distribution lines, leaders when a tag is pushed, lap zones, bar marks for the selected run, and a title strip. All layout is computed headlessly in `buildSheet`; the canvas only draws it.

- Paper text: tags, marks and feature notes are sized in plan mm (`SHEET_TXT`: tags 220, marks 150, notes 170, mono advance 0.6 em), so the declutter result is fixed and holds at any zoom, like a drawing at scale (220 mm = 2.2 mm on paper at 1 : 100). Text under 5 px is not drawn (box only).
- `sheetTags(M, S)`: one tag per labelled run of the layer being placed. A run with a distribution line (`r.dist`) gets `distLines[]` (the spread of its bar lines, dots on the first and last bar) and its tag 90 mm beside that line at `r.dist.frac`, slid along the line and to either side to find room; failing that it is pushed outward and a leader runs from the box to the line. A run with a tag anchor (Z-bars, L-bars, trimmers, extras, beams, starters) starts at `r.tagPos` and points a leader at the nearest of its bars when that bar is not under the box. Feature notes and earlier tags are obstacles (main mats first). No active-layer tag is ever dropped; the last resort is the first choice, flagged `overlap` (drawn with a red border). No tags on the finished floor (the 3D view has them).
- `sheetLaps(S)`: one lap zone per pair of lapped bars from `b.grid.laps` (#20), on the bar line, listing both bars. Drawn as an orange band under the bars; the selected bar's zones are stronger and labelled "600 LAP".
- `sheetMarks(S)`: per run, every distinct mark gets a label beside its bar's longest leg (sliding along the bar to find room); repeats are kept only where they do not collide. The viewer shows the set for the selected run (or the selected bar's run); the selected bar's own mark is filled in the layer colour.
- `S.strip`: floor, layer, thickness, N32, cover, laps, bar and mark count, mass, and the layer's callouts (main mat first). Drawn at the foot of the sheet in one or two columns (capped at a third of the stage), above the hint line; the fit now leaves room for the title band and the strip.
- Viewer: clicking a tag on the sheet selects its run (inspector, 3D, schedule in sync, marks appear); hovering a tag shows its callout and bar count; notes are drawn as paper text before the tags.
- `check.js`: `checkSheetNotes` on all eight sheets of every config: one tag per labelled run, text = label, inside the bounds, no tag overlapping another tag or a note, box big enough for its text; dist tags anchored on their line, 90 beside it when unpushed, a leader from the box to the line when pushed; anchor tags anchored on one of their bars with a leader exactly when the bars are > 20 mm from the box; distribution lines match `r.dist` and the run's bar count; every lapped bar end's zone on the sheet and the zone the lap long; every distinct mark of every run labelled and unflagged labels not colliding; strip counts and mass match the ink bars, main callout first. A crowded fixture (every layer-D tag anchored at one point, N12-60 top mat over four bays) must push ≥ 5 tags out with leaders and still overprint nothing. Mutation-checked: dropping the tag collision test, the leader, or a lap bar from a zone each fails the check. (The mark-label slide and the tag last-resort paths are not reached by any config yet.)
- `smoke.js`: on the layer A sheet, asserts tags, distribution lines, lap zones and the callout strip; clicks the main mat tag at its canvas position and checks the run is selected with ≥ 5 mark labels and the inspector shows N16-200; zooms in four wheel steps for a readable screenshot; layer D shows tags and lap zones with no overlap flag. New screenshots `smoke-10-sheet-tags-A.png`, `smoke-10-sheet-zoom-A.png` (looked at both and `smoke-9-sheet-D.png`: tags clear of notes and each other, laps visible on D).
- Example totals unchanged: 1,458 bars / 78 marks / 5,300 kg. Viewer republished (artifact version 11). GitHub Pages run for 13cf071: success.

**Check:** `check: OK` · `grammar: OK (82 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshots `smoke-10-sheet-tags-A.png`, `smoke-10-sheet-zoom-A.png`, `smoke-9-sheet-D.png`)

**Parked:** nothing new. Notes for later: at fit zoom on a 700 px stage the feature notes are ~7 px (they are paper text now; zoom in to read, and 9c's print scale fixes it on paper). The first `git push` was rejected twice by the remote with "fatal error in commit_refs_rules" and went through on a later retry with no change; if it recurs, retry after a minute before treating it as a blocker.

**Next run:** backlog #9c (sheet on site and in print): a 3D / Sheet chip in Site mode per layer with 44 px targets and pinch zoom on the canvas, the schedule-mark highlight drawn on the sheet (it already dims other bars; add the marks for the highlighted mark), and a light print layout that fits A3 landscape (print CSS + a canvas redraw at the print size; no downloads or window.open).

## 2026-11-04 · run 8 (scheduled) · backlog #9a 2D placing sheet for one layer

**Done:** backlog #9 split in place into 9a / 9b / 9c (the previous entry asked for it); 9a built: a per-layer placing sheet drawn on a canvas, from a headless description of the drawing.

- `buildSheet(M, solid, ghost)` sits between the MODEL markers (exported to the scripts). It returns plan geometry in mm: every non-existing bar of the solid and ghost layers as a plan polyline (vertical legs collapse to their point), a tick for each turned-down end leg (`cogs[]` with position, unit normal perpendicular to the adjoining leg, leg height, `start`/`end`), starters' vertical legs flagged `kind: "vertical"` (drawn end-on as a circle), chairs as points, grids with bubble positions, dimension strings between grids, concrete outlines (slab, holes, set-down, step + nib, balcony, beams dashed, columns), the feature notes, two title lines, and `dims[]`: for a one-layer sheet, the setout from the nearest grid to each run's first and last bar line (`r.grid`, #20), placed on the run's distribution line so the #9b tag will read with it. Bounds are slab ± 1,700 (balcony included).
- Viewer: a **2D placing sheet** button under the camera presets. It hides the WebGL stage and tags, shows a paper-coloured canvas, skips the WebGL frame while it is up, and draws the sheet: drag to pan, wheel to zoom (around the cursor), double-click to fit, screen scale ("1 : 98 on this screen") top-right, a title band, and the 3D / Plan / Side / Fit buttons return to 3D. The build sequence picks the layer: that layer in ink, the layers already fixed below in faint grey when Ghost below is on (nothing below when it is off), and the finished floor in layer colours. Clicking a drawn bar (7 px tolerance, chairs on their step) calls the same `selectBar`, so the inspector, the schedule row and the 3D selection stay in sync; the selected bar is drawn in its layer colour with a halo; a schedule-mark or run highlight dims the other bars. Site mode turns the sheet off for now (9c).
- `scripts/check.js`: `checkSheets` builds the seven fixing-step sheets plus the finished floor for every config and asserts the ink / ghost bar counts, that each polyline equals the bar's projected points inside the bounds, that cog ticks equal the turned-down end legs and are perpendicular at the bar end, starters show one vertical leg, layer D is cogged, grids / grid dims / chairs match the model, every run end off a grid line has a dim that matches `r.grid` and sits on the run's distribution line, and the titles. Verified it fails when cog detection or the balcony dims are broken.
- `scripts/smoke.js`: turns the sheet on (canvas visible, WebGL stage hidden, 1,458 bars on the finished-floor sheet), steps to layer A (238 bars in ink, BM ghosted, 4 setout dims), clicks the third mat bar at its canvas position and checks the inspector shows its mark, steps to layer D (248 cog ticks), returns to 3D with the selection kept. Screenshots `smoke-9-sheet-all.png`, `smoke-9-sheet-A.png`, `smoke-9-sheet-D.png`.
- Example totals unchanged: 1,458 bars / 78 marks / 5,300 kg. Viewer republished (artifact version 10).

**Check:** `check: OK` · `grammar: OK (82 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshots `smoke-9-sheet-A.png`, `smoke-9-sheet-D.png`)

**Parked:** nothing new. Two things to watch in 9b: the balcony runs' setout dims sit close to grid C and the vertical dim text is cramped at fit zoom (tags with leaders will reorganise that corner); at 150 spacing the bars merge into a grey block at fit zoom on a 700 px stage (expected; a tablet zooms in, and 9c sets the print scale).

**Next run:** backlog #9b (tags and marks on the sheet): run tags on their distribution lines with leader lines when pushed, lap zones marked on lapped bars, bar marks beside the selected run's bars, a title strip with the layer's callouts. Put the tag and lap-zone geometry into `buildSheet` (headless, asserted in `check.js`) and keep the canvas renderer dumb.

## 2026-11-04 · run 7 (scheduled) · backlog #21 layer direction must be stated

**Done:** a mat callout that does not say which way it runs is an error in the inputs panel, per `DECISIONS.md` (no default direction). The model never guesses.

- `matDirectionError(direction)` sits between the MODEL markers next to the grammar and is exported to the scripts. Only `X` (E-W) and `Y` (N-S) build a mat. Silence → "say which way this mat runs: E-W or N-S (no direction is assumed)"; `EW` / each way → "covers two layers; give each layer its own direction"; `H` / `V` / `LONG` / `TRANS` → "<word> is a wall or beam direction; a slab mat runs E-W or N-S". The old fallback (`A`/`D` → E-W, `B`/`C` → N-S) is gone: `m.dir = m.dirIn`.
- A rejected line is not built; the other mats still parse so every bad line reports at once. The "No mat for layer X" warning is skipped when a line named that layer but was rejected (the error already says so). The viewer keeps the last good model and outlines the callouts field, as before for any line error.
- Panel copy: label "…and which way it runs (E-W or N-S)", placeholder `N16-200 A E-W`, hint "Every mat must say which way it runs: E-W or N-S, one direction per layer; nothing is assumed when the drawing is silent."
- `parseCallout` itself is unchanged: `direction` stays a grammar field (null when absent) so the TB-scheme cases still parse; the rule lives in the model where the layer is known.
- Tests: `test-grammar.js` +11 ABCD direction cases and 9 `matDirectionError` cases (62 → 82); `check.js` builds an undirected mat (exactly one error, layer A not built, B and D still built with their stated directions), an each-way / horizontal / transverse set (only the N-S line survives), asserts every built mat has `dir === dirIn ∈ {X, Y}`, and the old bad-callouts fixture now states its directions. Verified the new check fails when the fallback is put back. `smoke.js` types an undirected mat, asserts the error line, `aria-invalid`, the open panel and an unchanged bar count; new screenshot `smoke-8-direction-error.png`.
- Example totals unchanged: 1,458 bars / 78 marks / 5,300 kg.

**Check:** `check: OK` · `grammar: OK (82 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshot `smoke-8-direction-error.png`)

**Parked:** nothing new. The "layer direction when the drawing is silent" item is removed from Parked: it is decided (error, no default).

**Next run:** backlog #9 (per-layer placing drawing, 2D canvas per layer with bars as lines, tags with distribution lines, setout dimensions from grids, cogs as ticks; keep selection in sync with 3D). It is big: split it in `BACKLOG.md` (9a: canvas sheet for one layer with bars, grids and dims; 9b: tags + distribution lines + cog ticks; 9c: selection sync and site-mode use) and do 9a.

## 2026-11-04 · run 6 (scheduled) · backlog #20 setout from grids on every bar

**Done:** grid setout moved from the site view into the model, shown on the desktop inspector as well as the site card, and asserted headlessly.

- `nearestGrid(G, v, dirs, useGrid)`, `barAxis(b)` and `gridSetout(b, GX, GY, lap)` now live between the MODEL markers (the viewer's `gridRef` / `barAxis` are gone). `addBar` attaches `b.grid = {dir, ends, line, from, to, laps[], lineIndex, n, sp}` to every bar with a plan axis; each ref is `{v, grid, at, d, side, text}` measured from the nearest grid line ("1,680 E of grid 3", "on grid A"). Column bars and diagonals have no `grid` and keep their setout text.
- Lap zones: `{end, len, a, b, text}` from the bar end inwards by the lap; both ends of a zone are measured from the same grid (the one nearest the bar end) so one tape setting marks it. Wording: "600 lap at the E end, lap zone 2,820 W of grid 4 to 2,220 W of grid 4". The neighbouring bar's zone resolves to the same mm range from its own nearest grid.
- Mat bars carry `line` (bar line *i*); `runSetout` gives main and balcony runs `r.grid = {first, last, n, sp}`; balcony runs now have `n` / `sp` too, so their bars show "line *i* of *n* @ sp".
- Desktop inspector: a bar shows Bar line, Runs (W/E or S/N end from the nearest grid) and Laps rows from `b.grid`; a fitment shows its position along the beam; a run shows First line / Last line from grids with the slab-edge distance in brackets. The site card reads the same rows (`gridRows`, `runGridRows`).
- `check.js`: `checkGridSetout` on every config: every straight plan bar has `grid`; each ref adds up (`at + d == v`), names a real grid, is the nearest one and matches the geometry; from/to span equals the plan length; lap zone count equals the lap flags, length equals the lap, ends share a grid and sit at the bar end; bar-line index reconstructs the line position from the run's first line; runs cover all *n* lines; ≥ 50 lap zones on the example. Verified the assertions bite by breaking the zone length and the nearest-grid rule.
- `smoke.js`: selects a lapped layer-D bar and the layer-C run on the desktop and asserts the inspector shows the grid-based bar line, ends and a same-grid lap zone; the site card must show a lap zone "from a grid". New screenshot `smoke-7-inspector.png`.
- Example totals unchanged: 1,458 bars / 78 marks / 5,300 kg.

**Check:** `check: OK` · `grammar: OK (62 cases)` · `shapes: OK (126 assertions)` · `smoke: OK` (screenshots `smoke-6-site-1024.png`, `smoke-7-inspector.png`)

**Parked:** nothing new.

**Next run:** backlog #21 (layer direction must be stated): make a mat callout without E-W / N-S an error per `DECISIONS.md`, update the hint text, the example callouts (already stated), `test-grammar.js` and `check.js` ("two mats only" and "no features at all" configs rely on the guessed default and need directions added).

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
