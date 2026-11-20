#!/usr/bin/env node
// The engine bundled into the prototype page (scripts/build.js, esbuild) gives the same output as the engine's own
// TypeScript sources: the example floor's and panel's canonical output hashes match the golden set pinned in
// packages/engine/test/golden/golden.json, and the page puts every engine name in scope (backlog #39).
"use strict";
const vm = require("vm");
const crypto = require("crypto");
const golden = require("../../../packages/engine/test/golden/golden.json");
const { engineBundle } = require("./build");

const { block, names } = engineBundle();
const ctx = { console, out: null };
vm.runInNewContext(block + "\n;out = { E: XStrucEngine, floor: canonicalOutput(buildModel(DEFAULT_CFG)), panel: canonicalOutput(buildModel(PANEL_CFG)) };", ctx);
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const problems = [];
if (sha(ctx.out.floor) !== golden.fixtures["floor-example"].canonical) problems.push("the bundled engine's example floor differs from the golden set");
if (sha(ctx.out.panel) !== golden.fixtures["panel-example"].canonical) problems.push("the bundled engine's example panel differs from the golden set");
if (ctx.out.E.ENGINE_VERSION !== golden.engine) problems.push("bundled ENGINE_VERSION " + ctx.out.E.ENGINE_VERSION + " vs golden " + golden.engine);
// the names the viewer code uses from the engine scope (EXPLODE, esc, fmt, …) must all be there
for (const n of ["buildModel", "buildSheet", "buildSection", "LAYERS", "LBY", "EXPLODE", "esc", "fmt", "EDGES", "STOCK", "boxAt", "txtW", "balconyRows", "STAIR_DEFAULTS", "PANEL_CFG", "DEFAULT_CFG"]) {
  if (!names.includes(n)) problems.push("the page does not get " + n + " from the engine");
}
if (problems.length) { console.error("bundle: FAIL\n  " + problems.join("\n  ")); process.exit(1); }
console.log("bundle: OK (" + names.length + " engine names in the page; example floor and panel match the golden set, engine " + golden.engine + ")");
