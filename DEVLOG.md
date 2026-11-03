# X Struc devlog

Newest entry first. Each scheduled run appends one entry at the top.

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
