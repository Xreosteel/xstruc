#!/usr/bin/env node
// Headless sanity check for the X Struc viewer model.
// Extracts the code between "// === MODEL START ===" and "// === MODEL END ===" in index.html,
// runs it without a browser, and asserts the generated bars and schedule are sane.
// Exit code 0 = pass. Any failure prints the reason and exits 1.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(file, "utf8");

// 1. Whole script must parse.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) fail("no inline <script> found in index.html");
try { new vm.Script(scripts[scripts.length - 1], { filename: "index.html(inline)" }); }
catch (e) { fail("inline script does not parse: " + e.message); }

// 2. Model block must run headlessly.
const main = scripts[scripts.length - 1];
const i0 = main.indexOf("// === MODEL START ===");
const i1 = main.indexOf("// === MODEL END ===");
if (i0 < 0 || i1 < 0 || i1 < i0) fail("MODEL START / MODEL END markers missing or out of order");
const model = main.slice(i0, i1);
const ctx = { console, Math, Map, Set, Array, Object, Number, String, Infinity, isFinite, exports: {} };
const src = model + "\n;exports.out = { bars, runs, chairs, sched, marks, LAYERS, LBY };";
try { vm.runInNewContext(src, ctx, { filename: "model" }); }
catch (e) { fail("model block threw: " + e.stack); }
const { bars, runs, chairs, sched, marks, LBY } = ctx.exports.out;

// 3. Invariants.
const problems = [];
if (bars.length < 100) problems.push("too few bars: " + bars.length);
bars.forEach(b => {
  if (!isFinite(b.len) || b.len <= 0) problems.push("bar " + b.id + " has bad length " + b.len);
  if (!isFinite(b.kg) || b.kg <= 0) problems.push("bar " + b.id + " has bad mass " + b.kg);
  if (!b.pts || b.pts.length < 2) problems.push("bar " + b.id + " has <2 points");
  else b.pts.forEach((p, i) => { if (p.length !== 3 || p.some(v => !isFinite(v))) problems.push("bar " + b.id + " point " + i + " invalid"); });
  if (!LBY[b.layer]) problems.push("bar " + b.id + " has unknown layer " + b.layer);
  if (!b.existing && !b.mark) problems.push("bar " + b.id + " in this pour has no mark");
});
runs.forEach(r => { if (!r.bars.length) problems.push("run " + r.id + " (" + (r.label || r.callout) + ") has no bars"); });
const qty = marks.reduce((s, m) => s + m.qty, 0);
if (qty !== sched.length) problems.push("schedule qty " + qty + " != scheduled bars " + sched.length);
const kg = sched.reduce((s, b) => s + b.kg, 0);
const kgM = marks.reduce((s, m) => s + m.kg, 0);
if (Math.abs(kg - kgM) > 0.5) problems.push("mass mismatch bars " + kg.toFixed(1) + " vs marks " + kgM.toFixed(1));
if (chairs.length < 10) problems.push("too few chairs: " + chairs.length);

if (problems.length) fail(problems.slice(0, 20).join("\n") + (problems.length > 20 ? "\n…and " + (problems.length - 20) + " more" : ""));

console.log("check: OK");
console.log("  bars " + bars.length + " (" + sched.length + " in this pour), runs " + runs.length + ", marks " + marks.length + ", chairs " + chairs.length + ", steel " + Math.round(kg) + " kg");
if (process.argv.includes("--marks")) marks.forEach(m => console.log("  " + m.mark + "\t" + m.type + m.size + "\t" + m.shape + "\t" + m.len + "\tx" + m.qty + "\t" + m.layer));

function fail(msg) { console.error("check: FAIL\n" + msg); process.exit(1); }
