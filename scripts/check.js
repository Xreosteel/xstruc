#!/usr/bin/env node
// Headless sanity check for the X Struc viewer model.
// Runs the model block of index.html without a browser, builds the default example and a plain slab,
// and asserts the generated bars and schedule are sane. Exit 0 = pass.
"use strict";
const { loadModel } = require("./model-lib");

let lib;
try { lib = loadModel(); } catch (e) { fail(e.message); }
const { buildModel, DEFAULT_CFG, LBY, buildSheet, barAxis, sheetMarksFor, sheetPrintScale, PRINT_SCALES, lapCalc, parseLapTable, lapLookup } = lib;
const fmt = n => Math.round(n).toLocaleString("en-AU");
const FIX = ["BM", "A", "B", "CH", "C", "D", "ST"];   // fixing order, as the viewer steps through it

function checkModel(name, cfg, minBars) {
  let M;
  try { M = buildModel(cfg); } catch (e) { fail(name + ": buildModel threw: " + e.stack); }
  const problems = [];
  if (M.errors.length) problems.push("errors: " + M.errors.join(" | "));
  const { bars, runs, chairs, sched, marks } = M;
  if (bars.length < minBars) problems.push("too few bars: " + bars.length);
  bars.forEach(b => {
    if (!isFinite(b.len) || b.len <= 0) problems.push("bar " + b.id + " has bad length " + b.len);
    if (!isFinite(b.kg) || b.kg <= 0) problems.push("bar " + b.id + " has bad mass " + b.kg);
    if (!b.pts || b.pts.length < 2) problems.push("bar " + b.id + " has <2 points");
    else b.pts.forEach((p, i) => {
      if (p.length !== 3 || p.some(v => !isFinite(v))) problems.push("bar " + b.id + " point " + i + " invalid");
      if (i && p[0] === b.pts[i - 1][0] && p[1] === b.pts[i - 1][1] && p[2] === b.pts[i - 1][2]) problems.push("bar " + b.id + " has a zero-length segment");
    });
    if (!LBY[b.layer]) problems.push("bar " + b.id + " has unknown layer " + b.layer);
    if (!b.existing && !b.mark) problems.push("bar " + b.id + " in this pour has no mark");
    if (!b.existing && !b.chair && (b.pts[0][2] < -1000 || b.pts.some(p => p[2] > M.T + 1200))) problems.push("bar " + b.id + " outside the slab depth range");
    if (!b.existing && b.len > 12000) problems.push("bar " + b.id + " (" + b.run.label + ") cut length " + b.len + " exceeds the 12 m stock bar");
  });
  runs.forEach(r => {
    if (!r.bars.length) problems.push("run " + r.id + " (" + (r.label || r.callout) + ") has no bars");
    if (r.label && !r.dist && !r.tagPos) problems.push("run " + r.id + " (" + r.label + ") has a label but no tag anchor");
  });
  checkGridSetout(M, problems);
  checkSheets(M, problems);
  const qty = marks.reduce((s, m) => s + m.qty, 0);
  if (qty !== sched.length) problems.push("schedule qty " + qty + " != scheduled bars " + sched.length);
  const kgM = marks.reduce((s, m) => s + m.kg, 0);
  if (Math.abs(M.kg - kgM) > 0.5) problems.push("mass mismatch bars " + M.kg.toFixed(1) + " vs marks " + kgM.toFixed(1));
  if (chairs.length < 4) problems.push("too few chairs: " + chairs.length);
  if (problems.length) fail(name + ":\n" + problems.slice(0, 20).join("\n") + (problems.length > 20 ? "\n…and " + (problems.length - 20) + " more" : ""));
  console.log("  " + name + ": bars " + bars.length + " (" + sched.length + " in pour), runs " + runs.length + ", marks " + marks.length + ", chairs " + chairs.length + ", steel " + Math.round(M.kg) + " kg" + (M.warnings.length ? ", warnings " + M.warnings.length : ""));
  return M;
}

// Setout from grids (#20): every bar with a plan axis carries b.grid, every run of parallel lines carries r.grid,
// and the distances are from the NEAREST grid line, consistent with the bar geometry and the lap flags.
function checkGridSetout(M, problems) {
  const { bars, runs, GX, GY } = M;
  const nearest = (G, v) => G.reduce((g, q) => Math.abs(v - q[1]) < Math.abs(v - g[1]) ? q : g, G[0]);
  const okRef = (ref, G, where, v) => {
    const g = G.find(q => q[0] === ref.grid);
    if (!g) { problems.push(where + ": grid " + ref.grid + " is not a grid line"); return; }
    if (ref.at !== g[1] || Math.abs(ref.at + ref.d - ref.v) > 1 || Math.abs(ref.v - v) > 1) problems.push(where + ": ref does not add up " + JSON.stringify(ref));
    if (!/grid [A-Z0-9]+/.test(ref.text) || (Math.abs(ref.d) >= 5 && !/^[\d,]+ [NSEW] of grid/.test(ref.text))) problems.push(where + ": bad wording '" + ref.text + "'");
  };
  const nearestRef = (ref, G, where) => { const n = nearest(G, ref.v); if (n[0] !== ref.grid && Math.abs(ref.v - n[1]) < Math.abs(ref.d) - 1) problems.push(where + ": grid " + ref.grid + " is not the nearest to " + ref.v + " (" + n[0] + " is)"); };
  let withGrid = 0, withLaps = 0;
  bars.forEach(b => {
    if (b.chair) return;
    const xs = b.pts.map(p => p[0]), ys = b.pts.map(p => p[1]);
    const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
    const where = "bar " + b.id + " (" + (b.run.label || b.run.callout) + ")";
    const straightInPlan = !b.col && ((dx >= 300 && dy === 0) || (dy >= 300 && dx === 0));
    if (!b.grid) { if (straightInPlan) problems.push(where + " runs " + (dx ? "E–W" : "N–S") + " in plan but has no grid setout"); return; }
    const g = b.grid; withGrid++;
    const X = g.dir === "X", cross = X ? GY : GX, along = X ? GX : GY;
    if (g.dir !== (dx >= dy ? "X" : "Y")) problems.push(where + ": grid.dir " + g.dir + " disagrees with the geometry");
    okRef(g.line, cross, where + " line", X ? g.line.v : g.line.v); nearestRef(g.line, cross, where + " line");
    okRef(g.from, along, where + " from", X ? Math.min(...xs) : Math.min(...ys)); nearestRef(g.from, along, where + " from");
    okRef(g.to, along, where + " to", X ? Math.max(...xs) : Math.max(...ys)); nearestRef(g.to, along, where + " to");
    if (g.to.v - g.from.v !== Math.round(X ? dx : dy)) problems.push(where + ": from/to span " + (g.to.v - g.from.v) + " != plan length " + Math.round(X ? dx : dy));
    const expLaps = (b.lig || b.tie || b.col) ? 0 : (b.lapPrev ? 1 : 0) + (b.lapNext ? 1 : 0);
    if (g.laps.length !== expLaps) problems.push(where + ": " + g.laps.length + " lap zones for lapPrev/lapNext " + !!b.lapPrev + "/" + !!b.lapNext);
    const lap = b.run.lap ? b.run.lap.len : 0;   // #5: the lap is the run's (per size and case), not one project number
    if (expLaps && !lap) problems.push(where + ": lapped bar in a run with no lap");
    g.laps.forEach(z => {
      withLaps++;
      if (z.len !== lap || Math.abs(z.b.v - z.a.v) !== lap) problems.push(where + ": lap zone " + z.a.v + "–" + z.b.v + " is not the " + lap + " lap");
      if (z.a.grid !== z.b.grid) problems.push(where + ": lap zone ends measured from different grids (" + z.a.grid + "/" + z.b.grid + ")");
      if ((z.end === g.ends[0] && z.a.v !== g.from.v) || (z.end === g.ends[1] && z.b.v !== g.to.v)) problems.push(where + ": lap zone is not at the bar end");
      if (!/lap at the [NSEW] end, lap zone .* to .*grid/.test(z.text)) problems.push(where + ": lap wording '" + z.text + "'");
    });
    if (b.run.grid) {
      if (!(g.lineIndex >= 1 && g.lineIndex <= g.n) || g.n !== b.run.n) problems.push(where + ": bar line " + g.lineIndex + " of " + g.n + " (run has " + b.run.n + ")");
      const expected = b.run.grid.first.v + (g.lineIndex - 1) * b.run.sp;
      if (Math.abs(g.line.v - expected) > 1) problems.push(where + ": bar line " + g.lineIndex + " at " + g.line.v + ", expected " + expected);
    }
  });
  runs.forEach(r => {
    const where = "run " + r.id + " (" + (r.label || r.callout) + ")";
    if (r.kind === "main" || r.kind === "balc") {
      if (!r.grid) { problems.push(where + " has parallel bar lines but no grid setout"); return; }
      const cross = r.dir === "X" ? GY : GX;
      okRef(r.grid.first, cross, where + " first", r.grid.first.v); okRef(r.grid.last, cross, where + " last", r.grid.last.v);
      nearestRef(r.grid.first, cross, where + " first"); nearestRef(r.grid.last, cross, where + " last");
      if (r.grid.last.v - r.grid.first.v !== (r.n - 1) * r.sp) problems.push(where + ": first/last lines " + r.grid.first.v + "–" + r.grid.last.v + " do not match " + r.n + " @ " + r.sp);
      if (r.setout && Math.abs((r.grid.first.v - r.setout.first) - (r.dir === "X" ? M.SL.y0 : M.SL.x0)) > 1) problems.push(where + ": first line from the grid and from the slab edge disagree");
      const lines = new Set(r.bars.map(b => b.grid && b.grid.lineIndex)); if (lines.size !== r.n || lines.has(undefined)) problems.push(where + ": bars cover " + lines.size + " of " + r.n + " bar lines");
    }
  });
  if (withGrid < bars.length * 0.5) problems.push("only " + withGrid + " of " + bars.length + " bars have a grid setout");
  if (M.cfg === DEFAULT_CFG && withLaps < 50) problems.push("only " + withLaps + " lap zones on the example; expected the long E–W bars to lap");
}

