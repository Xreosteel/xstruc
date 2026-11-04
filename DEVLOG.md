# X Struc devlog

Newest entry first. Each scheduled run appends one entry at the top.

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
