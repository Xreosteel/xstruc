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
  });
  runs.forEach(r => {
    if (!r.bars.length) problems.push("run " + r.id + " (" + (r.label || r.callout) + ") has no bars");
    if (r.label && !r.dist && !r.tagPos) problems.push("run " + r.id + " (" + r.label + ") has a label but no tag anchor");
  });
  const qty = marks.reduce((s, m) => s + m.qty, 0);
  if (qty !== sched.length) problems.push("schedule qty " + qty + " != scheduled bars " + sched.length);
  const kgM = marks.reduce((s, m) => s + m.kg, 0);
  if (Math.abs(M.kg - kgM) > 0.5) problems.push("mass mismatch bars " + M.kg.toFixed(1) + " vs marks " + kgM.toFixed(1));
  if (chairs.length < 4) problems.push("too few chairs: " + chairs.length);
  if (problems.length) fail(name + ":\n" + problems.slice(0, 20).join("\n") + (problems.length > 20 ? "\n…and " + (problems.length - 20) + " more" : ""));
  console.log("  " + name + ": bars " + bars.length + " (" + sched.length + " in pour), runs " + runs.length + ", marks " + marks.length + ", chairs " + chairs.length + ", steel " + Math.round(M.kg) + " kg" + (M.warnings.length ? ", warnings " + M.warnings.length : ""));
  return M;
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