// 2D placing sheet (#9a): one sheet per fixing step (that layer in ink, the layers below ghosted) plus the finished floor.
// Every bar of the layer is on the sheet as its plan polyline, every short turned-down end leg is a cog tick, grids and
// their dimension strings match the model, and every run's first and last bar line is dimensioned from its nearest grid.
function checkSheets(M, problems) {
  const inSheet = b => !b.existing;
  const planPts = b => { const out = []; b.pts.forEach(p => { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1) out.push([p[0], p[1]]); }); return out; };
  const endLegs = b => { const n = b.pts.length; if (n < 3) return 0; let k = 0; const pl = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]); if (pl(b.pts[0], b.pts[1]) < 1 && Math.abs(b.pts[1][2] - b.pts[0][2]) >= 20 && pl(b.pts[1], b.pts[2]) >= 1) k++; if (pl(b.pts[n - 2], b.pts[n - 1]) < 1 && Math.abs(b.pts[n - 1][2] - b.pts[n - 2][2]) >= 20 && pl(b.pts[n - 3], b.pts[n - 2]) >= 1) k++; return k; };
  const sheets = FIX.map((lid, i) => ({ lid: lid, S: buildSheet(M, [lid], FIX.slice(0, i)) }));
  sheets.push({ lid: null, S: buildSheet(M, FIX, []) });
  sheets.forEach(({ lid, S }) => {
    const where = "sheet " + (lid || "all");
    const p = m => problems.push(where + ": " + m);
    const solidBars = M.bars.filter(b => inSheet(b) && (lid ? b.layer === lid : true));
    const ghostBars = lid ? M.bars.filter(b => inSheet(b) && FIX.indexOf(b.layer) >= 0 && FIX.indexOf(b.layer) < FIX.indexOf(lid)) : [];
    const sol = S.bars.filter(it => !it.ghost), gho = S.bars.filter(it => it.ghost);
    if (sol.length !== solidBars.length) p(sol.length + " bars in ink, layer has " + solidBars.length);
    if (gho.length !== ghostBars.length) p(gho.length + " ghost bars, layers below have " + ghostBars.length);
    if (S.layer !== lid) p("layer " + S.layer + " != " + lid);
    if (S.bars.some(it => it.bar.existing || it.layer === "CL")) p("existing / column-below bars are drawn");
    const b = S.bounds; if (!(b.x1 > b.x0 && b.y1 > b.y0)) p("bad bounds");
    let cogs = 0, expCogs = 0;
    S.bars.forEach(it => {
      const bb = it.bar, w = "bar " + bb.id + " (" + (bb.run.label || bb.run.callout) + ")";
      const exp = planPts(bb);
      if (it.pts.length !== exp.length || it.pts.some((q, i) => Math.abs(q[0] - exp[i][0]) > 0.01 || Math.abs(q[1] - exp[i][1]) > 0.01)) p(w + ": plan polyline differs from the bar's projected points");
      if (it.pts.some(q => !isFinite(q[0]) || !isFinite(q[1]) || q[0] < b.x0 - 1 || q[0] > b.x1 + 1 || q[1] < b.y0 - 1 || q[1] > b.y1 + 1)) p(w + ": point outside the sheet bounds");
      if (it.point !== (it.pts.length === 1)) p(w + ": point flag wrong");
      if (it.w !== bb.size || it.layer !== bb.layer) p(w + ": size / layer not carried");
      cogs += it.cogs.length; expCogs += endLegs(bb);
      it.cogs.forEach(k => {
        if (Math.abs(Math.hypot(k.nx, k.ny) - 1) > 1e-6) p(w + ": cog tick normal is not a unit vector");
        if (!(k.len >= 20) || !["cog", "vertical"].includes(k.kind) || !["start", "end"].includes(k.end)) p(w + ": bad cog tick " + JSON.stringify(k));
        const e = k.end === "start" ? bb.pts[0] : bb.pts[bb.pts.length - 1];
        if (Math.abs(k.x - e[0]) > 0.01 || Math.abs(k.y - e[1]) > 0.01) p(w + ": cog tick is not at the bar end");
        // the tick is perpendicular to the adjoining plan leg
        const leg = k.end === "start" ? [bb.pts[1], bb.pts[2]] : [bb.pts[bb.pts.length - 3], bb.pts[bb.pts.length - 2]];
        const dx = leg[1][0] - leg[0][0], dy = leg[1][1] - leg[0][1];
        if (Math.abs(dx * k.nx + dy * k.ny) > 1e-6 * Math.hypot(dx, dy)) p(w + ": cog tick is not perpendicular to the bar");
      });
    });
    if (cogs !== expCogs) p(cogs + " cog ticks, expected " + expCogs + " turned-down end legs");
    if (lid === "ST" && !sol.every(it => it.cogs.length === 1 && it.cogs[0].kind === "vertical")) p("every starter should show one vertical leg end-on");
    if (lid === "D" && M.cfg.features.edges && cogs < 10) p("layer D should be cogged at the free edges, only " + cogs + " ticks");
    // grids and their dimension strings
    if (S.grids.x.length !== M.GX.length || S.grids.x.some((g, i) => g.name !== M.GX[i][0] || g.v !== M.GX[i][1] || g.bub.length !== 2 || !(g.a < g.b))) p("x grids differ from the model");
    if (S.grids.y.length !== M.GY.length || S.grids.y.some((g, i) => g.name !== M.GY[i][0] || g.v !== M.GY[i][1] || g.bub.length !== 2 || !(g.a < g.b))) p("y grids differ from the model");
    if (S.gridDims.length !== M.gx.length - 1 + M.gy.length - 1) p("grid dimension count " + S.gridDims.length);
    S.gridDims.forEach(d => { if (d.text !== fmt(Math.abs(d.b - d.a)) || !["x", "y"].includes(d.measure) || !isFinite(d.at)) p("bad grid dim " + JSON.stringify(d)); });
    // chairs only on their own step (and ghosted after it)
    const chairsExp = lid === null ? M.chairs.length : (FIX.indexOf("CH") <= FIX.indexOf(lid) ? M.chairs.length : 0);
    if (S.chairs.length !== chairsExp) p(S.chairs.length + " chairs, expected " + chairsExp);
    if (lid === "CH" && S.chairs.some(ch => ch.ghost)) p("chairs ghosted on their own step");
    // setout dims: one per run end that is off a grid line, from the nearest grid, on the run's distribution line
    if (lid) {
      M.runs.filter(r => r.layer === lid && r.grid && r.dist).forEach(r => {
        [["first", r.grid.first], ["last", r.grid.last]].forEach(([which, g]) => {
          const d = S.dims.find(x => x.run === r.id && x.which === which);
          if (Math.abs(g.d) < 5) { if (d) p("run " + r.id + " " + which + " line is on grid " + g.grid + " but has a dim"); return; }
          if (!d) { p("run " + r.id + " (" + r.label + ") has no " + which + "-line setout dim"); return; }
          if (d.measure !== (r.dir === "X" ? "y" : "x") || d.a !== g.at || d.b !== g.v || d.grid !== g.grid || d.text !== fmt(Math.abs(g.d)) || d.at !== r.dist.at) p("run " + r.id + " " + which + " dim " + JSON.stringify(d) + " does not match r.grid " + JSON.stringify(g));
        });
      });
      if (S.dims.some(d => !M.runs.find(r => r.id === d.run && r.layer === lid))) p("a setout dim belongs to another layer's run");
    } else if (S.dims.length) p("the finished-floor sheet should carry no per-run setout dims");
    if (!S.title[0].includes(lid ? LBY[lid].name.toUpperCase() : "ALL LAYERS") || !/THK · COVER \d+ · LAPS? (\d+( \(TABLE\))?|PER TABLE)/.test(S.title[1])) p("title " + JSON.stringify(S.title));
    checkSheetNotes(M, S, lid, sol, p);
  });
}

// #9b: run tags, distribution lines, lap zones, bar marks and the title strip on a sheet
function checkSheetNotes(M, S, lid, sol, p) {
  const B = S.bounds, overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inside = r => r.x0 >= B.x0 - 1 && r.x1 <= B.x1 + 1 && r.y0 >= B.y0 - 1 && r.y1 <= B.y1 + 1;
  const segD = (pts, x, y) => { let bd = Infinity; for (let i = 0; i < Math.max(1, pts.length - 1); i++) { const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0; bd = Math.min(bd, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)); } return bd; };
  const outBy = (r, q) => Math.hypot(Math.max(r.x0 - q[0], 0, q[0] - r.x1), Math.max(r.y0 - q[1], 0, q[1] - r.y1));
  // tags: every labelled run of the active layer with bars on the sheet has exactly one; none on the finished floor
  const tagged = lid ? M.runs.filter(r => r.layer === lid && r.label && sol.some(it => it.bar.run === r)) : [];
  if (S.notes.some(n => !n.box || !(n.h > 0) || n.box.x1 - n.box.x0 < n.text.length * 0.6 * n.h)) p("feature notes need a paper-text box");
  if (!lid && (S.tags.length || S.distLines.length || Object.keys(S.runMarks).length)) p("the finished-floor sheet should carry no run tags or marks");
  if (S.tags.length !== tagged.length) p(S.tags.length + " tags, " + tagged.length + " labelled runs on this layer");
  tagged.forEach(r => { if (S.tags.filter(t => t.run === r.id).length !== 1) p("run " + r.id + " (" + r.label + ") should have one tag"); });
  S.tags.forEach((t, i) => {
    const r = M.runs.find(q => q.id === t.run), w = "tag " + t.run + " (" + t.text + ")";
    if (!r || t.text !== r.label) { p(w + ": text is not the run label"); return; }
    if (t.overlap) p(w + ": no free place found (overlaps another tag)");
    if (!inside(t.box)) p(w + ": box outside the sheet bounds");
    S.tags.slice(i + 1).forEach(u => { if (overlap(t.box, u.box)) p(w + " overlaps tag " + u.run); });
    S.notes.forEach(n => { if (overlap(t.box, n.box)) p(w + " overlaps the note " + n.text); });
    if (!(t.box.x1 - t.box.x0 >= t.text.length * 0.6 * t.h) || !(t.box.y1 - t.box.y0 >= t.h)) p(w + ": box too small for its text");
    if (r.dist) {
      const d = S.distLines.find(x => x.run === r.id), vert = r.dist.dir === "X";
      if (!d) { p(w + ": no distribution line"); return; }
      const lo = Math.min(r.dist.p0, r.dist.p1), hi = Math.max(r.dist.p0, r.dist.p1);
      if (vert ? (d.x0 !== r.dist.at || d.x1 !== r.dist.at || d.y0 !== lo || d.y1 !== hi) : (d.y0 !== r.dist.at || d.y1 !== r.dist.at || d.x0 !== lo || d.x1 !== hi)) p(w + ": distribution line " + JSON.stringify(d) + " differs from r.dist");
      if (r.grid && d.n !== r.grid.n) p(w + ": distribution line bar count " + d.n + " != " + r.grid.n);
      const a = t.anchor, onLine = vert ? Math.abs(a[0] - r.dist.at) < 0.01 && a[1] >= lo - 0.01 && a[1] <= hi + 0.01 : Math.abs(a[1] - r.dist.at) < 0.01 && a[0] >= lo - 0.01 && a[0] <= hi + 0.01;
      if (!onLine) p(w + ": anchor " + JSON.stringify(a) + " is not on its distribution line");
      const gap = vert ? Math.min(Math.abs(t.box.x0 - r.dist.at), Math.abs(t.box.x1 - r.dist.at)) : Math.min(Math.abs(t.box.y0 - r.dist.at), Math.abs(t.box.y1 - r.dist.at));
      const crosses = vert ? t.box.x0 < r.dist.at && t.box.x1 > r.dist.at : t.box.y0 < r.dist.at && t.box.y1 > r.dist.at;
      if (crosses) p(w + ": box sits over its distribution line");
      if (!t.pushed && (Math.abs(gap - 90) > 1 || t.leader)) p(w + ": an unpushed tag should sit 90 beside its line with no leader (gap " + gap + ")");
      if (t.pushed && (!t.leader || segD([t.leader[1]], a[0], a[1]) > 0.01 || outBy(t.box, t.leader[0]) > 0.01)) p(w + ": a pushed tag needs a leader from its box to its line");
    } else {
      const polys = sol.filter(it => it.bar.run === r).map(it => it.pts);
      if (Math.min(...polys.map(q => segD(q, t.anchor[0], t.anchor[1]))) > 0.5) p(w + ": anchor is not on one of its bars");
      const far = outBy(t.box, t.anchor) > 20;
      if (far !== !!t.leader) p(w + ": leader " + (t.leader ? "drawn" : "missing") + " with the anchor " + Math.round(outBy(t.box, t.anchor)) + " from the box");
      if (t.leader && (outBy(t.box, t.leader[0]) > 0.01 || t.leader[1] !== t.anchor)) p(w + ": leader does not run from the box to the bars");
    }
  });
  if (S.distLines.length !== S.tags.filter(t => t.dist).length) p("distribution lines " + S.distLines.length + " != dist tags");
  // lap zones: every lapped ink bar's zones from b.grid.laps, one zone per pair of bars, the lap long, on the bar line
  let want = 0;
  sol.forEach(it => {
    const b = it.bar; if (!b.grid || !b.grid.laps.length) return;
    const ax = barAxis(b);
    b.grid.laps.forEach(z => {
      want++;
      const a = Math.min(z.a.v, z.b.v), c = Math.max(z.a.v, z.b.v);
      const hit = S.laps.find(q => q.bars.indexOf(b.id) >= 0 && (ax.X ? q.x0 === a && q.x1 === c && Math.abs(q.y0 - ax.p) < 1 : q.y0 === a && q.y1 === c && Math.abs(q.x0 - ax.p) < 1));
      if (!hit) p("bar " + b.id + ": lap zone " + z.text + " not on the sheet");
    });
  });
  if (S.laps.reduce((s, z) => s + z.bars.length, 0) !== want) p("lap zones list " + S.laps.reduce((s, z) => s + z.bars.length, 0) + " bar ends, bars have " + want);
  S.laps.forEach(z => {
    if (Math.abs(Math.hypot(z.x1 - z.x0, z.y1 - z.y0) - z.len) > 1 || z.text !== fmt(z.len) + " LAP") p("lap zone " + JSON.stringify(z) + " is not its lap long");
    if (S.solid.indexOf(z.layer) < 0) p("lap zone on a layer not drawn in ink");
  });
  if (lid && M.cfg.features.edges && lid === "D" && M.L > 12000 && !S.laps.length) p("layer D should show lap zones on a slab longer than a stock bar");
  // bar marks: every distinct mark of a run is labelled, labels name their own bar, unflagged labels do not collide
  Object.keys(S.runMarks).forEach(rid => {
    const ls = S.runMarks[rid], items = sol.filter(it => it.bar.run.id === rid && !it.point);
    const marks = [...new Set(items.map(it => it.bar.mark))];
    marks.forEach(m => { if (!ls.some(l => l.mark === m && l.first)) p("run " + rid + ": mark " + m + " has no label"); });
    ls.forEach((l, i) => {
      const b = M.bars[l.bar];
      if (!b || b.run.id !== rid || b.mark !== l.mark) p("run " + rid + ": label " + l.mark + " names the wrong bar");
      if (!l.overlap) ls.slice(i + 1).forEach(o => { if (!o.overlap && overlap(l.box, o.box)) p("run " + rid + ": mark labels " + l.mark + " and " + o.mark + " collide"); });
    });
  });
  if (lid) M.runs.filter(r => r.layer === lid && sol.some(it => it.bar.run === r && !it.point)).forEach(r => { if (!S.runMarks[r.id]) p("run " + r.id + " has no mark labels"); });
  // #9c: the schedule-mark highlight draws sheetMarksFor(S, mark): every mark of the layer has at least one label, every
  // label names a bar of that mark on this sheet, and the finished floor (no run tags) has none
  if (lid) {
    [...new Set(sol.filter(it => !it.point && it.bar.mark).map(it => it.bar.mark))].forEach(mk => {
      const ls = sheetMarksFor(S, mk);
      if (!ls.length) p("mark " + mk + " has no label for the schedule highlight");
      if (ls.some(l => l.mark !== mk || !sol.some(it => it.bar.id === l.bar && it.bar.mark === mk))) p("mark " + mk + ": a highlight label names a bar of another mark or layer");
    });
    if (sheetMarksFor(S, "no-such-mark").length) p("labels returned for a mark that is not on the sheet");
  } else if (sheetMarksFor(S, sol[0] && sol[0].bar.mark).length) p("the finished-floor sheet should carry no mark labels");
  // #9c: print scale — a standard denominator at which the bounds fit the drawable area of A3 and A4 landscape with
  // 10 mm margins, a 13 mm title band and a 24 mm title strip; the next larger scale must not fit (largest that fits)
  [["A3", 400 - 10, 277 - 13 - 24 - 10], ["A4", 277 - 10, 190 - 13 - 24 - 10]].forEach(([paper, dw, dh]) => {
    const ps = sheetPrintScale(B, dw, dh), bw = (B.x1 - B.x0) / ps.den, bh = (B.y1 - B.y0) / ps.den, i = PRINT_SCALES.indexOf(ps.den);
    if (i < 0) p(paper + ": print scale 1:" + ps.den + " is not a standard scale");
    if (ps.fits && (bw > dw + 1e-9 || bh > dh + 1e-9)) p(paper + ": 1:" + ps.den + " does not fit " + dw + " × " + dh + " mm (" + bw.toFixed(1) + " × " + bh.toFixed(1) + ")");
    if (ps.fits && i > 0 && (B.x1 - B.x0) / PRINT_SCALES[i - 1] <= dw && (B.y1 - B.y0) / PRINT_SCALES[i - 1] <= dh) p(paper + ": 1:" + PRINT_SCALES[i - 1] + " would also fit; the scale should be the largest that fits");
    if (!ps.fits && paper === "A3") p("A3: the sheet does not fit even at 1:" + ps.den);
  });
  // title strip
  const st = S.strip;
  if (!st || st.bars !== sol.length || st.kg !== Math.round(sol.reduce((s, it) => s + it.bar.kg, 0)) || st.cover !== M.C || st.laps !== +M.cfg.lap || st.floor !== M.cfg.name.toUpperCase()) p("title strip " + JSON.stringify(st));
  else if (lid) {
    const main = M.runs.find(r => r.layer === lid && r.kind === "main" && r.bars.length);
    if (main && st.callouts[0] !== main.callout) p("title strip should list the main mat callout first: " + st.callouts[0]);
    if (st.layer !== LBY[lid].name.toUpperCase()) p("title strip layer " + st.layer);
    if (st.marks !== new Set(sol.map(it => it.bar.mark)).size) p("title strip mark count " + st.marks);
  }
}

