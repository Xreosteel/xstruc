#!/usr/bin/env node
// Bending-geometry tests. Expected values are the AS 3600-derived table in research/01-bar-bending-shape-codes.md
// (pins per Cl 17.2.3.2, hooks and cogs per Cl 13.1.2.7, cross-checked against InfraBuild's 2023 guide pp. 37–38).
"use strict";
const { loadModel } = require("./model-lib");
const { bendGeom, pinDia, cutLength, buildModel, DEFAULT_CFG } = loadModel();

const failures = [];
function eq(name, got, exp, tol) { if (Math.abs(got - exp) > (tol || 0.5)) failures.push(name + ": expected " + exp + ", got " + (Math.round(got * 10) / 10)); }

// [type, size, role, pin, e, hook180, hook135, cogLeg, cogDepth, hookWidth] from the research table
[
  ["R", 6, "fitment", 18, 70, 108, 98, 89, 104, 30],
  ["R", 10, "fitment", 30, 70, 133, 117, 101, 126, 50],
  ["N", 10, "fitment", 40, 70, 149, 129, 109, 139, 60],
  ["N", 10, "main", 50, 70, 164, 141, 117, 152, 70],
  ["N", 12, "fitment", 48, 70, 164, 141, 117, 153, 72],
  ["N", 12, "main", 60, 70, 183, 155, 127, 169, 84],
  ["N", 16, "fitment", 64, 70, 196, 164, 133, 181, 96],
  ["N", 16, "main", 80, 70, 221, 183, 145, 201, 112],
  ["N", 20, "fitment", 80, 80, 237, 198, 159, 219, 120],
  ["N", 20, "main", 100, 80, 268, 221, 174, 244, 140],
  ["N", 24, "fitment", 96, 96, 284, 237, 190, 262, 144],
  ["N", 24, "main", 120, 96, 322, 266, 209, 293, 168],
  ["N", 28, "main", 140, 112, 376, 310, 244, 342, 196],
  ["N", 32, "main", 160, 128, 430, 354, 279, 391, 224],
  ["N", 36, "main", 180, 144, 483, 398, 314, 440, 252],
  ["N", 40, "main", 200, 160, 537, 443, 348, 488, 280]
].forEach(r => {
  const g = bendGeom(r[0], r[1], r[2]), n = r[0] + r[1] + " " + r[2];
  eq(n + " pin", g.dp, r[3]); eq(n + " e", g.e, r[4]); eq(n + " hook180", g.hook180, r[5], 1); eq(n + " hook135", g.hook135, r[6], 1);
  eq(n + " cogLeg", g.cogLeg, r[7], 1); eq(n + " cogDepth", g.cogDepth, r[8], 1); eq(n + " hookWidth", g.hookWidth, r[9]);
});
eq("pinDia R10 fitment", pinDia("R", 10, "fitment"), 30); eq("pinDia N12 fitment", pinDia("N", 12, "fitment"), 48); eq("pinDia N12 main", pinDia("N", 12, "main"), 60);

// cut lengths from centreline polylines
const g12 = bendGeom("N", 12, "main");
eq("straight 9440", cutLength([[0, 0, 0], [9440, 0, 0]], g12, 0), 9440);
// one 90° bend: deduction = 2rc·tan45 − rc·π/2 = rc(2 − π/2) = 0.4292·rc; rc = 36 → 15.45
eq("L 1000+100 cut", cutLength([[0, 0, 100], [0, 0, 0], [1000, 0, 0]], g12, 0), 1100 - 0.4292 * 36, 0.1);
// 45° bend: 2rc·tan22.5 − rc·π/4
eq("45° bend", cutLength([[0, 0, 0], [1000, 0, 0], [1000 + 707.107, 707.107, 0]], g12, 0), 2000 - (2 * 36 * Math.tan(Math.PI / 8) - 36 * Math.PI / 4), 0.1);
// closed N12 tie 300 × 500 centreline (fitment pin 48, rc 30): perimeter 1600, 4 corners, two 135° hooks
const gf = bendGeom("N", 12, "fitment");
const tie = [[0, 0, 0], [300, 0, 0], [300, 0, 500], [0, 0, 500], [0, 0, 0]];
eq("tie cut", cutLength(tie, gf, 2), 1600 - 3 * (2 * 30 - 30 * Math.PI / 2) + 2 * (gf.hook135 - 30), 0.1);
// collinear points add no deduction
eq("collinear", cutLength([[0, 0, 0], [500, 0, 0], [1000, 0, 0]], g12, 0), 1000);

// schedule integration: every bar has a code and dims; cogged slab bars are flagged in a 200 slab, not in a 300 slab
const M = buildModel(DEFAULT_CFG);
M.sched.forEach(b => { if (!b.code || !b.dimStr) failures.push("bar " + b.id + " has no shape code/dims"); if (b.len < b.geomLen - 200) failures.push("bar " + b.id + " cut length far below drawn length"); });
const cogged = M.sched.filter(b => b.shape === "cogged one end" && b.layer === "D");
if (!cogged.length || !cogged[0].flags.length) failures.push("expected top-bar cogs in a 200 slab to be flagged as shorter than standard");
if (!M.warnings.some(w => /shorter than the AS 3600 standard cog/.test(w))) failures.push("expected a model warning about short cogs");
const thick = buildModel(Object.assign({}, DEFAULT_CFG, { thickness: 300 }));
const coggedThick = thick.sched.filter(b => b.shape === "cogged one end" && b.layer === "D");
if (coggedThick.length && coggedThick[0].flags.length) failures.push("did not expect short-cog flags in a 300 slab");
const lig = M.sched.find(b => b.lig);
if (!lig || lig.code !== "T" || lig.geom.dp !== 48) failures.push("beam lig should be shape T on a 48 pin, got " + (lig && lig.code + "/" + lig.geom.dp));
const z = M.sched.find(b => b.shape === "Z-bar");
if (!z || z.code !== "CC" || z.dims.length !== 4 || z.dims[1][1] < 420) failures.push("Z-bar should be CC with a ≥420 crank, got " + (z && z.dimStr));

if (failures.length) { console.error("shapes: FAIL " + failures.length + "\n  " + failures.join("\n  ")); process.exit(1); }
console.log("shapes: OK (" + (16 * 7 + 3 + 5 + 6) + " assertions)");
