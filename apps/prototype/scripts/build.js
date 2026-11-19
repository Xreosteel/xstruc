#!/usr/bin/env node
// Builds the prototype page (apps/prototype/dist/index.html): index.html here is a template whose engine line is
// replaced by the engine block from packages/engine/src/engine.js (MODEL START … MODEL END, verbatim), so the page
// stays one self-contained file for the claude.ai artifact and GitHub Pages while the engine has one home.
//   node scripts/build.js            writes dist/index.html
//   require("./build").page()        the page text, for the tests
"use strict";
const fs = require("fs");
const path = require("path");

const HERE = path.join(__dirname, "..");
const ENGINE = path.join(HERE, "..", "..", "packages", "engine", "src", "engine.js");
const SLOT = /^ {2}\/\/ @@ENGINE packages\/engine\/src\/engine\.js.*$/m;

// the block the page carries: from the MODEL START line to the MODEL END line, inclusive
function engineBlock() {
  const src = fs.readFileSync(ENGINE, "utf8");
  const lines = src.split("\n");
  const i0 = lines.findIndex(l => l.startsWith("  // === MODEL START ==="));
  const i1 = lines.findIndex(l => l.startsWith("  // === MODEL END ==="));
  if (i0 < 0 || i1 < i0) throw new Error("packages/engine/src/engine.js lost its MODEL START / MODEL END lines");
  return lines.slice(i0, i1 + 1).join("\n");
}

function page() {
  const tmpl = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
  if (!SLOT.test(tmpl)) throw new Error("apps/prototype/index.html lost its @@ENGINE line");
  const block = engineBlock();
  return tmpl.replace(SLOT, () => block);
}

const DIST = path.join(HERE, "dist", "index.html");
function build() {
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  const html = page();
  fs.writeFileSync(DIST, html);
  return { file: DIST, bytes: Buffer.byteLength(html) };
}

module.exports = { page, engineBlock, build, DIST, ENGINE };

if (require.main === module) {
  const r = build();
  console.log("prototype built: " + path.relative(process.cwd(), r.file) + " (" + r.bytes + " bytes, engine inlined)");
}
