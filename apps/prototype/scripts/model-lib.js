// Loads the engine (packages/engine/src/engine.js, the block between the MODEL markers) headlessly and returns its
// exports, after checking that the built prototype page's whole inline script still parses. Used by the tests.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadModel() {
  const html = require("./build").page();   // the prototype page with the engine inlined
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error("no inline <script> found in index.html");
  const main = scripts[scripts.length - 1];
  new vm.Script(main, { filename: "index.html(inline)" });   // whole script must parse
  const model = require("./build").engineBlock();
  const ctx = { console, Math, Map, Set, Array, Object, Number, String, Infinity, isFinite, exports: {} };
  vm.runInNewContext(model + "\n;exports.out = { parseCallout, buildModel, DEFAULT_CFG, lapCalc, parseLapTable, lapLookup, LAP_CASES, LAYERS, LBY, MESH_CODES, BAR_SIZES, bendGeom, pinDia, cutLength, SHAPES, nearestGrid, barAxis, gridSetout, matDirectionError, buildSheet, sheetMarksFor, sheetPrintScale, PRINT_SCALES, PAPER_MM, parseGrids, exampleGeometry, buildPanel, PANEL_CFG, MESH, meshStock, MESH_LAP, wireKgm, INSERT_CAT, INSERT_RULES, insertWll, panelTag, PANEL_TABLE_COLS, COVER_TABLE, COVER_FC, coverRequired, MIN_REO, barAreaPerM, panelOutline, buildSection, SECTION_LOOK };", ctx, { filename: "model" });
  return ctx.exports.out;
}
module.exports = { loadModel };
