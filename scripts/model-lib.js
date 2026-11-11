// Loads the headless model block out of index.html (between the MODEL markers) and returns its exports.
// Used by check.js and test-grammar.js. Not part of the page.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadModel() {
  const file = path.join(__dirname, "..", "index.html");
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error("no inline <script> found in index.html");
  const main = scripts[scripts.length - 1];
  new vm.Script(main, { filename: "index.html(inline)" });   // whole script must parse
  const i0 = main.indexOf("// === MODEL START ===");
  const i1 = main.indexOf("// === MODEL END ===");
  if (i0 < 0 || i1 < 0 || i1 < i0) throw new Error("MODEL START / MODEL END markers missing or out of order");
  const model = main.slice(i0, i1);
  const ctx = { console, Math, Map, Set, Array, Object, Number, String, Infinity, isFinite, exports: {} };
  vm.runInNewContext(model + "\n;exports.out = { parseCallout, buildModel, DEFAULT_CFG, lapCalc, parseLapTable, lapLookup, LAP_CASES, LAYERS, LBY, MESH_CODES, BAR_SIZES, bendGeom, pinDia, cutLength, SHAPES, nearestGrid, barAxis, gridSetout, matDirectionError, buildSheet, sheetMarksFor, sheetPrintScale, PRINT_SCALES, PAPER_MM, parseGrids, exampleGeometry };", ctx, { filename: "model" });
  return ctx.exports.out;
}
module.exports = { loadModel };
