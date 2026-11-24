# @xstruc/reader — from an engineer's drawing to the engine's inputs

Rules, not AI (Baji, 2026-11-23: "don't use a Claude API, make a proper engine that recognizes patterns and builds";
"use the same process when you receive a markup plan"). The reader goes through a slab plan in the order a scheduler
does, each step using what the earlier ones found, and says what it found, what it needs and what it could not use.

| Step | What it looks for | Rule |
| --- | --- | --- |
| 1 Open the drawing | units, what is in the file | `$INSUNITS`, else the size of the drawing (flagged) |
| 2 Grid lines | a long straight line ending in a bubble (circle with a 1–4 character label) | line through the circle's centre, stopping at it; both ends merged. None (slabs on ground): the slab's corners are the frame |
| 3 Slab edge | the smallest closed outline around every grid intersection; with no grids the largest outline whose width and height both appear as dimension figures | outlines are closed polylines or rectangles of separate lines meeting at corners; the edge each side is the coordinate with most edge length along the grids; parts outside that rectangle are balconies (thickness and set-down from the words inside); with no grids the size is taken from the dimension figures |
| 4 Openings, set-downs, step | closed shapes inside the slab, named by the text in them or on a leader to them | VOID / PEN / STAIR / RISER … or a void cross → opening; SET DOWN n → set-down; STEP UP n (NIB n) in the north-east corner → step; small squares on grid intersections → columns (seen, not built) |
| 5 General notes | slab thickness, cover, f'c, laps | text patterns (`200 THK`, `COVER 30`, `N32 CONCRETE`, `f'c 32`, `LAPS 600`); none or several different values → asked |
| 6 Reinforcement callouts | every text the engine's callout grammar parses (not reduced levels; meshes from the catalogue only) | a callout written **on** a distribution line (the line runs through the text, broken at it): the bars run across that line, its length is the extent; otherwise the direction must be written (E-W / N-S) and the extent is the solid distribution line across the bars beside the callout (ticks preferred, dashed lines never), or on its leader. Layer T1/T2/B1/B2 → D/C/A/B; "TOP & BOT" is the same bars top and bottom; a lone T or B is the outer layer; one each way on a face → which is outermost is asked; callouts outside the plan are slab-wide notes |
| 7 Check | stated count vs spacing over the extent; grid dimensions vs drawn spacing; reo-looking text left unread | |
| 8 Build | the engine's FloorInput, then `buildModel` as the verifier | built when the grids, slab edge and at least one mat are there and nothing is missing |

Never guessed: a missing direction or layer number, a value the notes do not give, two different covers. Not built
yet (said in the report): mats over part of the slab, trimmers / extras / balcony bars from callouts (the engine
details them), beams and columns, non-rectangular slabs, a step outside the north-east corner.

Sheets that are not plans (sections and details, overall layouts, setting out) are named in step 1, and not built when no dimension confirms the outline. Long narrow strips inside the slab (a trench, channel or kerb) are reported, not built.

`readPdf(pdfjs, bytes, { page })` → `Sheet` (`src/pdf.ts`, pdf.js 6.5.438 passed in: text joined into lines and stacked callouts, paths as lines / polylines / solid fills, plotted dashes rejoined, the scale from the sheet checked against the dimension figures).
`readDxf(text)` → `Sheet` (millimetres, blocks exploded; `src/dxf.ts`, in-house because the complete JS parsers are
GPL-3, research/04). `readPlan(sheet, { values })` → `{ input, missing, steps, found, issues, origin, engine }`.
Test drawings: `test/fixtures/make.py` (ezdxf for DXF, reportlab for `washpad.pdf`, an invented pad drawn the way a real AutoCAD plot comes out), committed. Real client drawings never go in this public repository: `XSTRUC_PRIVATE_PLAN=<path to a PDF> node --test test/pdf.test.ts` runs the private check on a real plan kept outside it.