const M = checkModel("default example", DEFAULT_CFG, 800);
checkModel("plain 6 × 4.5 slab", { gridX: [0, 6000], gridY: [0, 4500], callouts: "N12-200 A E-W\nN12-200 B N-S\nN12-200 C N-S\nN12-200 D E-W", features: { beams: false, columns: false, drop: false, step: false, balcony: false, openings: false, extras: false, edges: true } }, 60);
checkModel("no features at all", { gridX: "0, 8000", gridY: "0, 7000", features: { beams: false, columns: false, drop: false, step: false, balcony: false, openings: false, extras: false, edges: false } }, 60);
checkModel("two mats only", { callouts: "N16-200 A E-W\nN12-150 D E-W" }, 300);
checkModel("big grid", { gridX: [0, 6000, 12000, 18000, 24000], gridY: [0, 6000, 12000, 18000] }, 1500);

// crowded sheet (#9b): every layer-D tag anchored at one point and a tight D mat with staggered laps; the declutter
// must push tags out with leaders and keep every tag and every distinct mark, with nothing overprinted
{
  const MC = buildModel({ gridX: [0, 7000, 14000, 21000], callouts: "N16-200 A E-W\nN12-200 B N-S\nN12-150 C N-S\nN12-60 D E-W" });
  MC.runs.filter(r => r.layer === "D" && !r.dist).forEach(r => { r.tagPos = [7000, 4500, 0]; });
  const SC = buildSheet(MC, ["D"], []), problems = [];
  checkSheetNotes(MC, SC, "D", SC.bars.filter(it => !it.ghost), m => problems.push("crowded sheet D: " + m));
  if (SC.tags.filter(t => t.pushed && t.leader).length < 5) problems.push("crowded sheet D: expected at least 5 pushed tags with leaders, got " + SC.tags.filter(t => t.pushed).length);
  if (problems.length) fail(problems.slice(0, 20).join("\n"));
}

