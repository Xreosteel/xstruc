// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { LBY } from "./constants.ts";
import { fmt } from "./bending.ts";
import { sheetLaps, sheetMarks, sheetTags } from "./sheet-annotate.ts";
import { sheetPanelBlocks, sheetPanelSymbols } from "./sheet-panel.ts";

// ---------- 2D placing sheet (backlog #9a) ----------
// One layer's placing drawing as plain geometry in plan millimetres (x east, y north): bars as polylines, cogs and
// hooks as ticks, grid lines with bubbles and dimension strings, concrete outlines, and setout dimensions from the
// nearest grid line to the first and last bar line of every run (r.grid, #20). Headless on purpose: the viewer
// draws it on a canvas and a later DXF / PDF export can write the same primitives. solid = layer ids drawn in ink,
// ghost = layer ids drawn faint (the layers already fixed below). Bars with existing: true are context only and stay off the sheet.
function buildSheet(M, solid, ghost) {
  solid = (solid || []).slice(); ghost = (ghost || []).filter(l => solid.indexOf(l) < 0);
  // EXT = the slab plus its balconies (#7c); the grid lines, bubbles and dimension strings frame all of it
  const PNL = M.kind === "panel";   // a precast panel (#33): no grids; set out from its edges, sized overall
  const SL = M.SL, EXT = M.EXT, ext = 1450, DYL = PNL ? -700 : Math.min(M.gy[0] - 1050, EXT.y0 - 800), DXL = PNL ? -700 : Math.min(M.gx[0] - 1050, EXT.x0 - 800);
  const rect = (r, id) => ({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, id: id || r.id || "" });
  const beamRect = bm => bm.dir === "X" ? { x0: bm.a, x1: bm.b, y0: bm.at - bm.w / 2, y1: bm.at + bm.w / 2, id: bm.id } : { x0: bm.at - bm.w / 2, x1: bm.at + bm.w / 2, y0: bm.a, y1: bm.b, id: bm.id };
  const S = {
    solid: solid, ghost: ghost, layer: solid.length === 1 ? solid[0] : null,
    bounds: PNL ? { x0: EXT.x0 - 1300, x1: EXT.x1 + 700, y0: EXT.y0 - 1300, y1: EXT.y1 + 1500 } : { x0: EXT.x0 - 1700, x1: EXT.x1 + 1700, y0: EXT.y0 - 1700, y1: EXT.y1 + 1700 },
    concrete: {
      slab: rect(SL, PNL ? "PANEL" : "SLAB"), holes: M.HOLES.map(h => Object.assign(rect(h), h.edge ? { edge: true, kind: h.kind } : {})),
      outline: M.outline || null,   // a panel's net outline with its doors and notches cut out (#33f); null for a floor
      drops: M.DROPS.map(dd => rect(dd, "SET DOWN " + dd.d)),
      step: M.STEP ? { rect: rect(M.STEP, "STEP UP " + M.STEP.rise), nib: M.STEP.nib } : null,
      balconies: M.BALCS.map(b => rect(b, b.plain ? "BALCONY" : b.id)),
      // the stair flight (#8) below the slab: its plan footprint and the riser lines, drawn dashed like the beams
      stair: M.STAIR ? { rect: rect(M.STAIR.foot, "STAIR"), risers: Array.from({ length: M.STAIR.n }, (_, k) => { const a = M.STAIR.P(k * M.STAIR.G, M.STAIR.c0, 0), b = M.STAIR.P(k * M.STAIR.G, M.STAIR.c1, 0); return [a[0], a[1], b[0], b[1]]; }), up: M.STAIR.arrive } : null,
      beams: M.BEAMS.map(beamRect),
      cols: M.COLS.map(c => ({ x0: c.x - M.COL / 2, x1: c.x + M.COL / 2, y0: c.y - M.COL / 2, y1: c.y + M.COL / 2, id: c.name }))
    },
    grids: {
      x: M.GX.map(g => ({ name: g[0], v: g[1], a: EXT.y0 - ext + 250, b: EXT.y1 + ext - 250, bub: [EXT.y0 - ext, EXT.y1 + ext] })),
      y: M.GY.map(g => ({ name: g[0], v: g[1], a: EXT.x0 - ext + 250, b: EXT.x1 + ext - 250, bub: [EXT.x0 - ext, EXT.x1 + ext] }))
    },
    gridDims: [], notes: [], bars: [], chairs: [], dims: [], title: []
  };
  // dimension strings between grid lines, as on the general arrangement: measure = the axis the number is along, at = where the line sits on the other axis
  if (!PNL) for (let i = 1; i < M.gx.length; i++) S.gridDims.push({ measure: "x", a: M.gx[i - 1], b: M.gx[i], at: DYL, text: fmt(M.gx[i] - M.gx[i - 1]) });
  if (!PNL) for (let i = 1; i < M.gy.length; i++) S.gridDims.push({ measure: "y", a: M.gy[i - 1], b: M.gy[i], at: DXL, text: fmt(M.gy[i] - M.gy[i - 1]) });
  if (PNL) S.gridDims.push({ measure: "x", a: 0, b: M.L, at: DYL, text: fmt(M.L) }, { measure: "y", a: 0, b: M.W, at: DXL, text: fmt(M.W) });
  // feature notes, same wording as the 3D annotations
  if (PNL) S.notes.push({ x: (SL.x0 + SL.x1) / 2, y: SL.y1 + 950, text: M.name + " · " + fmt(M.L) + " × " + fmt(M.W) + " × " + M.T + " · " + M.panel.castFace + " ON THE BED · VIEWED FROM " + M.panel.topFace + " · TOP EDGE ↑" });
  else S.notes.push({ x: (SL.x0 + SL.x1) / 2, y: SL.y0 + M.W * 0.72, text: M.cfg.name.toUpperCase() + " · " + M.T + " THK SLAB" });
  M.DROPS.forEach(dd => S.notes.push({ x: (dd.x0 + dd.x1) / 2, y: (dd.y0 + dd.y1) / 2, text: "SET DOWN " + dd.d + " · " + dd.id }));
  if (M.STEP) S.notes.push({ x: (M.STEP.x0 + M.STEP.x1) / 2, y: (M.STEP.y0 + M.STEP.y1) / 2, text: "STEP UP " + M.STEP.rise });
  M.BALCS.forEach(b => S.notes.push({ x: b.note[0], y: b.note[1], text: b.label }));
  M.HOLES.forEach(h => S.notes.push({ x: (h.x0 + h.x1) / 2, y: h.small ? h.y0 - 250 : (h.y0 + h.y1) / 2, text: h.label }));
  if (M.STAIR) { const q = M.STAIR.P(M.STAIR.run * 0.7, M.STAIR.cc, 0); S.notes.push({ x: q[0], y: q[1], text: M.STAIR.label }); }
  M.BEAMS.forEach(bm => S.notes.push({ x: bm.dir === "X" ? bm.a + (bm.b - bm.a) * 0.52 : bm.at + 520, y: bm.dir === "X" ? bm.at : bm.a + (bm.b - bm.a) * 0.36, text: bm.id + " " + bm.D + " × " + bm.w }));
  // bars: plan polyline (vertical legs collapse to their point); a near-vertical leg at either end is a cog or hook,
  // drawn as a tick of the leg's height, perpendicular to the bar, as on a placing drawing
  const planLen = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  const want = {}; solid.forEach(l => { want[l] = false; }); ghost.forEach(l => { want[l] = true; });
  M.bars.concat(M.wires || []).forEach(b => {   // mesh wires (#33) draw as thin lines and pick their sheet
    if (b.existing || !(b.layer in want)) return;
    const pts = [];
    b.pts.forEach(p => { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1) pts.push([p[0], p[1]]); });
    const cogs = [], n = b.pts.length, planTotal = pts.reduce((s, p, i) => i ? s + planLen(pts[i - 1], p) : 0, 0);
    const tick = (k, legFrom, legTo) => {   // k = index of the vertical leg's outer point, leg = the adjoining plan leg
      const dz = Math.abs(b.pts[k][2] - b.pts[k === 0 ? 1 : n - 2][2]);
      if (dz < 20) return;
      const d = planLen(legFrom, legTo); if (d < 1) return;
      const ux = (legTo[0] - legFrom[0]) / d, uy = (legTo[1] - legFrom[1]) / d;
      // a short turned-down leg is a cog (tick); a leg taller than the bar's plan length is a vertical bar (a starter), shown end-on
      cogs.push({ x: b.pts[k][0], y: b.pts[k][1], nx: -uy, ny: ux, len: Math.round(dz), end: k === 0 ? "start" : "end", kind: dz > planTotal ? "vertical" : "cog" });
    };
    if (n >= 3 && planLen(b.pts[0], b.pts[1]) < 1) tick(0, b.pts[1], b.pts[2]);
    if (n >= 3 && planLen(b.pts[n - 2], b.pts[n - 1]) < 1) tick(n - 1, b.pts[n - 3], b.pts[n - 2]);
    S.bars.push({ id: b.id, bar: b, layer: b.layer, pts: pts, cogs: cogs, w: b.size, ghost: want[b.layer], point: pts.length === 1 });
  });
  if ("CH" in want) M.chairs.forEach(c => S.chairs.push({ x: c.pts[0][0], y: c.pts[0][1], ghost: want.CH }));
  // setout dimensions from the nearest grid to the first and last bar line of each run on a one-layer sheet, drawn on
  // the run's distribution line so the tag (#9b), the pitch and the setout read together
  if (S.layer) M.runs.forEach(r => {
    if (r.layer !== S.layer || !r.grid || !r.dist) return;
    const X = r.dir === "X";
    [[r.grid.first, "first"], [r.grid.last, "last"]].forEach(gw => {
      const g = gw[0]; if (Math.abs(g.d) < 5) return;
      S.dims.push({ measure: X ? "y" : "x", a: g.at, b: g.v, at: r.dist.at, text: fmt(Math.abs(g.d)), grid: g.grid, run: r.id, which: gw[1] });
    });
  });
  if (PNL) sheetPanelSymbols(M, S, want);   // insert symbols and the CoG cross go first: the run tags keep clear of them (#33d)
  sheetTags(M, S); sheetLaps(S); sheetMarks(S);
  if (PNL) sheetPanelBlocks(M, S, want);    // notes, approval, legend, insert table and opening setout: outside the panel, bounds grow to hold them
  // title lines
  const LB = M.LBY || LBY, lname = l => (LB[l] ? LB[l].name : l).toUpperCase();
  const mt = S.layer && M.matText ? M.matText[S.layer] : null;
  const mat = mt && mt !== "no mat" ? " · " + (lname(S.layer).indexOf("MESH") >= 0 && /mesh, /.test(mt) ? mt.replace(/^.*mesh, /, "") : mt).toUpperCase() : "";   // a mesh layer's name already says which mesh
  S.title.push(M.cfg.name.toUpperCase() + (PNL ? " · PANEL SHEET · " : " · PLACING SHEET · ") + (S.layer ? lname(S.layer) + mat : solid.length ? "ALL LAYERS" : "FORMWORK"));
  // the lap this layer is placed with (#5): its mat's lap, from the table when one is in use, else the flat lap
  const inkSheets = [...new Set(S.bars.filter(x => !x.ghost && x.bar.wire).map(x => x.bar.sheet))];
  const meshLap = S.layer ? inkSheets.find(pc => pc.laps) : null;   // a mesh layer's sheet is placed with the mesh laps (#6)
  const lapTxt = S.layer && M.mats[S.layer] ? "LAP " + M.mats[S.layer].lap.len + (M.laps.source === "table" ? " (TABLE)" : "") : meshLap ? "MESH LAPS " + meshLap.laps.end + " END / " + meshLap.laps.side + " SIDE" : M.laps.source === "flat" ? "LAPS " + M.cfg.lap : "LAPS PER TABLE";
  const sheetsTxt = inkSheets.length ? " + " + inkSheets.length + " MESH SHEET" + (inkSheets.length > 1 ? "S" : "") : "";
  S.title.push(M.T + " THK · COVER " + M.C + " · " + lapTxt + " · " + (S.layer ? S.bars.filter(x => !x.ghost && !x.bar.wire).length + " BARS THIS LAYER" + sheetsTxt : fmt(M.sched.length) + " BARS" + sheetsTxt) + (ghost.length ? " · BELOW: " + ghost.join(" ") : ""));
  // title strip (#9b): what a fixer reads before placing the layer. Callouts are the runs' drawing wording, main mat first.
  const inkBars = S.bars.filter(x => !x.ghost && !x.bar.wire);
  const layerRuns = S.layer ? M.runs.filter(r => r.layer === S.layer && r.callout && (r.bars.some(b => !b.existing) || (r.mesh && r.mesh.length))) : [];
  S.strip = {
    floor: M.cfg.name.toUpperCase(),
    layer: S.layer ? lname(S.layer) : solid.length > 1 ? "ALL LAYERS" : solid.length ? lname(solid[0]) : "FORMWORK",
    callouts: layerRuns.slice().sort((p, q) => (q.kind === "main") - (p.kind === "main")).map(r => r.callout).filter((t, i, a) => a.indexOf(t) === i),
    cover: M.C, laps: +M.cfg.lap, lapText: lapTxt, thickness: M.T, fc: +M.cfg.fc,
    bars: inkBars.length, marks: inkBars.map(x => x.bar.mark).concat(inkSheets.map(pc => pc.mark)).filter((m, i, a) => m && a.indexOf(m) === i).length,
    kg: Math.round(inkBars.reduce((s, x) => s + x.bar.kg, 0) + inkSheets.reduce((s, pc) => s + pc.kg, 0)), sheets: inkSheets.length
  };
  return S;
}

export { buildSheet };
