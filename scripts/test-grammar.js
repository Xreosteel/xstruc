#!/usr/bin/env node
// Callout grammar tests. Cases come from the notation reference (Newcastle B23 notes, residential raft sets, common practice).
// Each case: [input, options, expected partial object]. Only listed keys are compared.
"use strict";
const { loadModel } = require("./model-lib");
const { parseCallout } = loadModel();

const TB = { scheme: "TB" }, AB = { scheme: "ABCD" };
const CASES = [
  // core bar callouts (B23 note R3: count, type, size, spacing, layer)
  ["17N16-250 T", TB, { kind: "bar", count: 17, type: "N", size: 16, spacing: 250, position: "T" }],
  ["N12-200", TB, { kind: "bar", count: null, type: "N", size: 12, spacing: 200, position: null }],
  ["N16-200 BOTH WAYS TOP AND BOTTOM", TB, { kind: "bar", size: 16, spacing: 200, position: "TB", direction: "EW" }],
  ["N12-200 T&B EW", TB, { kind: "bar", size: 12, spacing: 200, position: "TB", direction: "EW" }],
  ["N12-200 EW T&B", TB, { position: "TB", direction: "EW" }],
  ["N12 @ 300 CTS", TB, { kind: "bar", size: 12, spacing: 300 }],
  ["N12@300", TB, { size: 12, spacing: 300 }],
  ["N12 AT 200 CENTRES", TB, { size: 12, spacing: 200 }],
  ["N12 - 200 CRS TOP", TB, { size: 12, spacing: 200, position: "T" }],
  ["N 16-150 B", TB, { type: "N", size: 16, spacing: 150, position: "B" }],
  ["N16-200 BTM", TB, { position: "B" }],
  ["N16-200 BOT", TB, { position: "B" }],
  ["N16-200 BOTTOM", TB, { position: "B" }],
  ["N20-150 T1", TB, { size: 20, spacing: 150, layer: "T1", position: "T" }],
  ["N12-250 B2", TB, { layer: "B2", position: "B" }],
  ["N12-200 EF", TB, { position: "EF" }],
  ["N12-200 NF", TB, { position: "NF" }],
  ["N12-200 CENTRAL", TB, { position: "C" }],
  ["N12-200 E-W", TB, { direction: "X" }],
  ["N12-200 N-S", TB, { direction: "Y" }],
  ["N12-200 NS", TB, { direction: "Y" }],
  ["N12-200 EACH WAY", TB, { direction: "EW" }],
  ["N12-200 HORIZONTAL BACK FACE", TB, { direction: "H", position: null }],
  ["N16-400 VERT EF", TB, { direction: "V", position: "EF" }],
  // counted bars, no spacing
  ["2-N16 TRIMMERS", TB, { kind: "bar", count: 2, size: 16, spacing: null, role: "trim" }],
  ["2N16 TRIM EACH SIDE", TB, { count: 2, role: "trim", notes: ["EACH SIDE"] }],
  ["3N12 TOP", TB, { count: 3, size: 12, position: "T" }],
  ["3-N12'S WITH R6 LIGS @ 300CTS", TB, { count: 3, type: "N", size: 12, role: "lig" }],
  ["4N20 (3 PER FACE)", TB, { count: 4, size: 20 }],
  ["8N24", TB, { count: 8, type: "N", size: 24 }],
  ["3 NO. N16", TB, { count: 3, size: 16 }],
  ["6N16 BARS BTM", TB, { count: 6, size: 16, position: "B" }],
  ["1-N16 TOP EACH SIDE OF OPENING", TB, { count: 1, position: "T", notes: ["EACH SIDE OPENING"] }],
  // additional / extra bars with lengths
  ["ADD N16-200 T1 x 3000", TB, { role: "extra", size: 16, spacing: 200, layer: "T1", length: 3000 }],
  ["ADDITIONAL N16-200 T × 3000 OVER COLUMNS", TB, { role: "extra", spacing: 200, position: "T", length: 3000 }],
  ["EXTRA 2-N12 x 1200 DIAG", TB, { role: "extra", count: 2, size: 12, length: 1200, spacing: null }],
  ["N12 x 1200 LONG AT WIRE CENTRES", TB, { size: 12, length: 1200 }],
  ["N20 STARTERS x 900 LONG", TB, { role: "starter", size: 20, length: 900 }],
  ["1-N20 BAR x 600 LONG", TB, { count: 1, size: 20, length: 600 }],
  ["N12-400 CENTRES (SPLICE 450)", TB, { size: 12, spacing: 400 }],
  // ligatures and ties
  ["R10-200", TB, { type: "R", size: 10, spacing: 200 }],
  ["N12-200 TIES", TB, { role: "lig", spacing: 200 }],
  ["N12 LIGS AT 200 CTS", TB, { role: "lig", size: 12, spacing: 200 }],
  ["R6 LIGS @ 300", TB, { type: "R", size: 6, role: "lig", spacing: 300 }],
  ["N12-250 TIES 3 SETS", TB, { role: "lig", spacing: 250 }],
  // mesh
  ["SL82 T", TB, { kind: "mesh", mesh: "SL82", type: "SL", size: 82, position: "T" }],
  ["SL92 MESH TOP", TB, { kind: "mesh", mesh: "SL92", position: "T" }],
  ["SL82 MESH TOP AND BOTTOM", TB, { kind: "mesh", position: "TB" }],
  ["RL918 B", TB, { kind: "mesh", mesh: "RL918", position: "B" }],
  ["3-L11TM BTM", TB, { kind: "mesh", count: 3, mesh: "L11TM", position: "B" }],
  ["2 LAYERS SL82", TB, { kind: "mesh", count: 2, mesh: "SL82" }],
  ["SL72 MESH TOP, 20 COVER", TB, { kind: "mesh", mesh: "SL72", position: "T" }],
  // thickness lines
  ["200 THK", TB, { kind: "thickness", value: 200 }],
  ["180 THICK SLAB", TB, { kind: "thickness", value: 180 }],
  // ABCD scheme (X Struc inputs panel)
  ["N16-200 A E-W", AB, { kind: "bar", size: 16, spacing: 200, layer: "A", position: "B", direction: "X" }],
  ["N12-150 C N-S", AB, { layer: "C", position: "T", direction: "Y" }],
  ["n12-150 d e-w", AB, { layer: "D", position: "T", direction: "X" }],
  ["N12-200 B", AB, { layer: "B", position: "B" }],
  ["N12-200 B", TB, { layer: null, position: "B" }],
  // errors
  ["N13-200 T", TB, { kind: "bar", error: "N13 is not a standard N bar size" }],
  ["REFER DETAIL 5/S-301", TB, { kind: null, error: "no bar or mesh designation found (expected something like N12-200 T)" }],
  ["", TB, { error: "empty line" }]
];

let pass = 0, failures = [];
CASES.forEach(([input, opts, exp]) => {
  const got = parseCallout(input, opts);
  const bad = Object.keys(exp).filter(k => JSON.stringify(got[k]) !== JSON.stringify(exp[k]));
  if (bad.length) failures.push("  " + JSON.stringify(input) + "\n    " + bad.map(k => k + ": expected " + JSON.stringify(exp[k]) + ", got " + JSON.stringify(got[k])).join("\n    "));
  else pass++;
});
if (failures.length) { console.error("grammar: FAIL " + failures.length + " of " + CASES.length + "\n" + failures.join("\n")); process.exit(1); }
console.log("grammar: OK (" + pass + " cases)");