// geometry inputs (#7a): openings and the balcony from cfg, the example's rows reproduce the example, bad rows are
// reported by row number and left out while the rest builds
{
  const { exampleGeometry, parseGrids } = lib, problems = [], p = m => problems.push("geometry inputs: " + m);
  const EX = exampleGeometry(DEFAULT_CFG);
  if (EX.openings.length !== 2 || EX.openings[0].name !== "STAIR VOID" || EX.balconies.length !== 1 || EX.balconies[0].edge !== "N" || EX.balconies[0].proj !== 1800 || EX.balconies[0].thk !== 180 || EX.balconies[0].down !== 50) p("example rows " + JSON.stringify(EX));
  if (parseGrids(DEFAULT_CFG).SL.x1 !== 14250 || parseGrids({ gridX: "0, 6000", gridY: [0, 4500] }).SL.y1 !== 4750) p("parseGrids slab outline");
  // the panel's pre-filled rows, fed back in explicitly, build the very same floor
  const ME = buildModel(Object.assign({}, DEFAULT_CFG, EX));
  if (ME.errors.length || ME.bars.length !== M.bars.length || ME.marks.length !== M.marks.length || Math.round(ME.kg) !== Math.round(M.kg) || ME.HOLES.length !== 2 || ME.BALCS.length !== 1) p("explicit example rows differ from the example: " + ME.bars.length + " bars, " + ME.marks.length + " marks, " + Math.round(ME.kg) + " kg, errors " + ME.errors.join(" | "));
  ME.bars.forEach((b, i) => { const a = M.bars[i]; if (!a || a.len !== b.len || a.mark !== b.mark || JSON.stringify(a.pts) !== JSON.stringify(b.pts)) p("bar " + i + " differs between the example and its explicit rows"); });
  // a job: three openings, one big (N16 trimmers extended 600) and two small (N12 extended 500), mats cut at each
  const job = { gridX: [0, 6000, 12000], gridY: [0, 5000, 10000], features: Object.assign({}, DEFAULT_CFG.features, { drop: false, step: false }),
    openings: [{ name: "lift", x0: 7000, y0: 1500, x1: 9000, y1: 4000 }, { name: "Duct", x0: 2000, y0: 7000, x1: 2600, y1: 7600 }, { x0: 9600, y0: 7400, x1: 9000, y1: 6800 }],
    balcony: { x0: 1000, x1: 5000, proj: 2400, thk: 200, down: 0 } };
  const MJ = buildModel(job);
  if (MJ.errors.length) p("job has errors: " + MJ.errors.join(" | "));
  if (MJ.HOLES.length !== 3 || MJ.HOLES.map(h => h.id).join(",") !== "LIFT,DUCT,OPENING 3") p("job openings " + JSON.stringify(MJ.HOLES.map(h => h.id)));
  const h3 = MJ.HOLES[2]; if (!(h3.x0 === 9000 && h3.x1 === 9600 && h3.y0 === 6800 && h3.y1 === 7400)) p("reversed corners were not normalised: " + JSON.stringify(h3));
  MJ.HOLES.forEach(h => {
    const trims = MJ.runs.filter(r => r.kind === "trim" && r.callout.indexOf("OF " + h.id + " ") >= 0), big = Math.max(h.x1 - h.x0, h.y1 - h.y0) >= 1500;
    if (trims.length !== 4) p(h.id + ": expected trimmers in 4 layers, got " + trims.length);
    trims.forEach(r => { if (r.size !== (big ? 16 : 12) && (r.layer === "A" || r.layer === "B")) p(h.id + ": bottom trimmer N" + r.size + " for a " + (big ? "big" : "small") + " opening"); if (r.bars.length !== 4) p(h.id + ": " + r.bars.length + " trimmer bars in layer " + r.layer); });
    const ext = big ? 600 : 500, tA = trims.find(r => r.layer === "A");
    if (tA && Math.abs(Math.min(...tA.bars.map(b => Math.min(b.pts[0][0], b.pts[b.pts.length - 1][0]))) - (h.x0 - ext)) > 1) p(h.id + ": layer A trimmers do not extend " + ext + " past the opening");
    // no main bar runs through the opening (mats are cut with the cover clear of the hole)
    MJ.bars.filter(b => b.run.kind === "main").forEach(b => {
      const xs = b.pts.map(q => q[0]), ys = b.pts.map(q => q[1]);
      if (Math.min(...xs) < h.x1 - 1 && Math.max(...xs) > h.x0 + 1 && Math.min(...ys) < h.y1 - 1 && Math.max(...ys) > h.y0 + 1) p(h.id + ": main bar " + b.id + " (" + b.run.label + ") crosses the opening");
    });
    if (!h.label || (h.y1 - h.y0 < 1000) !== !!h.small) p(h.id + ": label / small flag " + JSON.stringify([h.label, h.small]));
  });
  const SJ = buildSheet(MJ, ["A", "B", "C", "D", "BM", "CH", "ST"], []);
  MJ.HOLES.forEach(h => { if (!SJ.notes.some(n => n.text === h.label)) p("no sheet note for " + h.label); if (!SJ.concrete.holes.some(r => r.x0 === h.x0 && r.y1 === h.y1)) p("no sheet outline for " + h.id); });
  if (!MJ.HOLES[1].small || MJ.HOLES[1].label !== "DUCT 600 × 600" || MJ.HOLES[0].small) p("small-opening labels: " + MJ.HOLES.map(h => h.label).join(" / "));
  // the balcony as entered (the #7a single-object shape, still read as a one-item list on the north edge): 4,000 along the
  // north edge, 2,400 out, 200 thick, no set-down, so the top bar runs straight into the slab
  const B = MJ.BALCS[0];
  if (MJ.BALCS.length !== 1 || !B || B.edge !== "N" || B.x0 !== 1000 || B.x1 !== 5000 || B.y0 !== 10250 || B.y1 !== 12650 || B.top !== 200 || B.bot !== 0) p("balcony geometry " + JSON.stringify(B));
  const cant = MJ.runs.find(r => r.label.indexOf("CANTILEVER") >= 0);
  if (!cant || cant.bars.some(b => b.shape !== "cog" || b.pts.length !== 3) || /Z AT/.test(cant.callout)) p("cantilever bars with no set-down should be cogged and straight: " + (cant && cant.bars[0].shape + " " + cant.callout));
  if (!MJ.bars.filter(b => b.run.kind === "balc").every(b => b.pts.every(q => q[2] >= B.bot && q[2] <= B.top))) p("balcony bars outside the balcony depth");
  const ME50 = buildModel(Object.assign({}, job, { balcony: { x0: 1000, x1: 5000, proj: 2400, thk: 200, down: 60 } })), cant50 = ME50.runs.find(r => r.label.indexOf("CANTILEVER") >= 0);
  if (!cant50 || cant50.bars.some(b => b.shape !== "cog + Z" || b.pts.length !== 5) || !/Z AT 60 STEP/.test(cant50.callout)) p("cantilever bars with a 60 set-down should crank: " + (cant50 && cant50.bars[0].shape + " " + cant50.callout));
  // bad rows: reported by row number, left out, the good row and the rest of the floor still build; the example's
  // derived openings only warn when they do not fit
  const bad = buildModel(Object.assign({}, job, { openings: [
    { name: "edge", x0: -200, y0: 1000, x1: 800, y1: 2000 },          // 1 outside / within 300 of the slab edge
    { name: "lift", x0: 7000, y0: 1500, x1: 9000, y1: 4000 },         // 2 fine
    { name: "beam", x0: 5700, y0: 7000, x1: 6300, y1: 7600 },         // 3 on IB1 (grid 2)
    { name: "near", x0: 9200, y0: 2000, x1: 9800, y1: 2600 },         // 4 200 from the lift
    { name: "slot", x0: 2000, y0: 2000, x1: 2200, y1: 4000 },         // 5 too narrow
    { name: "blank", x0: 2000, y0: "", x1: 2600, y1: 2600 },          // 6 a blank field
    { name: "fine2", x0: 1500, y0: 7000, x1: 2500, y1: 8500 }],       // 7 fine
    balcony: { x0: 1000, x1: 2000, proj: 2400, thk: 200, down: 0 } }));   // too narrow
  const want = [[1, /inside the slab edges/], [3, /sits on beam IB1/], [4, /too close to LIFT/], [5, /too small/], [6, /must all be numbers/]];
  want.forEach(w => { if (!bad.errors.some(e => e.indexOf("Opening " + w[0] + " ") === 0 && w[1].test(e))) p("missing error for opening " + w[0] + " " + w[1] + "; got " + bad.errors.join(" | ")); });
  if (!bad.errors.some(e => /^Balcony 1 \(BALCONY\): too narrow/.test(e)) || bad.BALCS.length) p("a 1,000 balcony should be an error and left out: " + bad.errors.join(" | "));
  if (bad.errors.length !== want.length + 1) p("expected exactly " + (want.length + 1) + " errors, got " + bad.errors.length + ": " + bad.errors.join(" | "));
  if (bad.HOLES.map(h => h.id).join(",") !== "LIFT,FINE2" || bad.HOLES[1].row !== 6) p("the good rows should still build: " + bad.HOLES.map(h => h.id + "@" + h.row).join(","));
  if (bad.bars.filter(b => b.run.kind === "main").length < 100 || !bad.runs.some(r => r.kind === "trim" && r.callout.indexOf("OF FINE2 ") >= 0)) p("the floor was not built around the bad rows");
  const small = buildModel({ gridX: [0, 4000], gridY: [0, 3000] });
  if (small.errors.length || !small.warnings.some(w => /^Example opening stair void left out/.test(w)) || !small.warnings.some(w => /^Example balcony left out/.test(w)) || small.HOLES.length !== 1) p("example rows that do not fit a small grid should warn, not error: " + small.errors.concat(small.warnings).join(" | "));
  const off = buildModel(Object.assign({}, job, { features: Object.assign({}, job.features, { openings: false, balcony: false }) }));
  if (off.HOLES.length || off.BALCS.length || off.errors.length) p("feature toggles off should ignore the rows");
  if (problems.length) fail(problems.slice(0, 20).join("\n"));
  console.log("  geometry inputs: example rows reproduce the example; job with 3 openings + balcony: bars " + MJ.bars.length + ", marks " + MJ.marks.length + "; 5 bad rows + bad balcony reported, 2 good rows built");
}

