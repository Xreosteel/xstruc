#!/usr/bin/env node
// Headless sanity check for the X Struc viewer model.
// Runs the model block of index.html without a browser, builds the default example and a plain slab,
// and asserts the generated bars and schedule are sane. Exit 0 = pass.
"use strict";
const { loadModel } = require("./model-lib");

let lib;
try { lib = loadModel(); } catch (e) { fail(e.message); }
const { buildModel, DEFAULT_CFG, LBY } = lib;

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
  const { bars, runs, GX, GY } = M, lap = +M.cfg.lap;
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

const M = checkModel("default example", DEFAULT_CFG, 800);
checkModel("plain 6 × 4.5 slab", { gridX: [0, 6000], gridY: [0, 4500], callouts: "N12-200 A E-W\nN12-200 B N-S\nN12-200 C N-S\nN12-200 D E-W", features: { beams: false, columns: false, drop: false, step: false, balcony: false, openings: false, extras: false, edges: true } }, 60);
checkModel("no features at all", { gridX: "0, 8000", gridY: "0, 7000", features: { beams: false, columns: false, drop: false, step: false, balcony: false, openings: false, extras: false, edges: false } }, 60);
checkModel("two mats only", { callouts: "N16-200 A E-W\nN12-150 D E-W" }, 300);
checkModel("big grid", { gridX: [0, 6000, 12000, 18000, 24000], gridY: [0, 6000, 12000, 18000] }, 1500);

// error paths must report, not throw
const bad = buildModel({ callouts: "N13-200 A\nSL82 T\nN12-200 A\nN16-200 A" });
if (!bad.errors.some(e => /N13/.test(e)) || !bad.errors.some(e => /mesh/.test(e)) || !bad.errors.some(e => /already defined/.test(e))) fail("expected errors for bad callouts, got: " + bad.errors.join(" | "));
const thin = buildModel({ thickness: 120, cover: 40 });
if (!thin.errors.some(e => /thin|clash/.test(e))) fail("expected a too-thin error, got: " + thin.errors.join(" | "));

console.log("check: OK");
if (process.argv.includes("--marks")) M.marks.forEach(m => console.log("  " + m.mark + "\t" + m.type + m.size + "\t" + m.shape + "\t" + m.len + "\tx" + m.qty + "\t" + m.layer));

function fail(msg) { console.error("check: FAIL\n" + msg); process.exit(1); }
