# @xstruc/reader — from an engineer's drawing to the engine's inputs

Rules, not AI (Baji, 2026-11-23: "don't use a Claude API, make a proper engine that recognizes patterns and builds";
"use the same process when you receive a markup plan"). The reader goes through a slab plan in the order a scheduler
does, each step using what the earlier ones found, and says what it found, what it needs and what it could not use.

| Step | What it looks for | Rule |
| --- | --- | --- |
| 1 Open the drawing | units, what is in the file | `$INSUNITS`, else the size of the drawing (flagged) |
| 2 Grid lines | a long straight line ending in a bubble (circle with a 1–4 character label) | line through the circle's centre, stopping at it; both ends merged |
| 3 Slab edge | the smallest closed polyline around every grid intersection | the edge each side is the coordinate with most edge length along the grids; parts outside that rectangle are balconies (thickness and set-down from the words inside) |
| 4 Openings, set-downs, step | closed shapes inside the slab, named by the text in them or on a leader to them | VOID / PEN / STAIR / RISER … or a void cross → opening; SET DOWN n → set-down; STEP UP n (NIB n) in the north-east corner → step; small squares on grid intersections → columns (seen, not built) |
| 5 General notes | slab thickness, cover, f'c, laps | text patterns (`200 THK`, `COVER 30`, `N32 CONCRETE`, `f'c 32`, `LAPS 600`); none or several different values → asked |
| 6 Reinforcement callouts | every text the engine's callout grammar parses | layer T1/T2/B1/B2 → D/C/A/B (a lone T or B is the outer layer); direction E-W / N-S required; extent = the solid distribution line across the bars next to the callout (ticks preferred, dashed lines never), or on its leader; callouts outside the plan are slab-wide notes |
| 7 Check | stated count vs spacing over the extent; grid dimensions vs drawn spacing; reo-looking text left unread | |
| 8 Build | the engine's FloorInput, then `buildModel` as the verifier | built when the grids, slab edge and at least one mat are there and nothing is missing |

Never guessed: a missing direction or layer number, a value the notes do not give, two different covers. Not built
yet (said in the report): mats over part of the slab, trimmers / extras / balcony bars from callouts (the engine
details them), beams and columns, non-rectangular slabs, a step outside the north-east corner.

`readDxf(text)` → `Sheet` (millimetres, blocks exploded; `src/dxf.ts`, in-house because the complete JS parsers are
GPL-3, research/04). `readPlan(sheet, { values })` → `{ input, missing, steps, found, issues, origin, engine }`.
PDF (pdf.js into the same `Sheet`) is next. Test drawings: `test/fixtures/make.py` (ezdxf), committed.