// levels (#7b): set-downs (a list) and the step from cfg; Z-bars follow each set-down, L-bars the step, mats sit at
// each level; bad rows are reported by row and left out; the example's rows are the example
{
  const { exampleGeometry } = lib, problems = [], p = m => problems.push("level inputs: " + m);
  const EX = exampleGeometry(DEFAULT_CFG);
  if (EX.setdowns.length !== 1 || EX.setdowns[0].name !== "WET AREA" || EX.setdowns[0].depth !== 70 || EX.setdowns[0].x0 !== 600 || EX.setdowns[0].y1 !== 8200) p("example set-down row " + JSON.stringify(EX.setdowns));
  if (!EX.step || EX.step.x0 !== 9500 || EX.step.y0 !== 4500 || EX.step.rise !== 200 || EX.step.nib !== 300) p("example step row " + JSON.stringify(EX.step));
  if (M.DROPS.length !== 1 || M.DROPS[0].id !== "WET AREA" || M.DROPS[0].d !== 70 || !M.STEP || M.STEP.rise !== 200 || M.STEP.x1 !== M.SL.x1) p("example model levels " + JSON.stringify([M.DROPS, M.STEP]));
  const zEx = M.runs.filter(r => r.kind === "z");
  if (zEx.length !== 4 || zEx.some(r => r.drop !== M.DROPS[0] || !/AT 70 SET-DOWN \(WET AREA\), LAP 600/.test(r.callout))) p("example Z-bar runs: " + zEx.map(r => r.callout).join(" | "));
  // a job: two set-downs of different depths and a step off the grid lines
  const grid = { gridX: [0, 6000, 12000], gridY: [0, 5000, 10000], features: Object.assign({}, DEFAULT_CFG.features, { openings: false, balcony: false, extras: false }) };
  const job = Object.assign({}, grid, { setdowns: [{ name: "ens", x0: 1000, y0: 6500, x1: 3500, y1: 9000, depth: 50 }, { x0: 10000, y0: 3000, x1: 7500, y1: 1000, depth: 100 }], step: { x0: 8000, y0: 6000, rise: 250, nib: 300 } });
  const MJ = buildModel(job), SJ = buildSheet(MJ, ["A", "B", "C", "D", "BM", "CH", "ST"], []), lap = +MJ.cfg.lap;
  if (MJ.errors.length) p("job has errors: " + MJ.errors.join(" | "));
  if (MJ.DROPS.length !== 2 || MJ.DROPS.map(d => d.id).join(",") !== "ENS,SET-DOWN 2" || MJ.DROPS[1].x0 !== 7500 || MJ.DROPS[1].y1 !== 3000 || MJ.DROPS[1].d !== 100) p("job set-downs " + JSON.stringify(MJ.DROPS));
  if (!MJ.STEP || MJ.STEP.x0 !== 8000 || MJ.STEP.y0 !== 6000 || MJ.STEP.rise !== 250 || MJ.STEP.nib !== 300 || MJ.STEP.x1 !== MJ.SL.x1 || MJ.STEP.y1 !== MJ.SL.y1) p("job step " + JSON.stringify(MJ.STEP));
  if (MJ.lvl(2000, 7000) !== -50 || MJ.lvl(8000, 2000) !== -100 || MJ.lvl(9000, 8000) !== 250 || MJ.lvl(5000, 5000) !== 0 || MJ.lvl(11000, 2000) !== 0) p("lvl() does not follow the set-downs and the step");
  const inR = (r, x, y) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1;
  MJ.DROPS.forEach(dd => {
    const zr = MJ.runs.filter(r => r.kind === "z" && r.drop === dd);
    if (zr.length !== 4 || zr.some(r => !r.bars.length || r.callout.indexOf("AT " + dd.d + " SET-DOWN (" + dd.id + ")") < 0)) p(dd.id + ": expected a Z-bar run with bars in each of 4 layers naming the set-down, got " + zr.map(r => r.callout).join(" | "));
    const ck = Math.max(300, 6 * dd.d);
    zr.forEach(r => r.bars.forEach(b => {
      const q = b.pts, X = r.dir === "X", mid = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
      if (q.length !== 4 || b.shape !== "Z-bar" || Math.abs(Math.abs(q[2][2] - q[1][2]) - dd.d) > 0.5) p(dd.id + ": Z-bar " + b.id + " does not drop " + dd.d);
      const leg = (i, j) => Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
      if (Math.abs(leg(0, 1) - lap) > 0.5 || Math.abs(leg(2, 3) - lap) > 0.5 || Math.abs(leg(1, 2) - ck) > 0.5) p(dd.id + ": Z-bar " + b.id + " legs " + [leg(0, 1), leg(1, 2), leg(2, 3)] + " (want " + lap + " / " + ck + " / " + lap + ")");
      const onEdge = X ? (Math.abs(mid[0] - dd.x0) < 0.5 || Math.abs(mid[0] - dd.x1) < 0.5) && mid[1] > dd.y0 && mid[1] < dd.y1 : (Math.abs(mid[1] - dd.y0) < 0.5 || Math.abs(mid[1] - dd.y1) < 0.5) && mid[0] > dd.x0 && mid[0] < dd.x1;
      if (!onEdge) p(dd.id + ": Z-bar " + b.id + " crank is not centred on this set-down's edge: " + JSON.stringify(mid));
      const lowIn = q[1][2] < q[2][2] ? q[1] : q[2]; if (!inR(dd, lowIn[0] + (X ? Math.sign(q[0][0] - q[3][0]) * -1 : 0), lowIn[1] + (X ? 0 : Math.sign(q[0][1] - q[3][1]) * -1))) p(dd.id + ": Z-bar " + b.id + " has its low leg outside the set-down");
    }));
  });
  // every main bar sits at its layer's level: lowered by the depth inside a set-down, raised by the rise in the step, and never across an edge
  let inDrop = 0, inStep = 0;
  MJ.bars.filter(b => b.run.kind === "main").forEach(b => {
    const q = b.pts, mx = (q[0][0] + q[q.length - 1][0]) / 2, my = (q[0][1] + q[q.length - 1][1]) / 2, z = MJ.Z[b.layer];   // q[1] is on the main leg whether or not the ends are cogged
    const dd = MJ.DROPS.find(r => inR(r, mx, my)), st = MJ.STEP && mx > MJ.STEP.x0 && my > MJ.STEP.y0;
    const want = dd ? z - dd.d : st ? z + MJ.STEP.rise : z, where = "main bar " + b.id + " (" + b.run.label + ")";
    if (Math.abs(q[1][2] - want) > 0.5) p(where + " is at z " + q[1][2] + ", want " + want + (dd ? " in " + dd.id : st ? " in the step" : ""));
    if (dd) inDrop++; if (st) inStep++;
    const xs = q.map(v => v[0]), ys = q.map(v => v[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    MJ.DROPS.forEach(r => { const over = x0 < r.x1 - 1 && x1 > r.x0 + 1 && y0 < r.y1 - 1 && y1 > r.y0 + 1, within = x0 >= r.x0 - 1 && x1 <= r.x1 + 1 && y0 >= r.y0 - 1 && y1 <= r.y1 + 1; if (over && !within) p(where + " crosses the edge of " + r.id); });
    if (MJ.STEP && x1 > MJ.STEP.x0 + 1 && y1 > MJ.STEP.y0 + 1 && !(x0 >= MJ.STEP.x0 - 1 && y0 >= MJ.STEP.y0 - 1) && !(x0 < MJ.STEP.x0 && x1 <= MJ.STEP.x0 + MJ.STEP.nib + 1) && !(y0 < MJ.STEP.y0 && y1 <= MJ.STEP.y0 + MJ.STEP.nib + 1)) p(where + " crosses the step line");
  });
  if (inDrop < 40 || inStep < 40) p("expected mat bars inside the set-downs and the step, got " + inDrop + " / " + inStep);
  const lr = MJ.runs.filter(r => r.kind === "l");
  if (lr.length !== 4 || lr.some(r => !r.bars.length || !/EACH SIDE OF 250 STEP/.test(r.callout))) p("expected L-bar runs for a 250 step in 4 layers, got " + lr.map(r => r.callout).join(" | "));
  lr.forEach(r => r.bars.forEach(b => { const q = b.pts; if (q.length !== 3 || Math.abs(Math.abs(q[2][2] - q[1][2]) - 250) > 0.5 || Math.abs(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) - (b.note.indexOf("raised") >= 0 ? lap : lap + MJ.C + 40)) > 0.5) p("L-bar " + b.id + " legs: " + JSON.stringify(q)); }));
  // the sheet and the annotations name each level change
  if (SJ.concrete.drops.length !== 2 || SJ.concrete.drops[1].id !== "SET DOWN 100" || !SJ.concrete.step || SJ.concrete.step.rect.x0 !== 8000 || SJ.concrete.step.nib !== 300) p("sheet concrete " + JSON.stringify([SJ.concrete.drops, SJ.concrete.step]));
  ["SET DOWN 50 · ENS", "SET DOWN 100 · SET-DOWN 2", "STEP UP 250"].forEach(t => { if (!SJ.notes.some(n => n.text === t)) p("no sheet note '" + t + "'"); });
  // bad rows: each reported by its row, left out, the good row and the floor still build
  const bad = buildModel(Object.assign({}, grid, { step: job.step, setdowns: [
    { name: "edge", x0: 300, y0: 1000, x1: 2500, y1: 3000, depth: 50 },        // 1 within 780 of the slab edge (Z-bars would poke out)
    { name: "deep", x0: 7000, y0: 1000, x1: 9500, y1: 3000, depth: 200 },      // 2 deeper than a Z-bar set-down
    { name: "small", x0: 7000, y0: 1000, x1: 8000, y1: 2000, depth: 50 },      // 3 too small for Z-bars from both edges
    { name: "beam", x0: 5000, y0: 1000, x1: 7000, y1: 3000, depth: 50 },       // 4 on IB1
    { name: "step", x0: 9000, y0: 7000, x1: 11000, y1: 9000, depth: 50 },      // 5 in the raised bay
    { name: "ok", x0: 1000, y0: 6500, x1: 3500, y1: 9000, depth: 50 },         // 6 fine
    { name: "near", x0: 1000, y0: 4000, x1: 3500, y1: 5700, depth: 50 },       // 7 800 from OK: the Z-bars would overlap
    { name: "blank", x0: 1000, y0: "", x1: 3000, y1: 3000, depth: 50 }] }));   // 8 a blank field
  const want = [[1, /at least 780 inside the slab edges/], [2, /depth must be 10–160/], [3, /too small for Z-bar splices.*at least 1,600/], [4, /sits on beam IB1/], [5, /overlaps the step/], [7, /too close to OK.*keep 1,500 clear/], [8, /must all be numbers/]];
  want.forEach(w => { if (!bad.errors.some(e => e.indexOf("Set-down " + w[0] + " ") === 0 && w[1].test(e))) p("missing error for set-down " + w[0] + " " + w[1] + "; got " + bad.errors.join(" | ")); });
  if (bad.errors.length !== want.length) p("expected exactly " + want.length + " errors, got " + bad.errors.length + ": " + bad.errors.join(" | "));
  if (bad.DROPS.map(d => d.id).join(",") !== "OK" || bad.DROPS[0].row !== 5 || !bad.STEP || bad.runs.filter(r => r.kind === "z").length !== 4 || bad.bars.filter(b => b.run.kind === "main").length < 100) p("the good row and the floor should still build: " + JSON.stringify(bad.DROPS.map(d => d.id)));
  // bad steps: one error each, naming the step; no step is built but the floor is
  [[{ x0: 8000, y0: 6000, rise: 100, nib: 300 }, /^Step: a rise of 160 or less is a shallow set-down/], [{ x0: 8000, y0: 6000, rise: 700, nib: 300 }, /^Step: rise must be at most 600/],
   [{ x0: 8000, y0: 6000, rise: 250, nib: 100 }, /^Step: nib must be 160–600/], [{ x0: 200, y0: 6000, rise: 250, nib: 300 }, /^Step: the step line must be at least 1,000 from every slab edge/],
   [{ x0: 6000, y0: 6000, rise: 250, nib: 300 }, /^Step: its nib sits on beam IB1/], [{ x0: 8000, y0: "", rise: 250, nib: 300 }, /^Step: from x, from y, rise and nib must all be numbers/]].forEach(w => {
    const ms = buildModel(Object.assign({}, grid, { step: w[0], setdowns: [] }));
    if (ms.errors.length !== 1 || !w[1].test(ms.errors[0]) || ms.STEP || ms.runs.some(r => r.kind === "l") || ms.bars.filter(b => b.run.kind === "main").length < 100) p("bad step " + JSON.stringify(w[0]) + ": " + ms.errors.join(" | ") + (ms.STEP ? " (step built)" : ""));
  });
  // the example's rows on a small grid only warn (the step line would sit on grid 1 / A, the set-down off the slab)
  const small = buildModel({ gridX: [0, 4000], gridY: [0, 3000] });
  if (small.errors.length || small.STEP || small.DROPS.length || !small.warnings.some(w => /^Example step left out: the step line must be at least/.test(w)) || !small.warnings.some(w => /^Example set-down wet area left out: must sit at least/.test(w))) p("example levels on a small grid should warn, not error: " + small.errors.concat(small.warnings).join(" | "));
  const off = buildModel(Object.assign({}, job, { features: Object.assign({}, job.features, { drop: false, step: false }) }));
  if (off.DROPS.length || off.STEP || off.errors.length || off.runs.some(r => r.kind === "z" || r.kind === "l")) p("feature toggles off should ignore the rows");
  if (problems.length) fail(problems.slice(0, 20).join("\n"));
  console.log("  level inputs: example rows reproduce the example; job with 2 set-downs (50, 100) + 250 step: bars " + MJ.bars.length + ", Z-bar runs " + MJ.runs.filter(r => r.kind === "z").length + ", L-bar runs " + lr.length + "; 7 bad rows + 6 bad steps reported, 1 good row built");
}

// balconies on any edge (#7c): a list, one per edge here, each built in its own edge frame; the bars of every balcony
// sit in its rect (the cantilever top bars reach 1,800 back into the slab), run the right way for the edge, cog at the
// free edges, and the grids / sheet frame the whole pour; bad rows are reported by row and left out
{
  const problems = [], p = m => problems.push("balconies: " + m);
  const feats = Object.assign({}, DEFAULT_CFG.features, { drop: false, step: false, openings: false });
  const four = [{ name: "north", edge: "N", from: 1000, to: 5000, proj: 2400, thk: 200, down: 0 }, { edge: "s", from: 7000, to: 11000, proj: 1500, thk: 180, down: 50 },
    { name: "Terrace", edge: "E", from: 2000, to: 6000, proj: 1800, thk: 180, down: 30 }, { edge: "W", from: 6000, to: 9500, proj: 1200, thk: 160, down: 0 }];
  const job = { gridX: [0, 6000, 12000], gridY: [0, 5000, 10000], features: feats, balconies: four };
  const MB = checkModel("four balconies", job, 800);   // the general invariants (grid setout on every balcony run, sheets, tags) hold on every edge
  if (MB.BALCS.length !== 4 || MB.BALCS.map(b => b.id).join(",") !== "NORTH,BALCONY 2,TERRACE,BALCONY 4") p("balcony ids " + MB.BALCS.map(b => b.id).join(","));
  const SL = MB.SL, want = { N: { root: SL.y1, along: "X", sg: 1 }, S: { root: SL.y0, along: "X", sg: -1 }, E: { root: SL.x1, along: "Y", sg: 1 }, W: { root: SL.x0, along: "Y", sg: -1 } };
  if (JSON.stringify(MB.EXT) !== JSON.stringify({ x0: SL.x0 - 1200, x1: SL.x1 + 1800, y0: SL.y0 - 1500, y1: SL.y1 + 2400 })) p("EXT should frame the slab and its balconies: " + JSON.stringify(MB.EXT));
  MB.BALCS.forEach((b, i) => {
    const w = want[b.edge], row = four[i], where = b.id + " (" + b.edge + ")", X = b.along === "X";
    if (!w || b.along !== w.along || b.sg !== w.sg || b.root !== w.root || b.tip !== w.root + w.sg * row.proj) return p(where + ": edge frame " + JSON.stringify([b.along, b.sg, b.root, b.tip]));
    // the rect hangs off the edge: along from..to, out from the slab edge by proj
    const al = X ? [b.x0, b.x1] : [b.y0, b.y1], ou = X ? [b.y0, b.y1] : [b.x0, b.x1];
    if (al[0] !== row.from || al[1] !== row.to || Math.min(...ou) !== Math.min(b.root, b.tip) || Math.max(...ou) !== Math.max(b.root, b.tip)) p(where + ": rect " + JSON.stringify([b.x0, b.x1, b.y0, b.y1]));
    if (b.top !== MB.T - row.down || b.bot !== MB.T - row.down - row.thk) p(where + ": levels " + b.top + " / " + b.bot);
    const runs = MB.runs.filter(r => r.balc === b), by = l => runs.find(r => r.layer === l && r.kind === "balc");
    if (runs.length !== 5) p(where + ": expected 5 runs, got " + runs.length);
    // layer A and D run along the edge, B and the cantilever bars run out from it; all bars inside the balcony's width
    if (!by("A") || by("A").dir !== b.along || !by("D") || by("D").dir !== b.along) p(where + ": layers A / D should run along the edge");
    if (!by("B") || by("B").dir === b.along || !by("C") || by("C").dir === b.along) p(where + ": layers B / C should run out from the edge");
    const inside = (v, lo, hi) => v >= lo - 1 && v <= hi + 1;
    runs.forEach(r => r.bars.forEach(bar => bar.pts.forEach(q => {
      const a = X ? q[0] : q[1], o = X ? q[1] : q[0];
      if (!inside(a, al[0], al[1])) p(where + ": bar " + bar.id + " (" + r.label + ") outside the balcony's width");
      // out: within the projection, or (cantilever top bars) up to 1,800 back into the slab
      const t = (o - b.root) * b.sg;
      if (!(t >= -1800 - 1 && t <= row.proj + 1)) p(where + ": bar " + bar.id + " (" + r.label + ") " + t + " out from the edge");
      if (r.layer !== "C" && t < -1) p(where + ": " + r.label + " bar reaches into the slab");
      if (!(q[2] >= Math.min(b.bot, MB.Z.C - 10) - 1 && q[2] <= Math.max(b.top, MB.Z.C) + 1)) p(where + ": bar " + bar.id + " outside the balcony depth");
    })));
    // cantilever bars: cog at the free edge (first leg vertical at proj − cover), back leg ends 1,800 inside the slab; cranked when the mats do not line up
    const cant = by("C");
    cant.bars.forEach(bar => {
      const tipT = ((X ? bar.pts[0][1] : bar.pts[0][0]) - b.root) * b.sg, last = bar.pts[bar.pts.length - 1], backT = ((X ? last[1] : last[0]) - b.root) * b.sg;
      if (Math.abs(tipT - (row.proj - MB.C)) > 0.5 || bar.pts[0][2] >= bar.pts[1][2] || Math.abs(backT + 1800) > 0.5) p(where + ": cantilever bar " + bar.id + " tip / back " + tipT + " / " + backT);
      if (last[2] !== MB.Z.C) p(where + ": cantilever bar " + bar.id + " does not finish at the layer C level");
    });
    const dz = Math.abs(MB.Z.C - (b.top - MB.C - 18));
    if ((dz < 2) !== (cant.bars[0].shape === "cog") || (dz >= 2) !== /Z AT/.test(cant.callout)) p(where + ": crank " + dz + " vs shape " + cant.bars[0].shape + " / " + cant.callout);
    // layer D distribution bars cog down at both side edges, edge bars on the three free edges top and bottom
    by("D").bars.forEach(bar => { if (bar.pts.length !== 4 || bar.pts[0][2] >= bar.pts[1][2] || bar.pts[3][2] >= bar.pts[2][2]) p(where + ": layer D bar " + bar.id + " should cog at both ends"); });
    const eb = runs.find(r => r.kind === "edge"); if (!eb || eb.bars.length !== 6) p(where + ": expected 6 edge bars");
    const sideNames = X ? ["west", "east"] : ["south", "north"];
    if (eb && (!eb.bars.some(bar => bar.setout === "balcony " + sideNames[0] + " edge") || !eb.bars.some(bar => bar.setout === "balcony " + sideNames[1] + " edge") || eb.bars.filter(bar => bar.setout === "balcony outer edge").length !== 2)) p(where + ": edge bar setouts " + eb.bars.map(bar => bar.setout).join(", "));
    // setout from the grid along the edge for the bars across the projection
    const g = { N: ["N of grid C", 10000], S: ["S of grid A", 0], E: ["E of grid 3", 12000], W: ["W of grid 1", 0] }[b.edge];
    if (!by("A").bars.every(bar => bar.setout === fmt(Math.abs((X ? bar.pts[0][1] : bar.pts[0][0]) - g[1])) + " " + g[0])) p(where + ": layer A setout '" + by("A").bars[0].setout + "' should read from the edge grid (" + g[0] + ")");
    // several balconies: tags and callouts carry the balcony's name; the plain example keeps BALC / BALCONY
    if (b.plain || runs.some(r => r.label.indexOf(b.id) !== 0 || r.callout.indexOf(b.id) !== 0)) p(where + ": labels should carry the name: " + runs.map(r => r.label).join(" / "));
    if (b.label !== b.id + " " + row.thk + " THK" + (row.down ? " · SET DOWN " + row.down : "")) p(where + ": note label " + b.label);
    // chairs in every balcony
    if (!MB.chairs.some(c => c.pts[0][0] > b.x0 && c.pts[0][0] < b.x1 && c.pts[0][1] > b.y0 && c.pts[0][1] < b.y1 && c.pts[0][2] === b.bot)) p(where + ": no chairs in the balcony");
  });
  // the sheet frames the whole pour: bounds, grid lines and bubbles reach past every balcony, one outline and one note per balcony
  const SB = buildSheet(MB, ["A", "B", "C", "D", "BM", "CH", "ST"], []);
  if (SB.bounds.x0 !== MB.EXT.x0 - 1700 || SB.bounds.y0 !== MB.EXT.y0 - 1700 || SB.bounds.x1 !== MB.EXT.x1 + 1700 || SB.bounds.y1 !== MB.EXT.y1 + 1700) p("sheet bounds " + JSON.stringify(SB.bounds));
  if (!SB.grids.x.every(g => g.a < MB.EXT.y0 && g.b > MB.EXT.y1) || !SB.grids.y.every(g => g.a < MB.EXT.x0 && g.b > MB.EXT.x1)) p("grid lines should run past the balconies");
  if (!SB.gridDims.every(d => d.measure === "x" ? d.at < MB.EXT.y0 : d.at < MB.EXT.x0)) p("dimension strings should sit outside the south / west balconies");
  if (SB.concrete.balconies.length !== 4 || !SB.concrete.balconies.some(r => r.id === "TERRACE" && r.x0 === SL.x1)) p("sheet outlines " + JSON.stringify(SB.concrete.balconies.map(r => r.id)));
  MB.BALCS.forEach(b => { if (!SB.notes.some(n => n.text === b.label && n.x > b.x0 && n.x < b.x1 && n.y > b.y0 && n.y < b.y1)) p("no sheet note inside " + b.id); });
  // the one-layer sheets of a four-balcony floor still place every tag
  ["A", "B", "C", "D"].forEach(l => { const S1 = buildSheet(MB, [l], []); if (S1.tags.filter(t => t.overlap).length) p("layer " + l + " sheet has overlapping tags"); });
  // the example's balcony, entered as a list row on the north edge, is the example (plain names, BALC tags)
  const EXB = lib.exampleGeometry(DEFAULT_CFG).balconies[0], ME = buildModel(Object.assign({}, DEFAULT_CFG, { balconies: [EXB] }));
  if (ME.errors.length || ME.bars.length !== M.bars.length || Math.round(ME.kg) !== Math.round(M.kg) || !ME.BALCS[0].plain || ME.BALCS[0].label !== "BALCONY 180 THK · SET DOWN 50" || !ME.runs.some(r => r.label === "BALC N12-300 · A")) p("the example's balcony as a list row differs from the example: " + ME.errors.join(" | "));
  // the same balcony turned to each other edge keeps its bar count and mass (the same bars, turned)
  const turned = ["S", "E", "W"].map(e => buildModel(Object.assign({}, job, { balconies: [Object.assign({}, four[0], { edge: e, from: 1000, to: 5000 })] })));
  const base = buildModel(Object.assign({}, job, { balconies: [four[0]] })), balcKg = m => m.bars.filter(b => b.run.balc).reduce((s, b) => s + b.kg, 0), balcN = m => m.bars.filter(b => b.run.balc).length;
  turned.forEach((m, i) => { if (m.errors.length || balcN(m) !== balcN(base) || Math.abs(balcKg(m) - balcKg(base)) > 0.5) p("the north balcony turned to " + ["S", "E", "W"][i] + " should carry the same bars: " + balcN(m) + " / " + balcKg(m).toFixed(1) + " vs " + balcN(base) + " / " + balcKg(base).toFixed(1) + " " + m.errors.join(" | ")); });
  // bad rows: reported by row number and left out, the good rows and the floor still build
  const bad = buildModel(Object.assign({}, job, { balconies: [
    { edge: "Q", from: 0, to: 3000, proj: 1500, thk: 180, down: 0 },             // 1 no such edge
    { edge: "N", from: 1000, to: 5000, proj: 2400, thk: 200, down: 0 },          // 2 fine
    { edge: "N", from: 5200, to: 8000, proj: 1500, thk: 180, down: 0 },          // 3 200 from row 2
    { edge: "E", from: 8000, to: 10250, proj: 1500, thk: 180, down: 0 },         // 4 fine (to the NE corner)
    { edge: "N", from: 10000, to: 12250, proj: 1500, thk: 180, down: 0 },        // 5 meets row 4 at the corner
    { edge: "W", from: -500, to: 3000, proj: 1500, thk: 180, down: 0 },          // 6 off the slab
    { edge: "S", from: 1000, to: 5000, proj: 4500, thk: 180, down: 0 },          // 7 too far out
    { edge: "S", from: 6000, to: "", proj: 1500, thk: 180, down: 0 },            // 8 a blank field
    { edge: "w", from: 4000, to: 9000, proj: 1200, thk: 160, down: 20 }] }));    // 9 fine
  const wantB = [[1, /edge must be N, S, E or W/], [3, /too close to BALCONY 2/], [5, /too close to BALCONY 4/], [6, /must sit on the slab's west edge, between -250 and 10,250 \(y, from grid A\)/], [7, /projection must be 500–4,000/], [8, /must all be numbers/]];
  wantB.forEach(w => { if (!bad.errors.some(e => e.indexOf("Balcony " + w[0] + " ") === 0 && w[1].test(e))) p("missing error for balcony " + w[0] + " " + w[1] + "; got " + bad.errors.join(" | ")); });
  if (bad.errors.length !== wantB.length) p("expected exactly " + wantB.length + " errors, got " + bad.errors.length + ": " + bad.errors.join(" | "));
  if (bad.BALCS.map(b => b.id + "@" + b.row).join(",") !== "BALCONY 2@1,BALCONY 4@3,BALCONY 9@8") p("the good rows should still build: " + bad.BALCS.map(b => b.id + "@" + b.row).join(","));
  if (bad.bars.filter(b => b.run.kind === "main").length < 100) p("the floor was not built around the bad rows");
  // the step blocks the north edge east of its corner and the east edge north of it
  const stepped = buildModel({ gridX: [0, 6000, 12000], gridY: [0, 5000, 10000], features: Object.assign({}, feats, { step: true }), step: { x0: 7000, y0: 6000, rise: 200, nib: 300 },
    balconies: [{ edge: "N", from: 1000, to: 5000, proj: 1500, thk: 180, down: 0 }, { edge: "N", from: 5500, to: 9000, proj: 1500, thk: 180, down: 0 }, { edge: "E", from: 500, to: 4500, proj: 1500, thk: 180, down: 0 }, { edge: "E", from: 5000, to: 9000, proj: 1500, thk: 180, down: 0 }, { edge: "S", from: 6500, to: 9500, proj: 1500, thk: 180, down: 0 }] });
  if (!stepped.errors.some(e => /^Balcony 2 .*keep it west of x 7,000/.test(e)) || !stepped.errors.some(e => /^Balcony 4 .*keep it south of y 6,000/.test(e)) || stepped.errors.length !== 2 || stepped.BALCS.length !== 3) p("step / balcony conflicts: " + stepped.errors.join(" | ") + " built " + stepped.BALCS.length);
  if (problems.length) fail(problems.slice(0, 20).join("\n"));
  console.log("  balconies: four edges built (bars " + MB.bars.length + ", balcony runs " + MB.runs.filter(r => r.balc).length + "); the north balcony turned to S / E / W keeps its bars; 6 bad rows reported, 3 good rows built; step conflicts on N and E");
}

// lap and development lengths (#5): AS 3600 Section 13 values reproduce the research note (Findings 2: the shipped default
// table and the ACOR B23 fit), cd = min(cover, half clear spacing) with the governing value named, laps round up to 50, a
// project lap table drives the laps per size and case, every shorter lap in use is flagged, bad table lines are reported
{
  const problems = [], p = m => problems.push("laps: " + m);
  // Findings 2.4: tension lap 1.25 × Lsy.tb, fsy 500, cd 20, k1 1.0, rounded up to 10 (that table's rounding), N10–N40 × 20–65 MPa
  const FCS = [20, 25, 32, 40, 50, 65];
  const T24 = { 10: [490, 440, 390, 370, 370, 370], 12: [630, 570, 500, 450, 440, 440], 16: [930, 830, 740, 660, 590, 580], 20: [1250, 1120, 990, 890, 790, 730], 24: [1560, 1390, 1230, 1100, 990, 870], 28: [1890, 1690, 1490, 1340, 1190, 1050], 32: [2240, 2000, 1770, 1590, 1420, 1250], 36: [2630, 2350, 2080, 1860, 1660, 1460], 40: [3040, 2720, 2410, 2150, 1930, 1690] };
  let cells = 0;
  Object.keys(T24).forEach(sz => FCS.forEach((fc, i) => {
    const c = lapCalc({ size: +sz, fc: fc, cover: 20, spacing: 0 }), up10 = Math.ceil((c.raw - 0.5) / 10) * 10; cells++;
    if (Math.abs(up10 - T24[sz][i]) > 10) p("N" + sz + " at " + fc + " MPa: raw " + c.raw + " (up to 10: " + up10 + ") vs Findings 2.4 " + T24[sz][i]);
    if (c.cdGov !== "cover" || c.cd !== 20 || c.k1 !== 1) p("N" + sz + ": cd / k1 " + JSON.stringify([c.cd, c.cdGov, c.k1]));
    if (c.lap % 50 || c.lap < c.raw || c.lap - c.raw >= 50) p("N" + sz + " at " + fc + ": lap " + c.lap + " is not raw " + c.raw + " rounded up to 50");
    const c13 = lapCalc({ size: +sz, fc: fc, cover: 20, spacing: 0, k1: 1.3 });
    if (Math.abs(c13.raw - 1.3 * c.raw) > 1.5) p("N" + sz + " at " + fc + ": k1 1.3 is not linear (" + c13.raw + " vs 1.3 × " + c.raw + ")");
  }));
  // the 29 k1 db floor governs N10 / N12 at 50 and 65 MPa
  [[10, 50], [10, 65], [12, 50], [12, 65]].forEach(([sz, fc]) => { const c = lapCalc({ size: sz, fc: fc, cover: 20, spacing: 0 }); if (c.Lsy_tb !== c.floor || !/minimum/.test(c.rule)) p("N" + sz + " at " + fc + " should sit on the 29 k1 db floor: " + JSON.stringify(c)); });
  // ACOR B23 (Findings 2.2 / 2.3): slab cells = 1.25 × Lsy.tb at cd 20 rounded to the nearest 50 (within −2 % … +7 % of the formula); beam >300 = ×1.3; columns = 40db
  const B23 = { slab: { 12: [600, 500, 450], 16: [850, 750, 650], 20: [1100, 1000, 900] }, gt: { 12: [750, 650, 600], 16: [1100, 950, 850], 20: [1450, 1300, 1150], 24: [1800, 1600, 1400], 28: [2200, 1950, 1700], 32: [2600, 2300, 2050], 36: [3050, 2700, 2400] }, col: { 12: 500, 16: 650, 20: 800, 24: 950, 28: 1150, 32: 1300, 36: 1450 } };
  [25, 32, 40].forEach((fc, i) => {
    Object.keys(B23.slab).forEach(sz => { const r = B23.slab[sz][i] / lapCalc({ size: +sz, fc: fc, cover: 20, spacing: 0 }).raw; if (r < 0.97 || r > 1.08) p("B23 slab N" + sz + " at " + fc + " is " + r.toFixed(3) + " × the formula"); });
    Object.keys(B23.gt).forEach(sz => { const r = B23.gt[sz][i] / lapCalc({ size: +sz, fc: fc, cover: 20, spacing: 0, k1: 1.3 }).raw; if (r < 0.97 || r > 1.08) p("B23 beam >300 N" + sz + " at " + fc + " is " + r.toFixed(3) + " × the formula"); });
  });
  Object.keys(B23.col).forEach(sz => { const c = lapCalc({ size: +sz, fc: 32, comp: true }); if (Math.abs(B23.col[sz] - 40 * sz) > 30 || c.raw !== 40 * sz || !/40db/.test(c.rule)) p("B23 column N" + sz + " " + B23.col[sz] + " vs 40db " + c.raw + " (" + c.rule + ")"); });
  // compression: N24 at 32 → Lsy.cb on its 0.0435 fsy db floor (522), 40db 960 governs, 1000 after rounding; N16 at 20 → Lsy.cb 394 above the floor
  const c24 = lapCalc({ size: 24, fc: 32, comp: true }), c16 = lapCalc({ size: 16, fc: 20, comp: true });
  if (c24.Lsy_cb !== 522 || c24.raw !== 960 || c24.lap !== 1000 || c16.Lsy_cb !== 394 || c16.raw !== 640) p("compression values: " + JSON.stringify([c24, c16]));
  // cd: half the clear spacing governs two N16 trimmers 75 apart with 30 cover ((75 − 32) / 2 = 21.5); cover governs an N16 mat at 200; k3 clamps at 0.7 for a deep bar
  const ct = lapCalc({ size: 16, fc: 32, cover: 30, spacing: 75 }), cm = lapCalc({ size: 16, fc: 32, cover: 30, spacing: 200 }), cdeep = lapCalc({ size: 12, fc: 32, cover: 60, spacing: 0 });
  if (ct.cdGov !== "half clear spacing" || ct.cd !== 22 || Math.abs(ct.k3 - 0.948) > 0.001 || cm.cdGov !== "cover" || cm.cd !== 30 || Math.abs(cm.k3 - 0.869) > 0.001 || cdeep.k3 !== 0.7) p("cd / k3: " + JSON.stringify([ct, cm, cdeep]));
  if (ct.lap <= cm.lap) p("a tighter cd must give a longer lap (" + ct.lap + " vs " + cm.lap + ")");
  // k1 from the concrete below the bar: in a 400 slab the top mats (358 below) take 1.3, the bottom mats 1.0 (Cl 13.1.2.2)
  const MK = buildModel(Object.assign({}, DEFAULT_CFG, { thickness: 400 }));
  if (MK.errors.length || MK.mats.D.lap.calc.k1 !== 1.3 || MK.mats.C.lap.calc.k1 !== 1.3 || MK.mats.A.lap.calc.k1 !== 1 || MK.mats.B.lap.calc.k1 !== 1 || MK.mats.D.lap.calc.lap <= MK.mats.B.lap.calc.lap) p("k1 by depth in a 400 slab: " + JSON.stringify([MK.errors, ["A", "B", "C", "D"].map(l => MK.mats[l].lap.calc.k1)]));
  // the example floor: flat 600 everywhere; the AS 3600 value sits beside every lap in use, the short ones are flagged (N16 layer A needs 700 at cd 30, EB1 top bars 800 with k1 1.3, the N24 starter projection 950 vs 40db 960) and nothing else is
  const L = M.laps;
  if (L.source !== "flat" || L.table || L.text !== "600 all bars" || L.missing.length) p("example lap source " + JSON.stringify([L.source, L.text, L.missing]));
  const row = (kase, sz, what) => L.rows.find(r => r.kase === kase && r.size === sz && (!what || r.what.indexOf(what) >= 0));
  const rA = row("slab", 16, "layer A"), rB = row("slab", 12, "layer B"), rD = row("slab", 12, "layer D"), rE = row("beamGt300", 16, "EB1 top bars"), rEb = row("beamLt300", 16, "EB1 bottom bars"), rS = row("column", 24), rT = row("slab", 16, "trimmers (A)");
  if (!rA || rA.len !== 600 || rA.calc.lap !== 700 || rA.calc.cd !== 30 || rA.calc.cdGov !== "cover" || rA.calc.k1 !== 1 || !rA.short || !rA.lapped) p("layer A lap row " + JSON.stringify(rA));
  if (!rB || rB.cover !== 46 || rB.calc.lap !== 450 || rB.short || !rB.lapped) p("layer B lap row (cover 30 + 16) " + JSON.stringify(rB));
  if (!rD || rD.cover !== 30 || rD.calc.lap !== 450 || rD.short) p("layer D lap row " + JSON.stringify(rD));
  if (!rE || rE.calc.k1 !== 1.3 || rE.calc.lap !== 800 || !rE.short || !rE.lapped) p("EB1 top bars lap row " + JSON.stringify(rE));
  if (!rEb || rEb.calc.k1 !== 1 || rEb.calc.lap !== 600 || rEb.short || !rEb.lapped) p("EB1 bottom bars lap row " + JSON.stringify(rEb));
  if (!rS || rS.len !== 950 || rS.src !== "fixed" || rS.calc.lap !== 1000 || !rS.short || !rS.lapped || M.PROJ !== 950) p("starter lap row " + JSON.stringify(rS));
  if (!rT || rT.calc.cdGov !== "half clear spacing" || rT.lapped) p("trimmers never lap, their row stays unflagged: " + JSON.stringify(rT));
  const lapWarns = M.warnings.filter(w => /^Lap /.test(w));
  if (lapWarns.length !== 3 || !lapWarns.some(w => /^Lap N16 slab \(layer A.*600 \(project flat lap\) is shorter than AS 3600 Cl 13\.2\.2 1\.25 × Lsy\.tb gives, 700 \(Lsy\.tb 530 × 1\.25 = 662, up to 50; cd 30 = cover, k1 1\.0\)/.test(w)) || !lapWarns.some(w => /^Lap N16 beam >300 below \(EB1 top bars\): 600 .* 800 .*k1 1\.3/.test(w)) || !lapWarns.some(w => /^Lap N24 column.*950 \(fixed by the detail\) is shorter than AS 3600 Cl 13\.2\.4 40db gives, 1000/.test(w))) p("example lap warnings: " + JSON.stringify(lapWarns));
  M.runs.filter(r => r.lap).forEach(r => r.bars.forEach(b => { if (b.grid && b.grid.laps.some(z => z.len !== r.lap.len)) p("run " + r.id + " lap zones differ from its lap " + r.lap.len); }));
  if (M.runs.some(r => r.bars.some(b => b.lapPrev || b.lapNext) && !r.lap)) p("a lapped run has no lap");
  // the B23 table as the project's: layers A / B–D take 750 / 500 (f'c 32), Z-bar legs and lap zones follow, the EB1 top bars 950, the
  // starters the COLUMN row (950, flagged 10 under 40db), the model's text says so, and the sheet title names the layer's lap
  const TBL = "# ACOR B23 R12\nSLAB 25 32 40\nN12 600 500 450\nN16 850 750 650\nN20 1100 1000 900\nBEAM <300 25 32 40\nN16 850 750 650\nN20 1100 1000 900\nBEAM >300 25 32 40\nN16 1100 950 850\nN20 1450 1300 1150\nCOLUMNS AND WALLS\nN24 950\n";
  const PT = parseLapTable(TBL);
  if (PT.errors.length || PT.rows !== 8 || Object.keys(PT.cases).sort().join() !== "beamGt300,beamLt300,column,slab" || PT.cases.slab.fcs.join() !== "25,32,40" || PT.cases.column.fcs !== null) p("B23 table parse " + JSON.stringify(PT));
  if (lapLookup(PT, "slab", 16, 32).len !== 750 || lapLookup(PT, "column", 24, 65).len !== 950 || !lapLookup(PT, "slab", 12, 50).missing || lapLookup(PT, "slab", 24, 32) !== null || lapLookup(PT, "wall", 12, 32) !== null) p("lapLookup");
  const MT = buildModel(Object.assign({}, DEFAULT_CFG, { lapTable: TBL }));
  if (MT.errors.length) p("B23 table model errors: " + MT.errors.join(" | "));
  const mA = MT.mats.A.lap, mD = MT.mats.D.lap;
  if (MT.laps.source !== "table" || mA.len !== 750 || mA.src !== "table" || mD.len !== 500 || MT.PROJ !== 950 || MT.laps.text !== "per lap table") p("B23 table laps " + JSON.stringify([MT.laps.source, mA.len, mA.src, mD.len, MT.PROJ, MT.laps.text]));
  const zA = MT.runs.find(r => r.kind === "z" && r.layer === "A"), zD = MT.runs.find(r => r.kind === "z" && r.layer === "D");
  // the example's wet-area set-down is too close to the west edge for a 750 lap (needs 990, has 850): left out with a warning, as a job row would be an error
  if (zA || zD || !MT.warnings.some(w => /^Example set-down wet area left out: must sit at least 990 inside/.test(w))) p("the set-down should drop out at the longer lap: " + MT.warnings.join(" | "));
  const MT2 = buildModel(Object.assign({}, DEFAULT_CFG, { lapTable: TBL, setdowns: [{ name: "WET AREA", x0: 1200, y0: 5300, x1: 4600, y1: 8200, depth: 70 }] }));
  const z2 = MT2.runs.find(r => r.kind === "z" && r.layer === "A"), z2D = MT2.runs.find(r => r.kind === "z" && r.layer === "D");
  if (MT2.errors.length || !z2 || !z2D || !/LAP 750 EACH SIDE/.test(z2.callout) || !/LAP 500 EACH SIDE/.test(z2D.callout)) p("Z-bar laps per layer from the table: " + JSON.stringify([MT2.errors, z2 && z2.callout, z2D && z2D.callout]));
  const legs = b => [0, 1, 2].map(i => Math.hypot(b.pts[i + 1][0] - b.pts[i][0], b.pts[i + 1][1] - b.pts[i][1]));
  if (z2 && z2.bars.some(b => Math.abs(legs(b)[0] - 750) > 0.5)) p("layer A Z-bar legs are not 750");
  if (MT2.bars.filter(b => b.layer === "A" && b.run.kind === "main" && b.grid && b.grid.laps.length).some(b => b.grid.laps.some(z => z.len !== 750))) p("layer A lap zones are not 750 with the table");
  if (MT2.bars.filter(b => b.layer === "D" && b.run.kind === "main" && b.grid && b.grid.laps.length).some(b => b.grid.laps.some(z => z.len !== 500))) p("layer D lap zones are not 500 with the table");
  const eT = MT2.runs.find(r => r.kind === "beam" && /EB1 .* T$/.test(r.label)), eB = MT2.runs.find(r => r.kind === "beam" && /EB1 .* B$/.test(r.label)), st = MT2.runs.find(r => r.kind === "start");
  if (!eT || eT.lap.len !== 950 || eT.lap.kase !== "beamGt300" || !eB || eB.lap.len !== 750 || eB.lap.kase !== "beamLt300" || !st || st.lap.len !== 950 || st.lap.src !== "table" || !st.lap.short || !/PROJECT 950/.test(st.callout)) p("beam / starter laps from the table " + JSON.stringify([eT && eT.lap, eB && eB.lap, st && st.lap]));
  const tw = MT2.warnings.filter(w => /^Lap /.test(w));
  if (tw.length !== 1 || !/^Lap N24 column.*950 \(lap table\) is shorter than AS 3600 Cl 13\.2\.4 40db gives, 1000/.test(tw[0])) p("table model lap warnings: " + JSON.stringify(tw));
  if (MT2.laps.rows.filter(r => r.lapped).some(r => r.src !== "table")) p("a lapped run did not take the table: " + JSON.stringify(MT2.laps.rows.filter(r => r.lapped && r.src !== "table").map(r => r.what)));
  const S1 = buildSheet(MT2, ["A"], ["BM"]);
  if (!/LAP 750 \(TABLE\)/.test(S1.title[1]) || S1.strip.lapText !== "LAP 750 (TABLE)" || S1.strip.laps !== 600) p("sheet title / strip lap text " + JSON.stringify([S1.title, S1.strip.lapText, S1.strip.laps]));
  // a table that lacks this f'c is an error; a table that lacks a row falls back to the flat lap with a warning; a table at another f'c changes the laps
  const MF = buildModel(Object.assign({}, DEFAULT_CFG, { lapTable: "SLAB 25 40\nN12 600 450\nN16 850 650" }));
  if (!MF.errors.some(e => e === "Lap table: SLAB has no column for f'c 32 MPa (grades 25, 40); add one or change f'c.") || MF.errors.length !== 1) p("missing f'c column: " + MF.errors.join(" | "));
  const MG = buildModel(Object.assign({}, DEFAULT_CFG, { lapTable: "SLAB 32\nN16 750" }));
  if (MG.errors.length || MG.mats.A.lap.len !== 750 || MG.mats.D.lap.len !== 600 || MG.mats.D.lap.src !== "flat" || MG.warnings.filter(w => /^Lap table has no row/.test(w)).length !== 1 || !MG.warnings.some(w => /^Lap table has no row for SLAB N12 \(layer B, layer C, layer D, edge bars top, edge bars bottom\), COLUMN N24 \(column starters: the detail's 950 stays\), BEAM <300 N16 \(EB1 bottom bars\), BEAM >300 N16 \(EB1 top bars\); the flat lap 600 is used where no detail fixes it\.$/.test(w)) || !/flat 600 where it has no row/.test(MG.laps.text)) p("partial table: " + JSON.stringify([MG.errors, MG.warnings.filter(w => /^Lap/.test(w)), MG.laps.text]));
  const M25 = buildModel(Object.assign({}, DEFAULT_CFG, { fc: 25, lapTable: TBL }));
  if (M25.errors.length || M25.mats.A.lap.len !== 850 || M25.mats.B.lap.len !== 600 || M25.mats.A.lap.calc.lap !== 750) p("f'c 25 picks the 25 column: " + JSON.stringify([M25.errors, M25.mats.A.lap.len, M25.mats.B.lap.len, M25.mats.A.lap.calc.lap]));
  // bad lines are reported by line with the reason, the good lines still parse, and the model reports them as errors
  const BAD = parseLapTable("N12 600\nSLAB 25 32\nN12 600 500 450\nN13 600 500\nN16 850 750\nBEAM 25 32\nN16 850 750\nfoo bar\nCOLUMN\nN12 500 600\nN12 500\nSLAB 25\nN12 600\n");
  const want = [[1, /give the case first/], [3, /3 laps for 2 grades \(25, 32\)/], [4, /N13 is not a standard N bar size/], [8, /not a case header or a bar row/], [10, /2 laps for a case with no grades/], [12, /SLAB was already given above/], [13, /1 lap for 2 grades \(25, 32\)/]];   // rows after a repeated header still belong to that case
  const EMPTY = parseLapTable("SLAB 25 32\n# nothing under it\n"), WALL = parseLapTable("WALLS 40\nN12 500\nCOLUMN\nN16 650");
  if (EMPTY.errors.length !== 1 || !/^Lap table line 1 \(SLAB\): no bar rows under this case/.test(EMPTY.errors[0]) || EMPTY.empty) p("empty case: " + JSON.stringify(EMPTY));
  if (WALL.errors.length !== 1 || !/^Lap table line 3 \(COLUMN\): COLUMN was already given above/.test(WALL.errors[0]) || WALL.cases.column.rows[12][0] !== 500 || WALL.cases.column.rows[16][0] !== 650) p("wall = column case: " + JSON.stringify(WALL));
  want.forEach(([ln, re]) => { if (!BAD.errors.some(e => e.indexOf("Lap table line " + ln + " ") === 0 && re.test(e))) p("expected an error on table line " + ln + " matching " + re + "; got " + JSON.stringify(BAD.errors)); });
  if (BAD.errors.length !== want.length || BAD.rows !== 3 || !BAD.cases.beamLt300 || !BAD.cases.beamGt300 || BAD.cases.beamGt300.rows[16][1] !== 750 || BAD.cases.column.rows[12][0] !== 500) p("bad table parse: " + JSON.stringify(BAD));
  const MBAD = buildModel(Object.assign({}, DEFAULT_CFG, { lapTable: "SLAB 32\nN16 abc" }));
  if (!MBAD.errors.some(e => /^Lap table line 2 \(N16 abc\): laps must be whole millimetres/.test(e))) p("model should report table errors: " + MBAD.errors.join(" | "));
  const MFC = buildModel(Object.assign({}, DEFAULT_CFG, { fc: 10 }));
  if (!MFC.errors.some(e => /^Concrete f'c must be 20–100 MPa/.test(e))) p("f'c range: " + MFC.errors.join(" | "));
  if (problems.length) fail(problems.slice(0, 20).join("\n"));
  console.log("  laps: " + cells + " Findings 2.4 cells reproduced, B23 slab / beam / column fit, cd and k3 cases, flat example flagged (3), B23 table drives A 750 / D 500 / EB1 top 950 / starters 950, partial and bad tables reported");
}

// error paths must report, not throw
const bad = buildModel({ callouts: "N13-200 A\nSL82 T\nN12-200 A E-W\nN16-200 A E-W" });
if (!bad.errors.some(e => /N13/.test(e)) || !bad.errors.some(e => /mesh/.test(e)) || !bad.errors.some(e => /already defined/.test(e))) fail("expected errors for bad callouts, got: " + bad.errors.join(" | "));
// layer direction must be stated (#21): no guessed default, the undirected mat is not built, the others still are
const nodir = buildModel({ callouts: "N16-200 A\nN12-200 B N-S\nN12-150 C N-S\nN12-150 D E-W" });
if (!nodir.errors.some(e => /^Line 1 .*E-W or N-S.*no direction is assumed/.test(e))) fail("expected a direction error for line 1, got: " + nodir.errors.join(" | "));
if (nodir.mats.A) fail("mat A was built without a stated direction");
if (!nodir.mats.B || !nodir.mats.D || nodir.mats.B.dir !== "Y" || nodir.mats.D.dir !== "X") fail("directed mats should still be parsed when another line has none");
if (nodir.bars.some(b => b.layer === "A" && b.run.kind === "main")) fail("layer A main bars were built from a guessed direction");
if (nodir.errors.length !== 1) fail("expected exactly one error for the undirected mat, got: " + nodir.errors.join(" | "));
const eachway = buildModel({ callouts: "N12-200 A EW\nN12-200 B N-S\nN12-200 C HORIZONTAL\nN12-200 D TRANS" });
if (!eachway.errors.some(e => /^Line 1 .*each way/.test(e)) || !eachway.errors.some(e => /^Line 3 .*horizontal is a wall or beam direction/.test(e)) || !eachway.errors.some(e => /^Line 4 .*transverse/.test(e))) fail("expected each-way / wall-direction errors, got: " + eachway.errors.join(" | "));
if (eachway.mats.A || eachway.mats.C || eachway.mats.D || !eachway.mats.B) fail("only the N-S mat should survive the each-way / wall-direction lines");
// every mat the model does build carries a stated plan direction
[M, buildModel({ callouts: "N12-200 A E-W\nN12-200 B N-S\nN12-200 C N-S\nN12-200 D E-W" })].forEach(mm => Object.values(mm.mats).forEach(m => { if (m.dir !== m.dirIn || (m.dir !== "X" && m.dir !== "Y")) fail("mat " + m.layer + " direction " + m.dir + " does not match its callout " + m.dirIn); }));
const thin = buildModel({ thickness: 120, cover: 40 });
if (!thin.errors.some(e => /thin|clash/.test(e))) fail("expected a too-thin error, got: " + thin.errors.join(" | "));

console.log("check: OK");
if (process.argv.includes("--marks")) M.marks.forEach(m => console.log("  " + m.mark + "\t" + m.type + m.size + "\t" + m.shape + "\t" + m.len + "\tx" + m.qty + "\t" + m.layer));

function fail(msg) { console.error("check: FAIL\n" + msg); process.exit(1); }
