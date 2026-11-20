#!/usr/bin/env node
// Builds the prototype page (apps/prototype/dist/index.html): index.html here is a template whose engine line is
// replaced by the engine, bundled from packages/engine (TypeScript modules) with esbuild into one script that defines
// XStrucEngine, followed by one line that puts every engine name in the page's scope, as the inline engine used to be.
// The page stays one self-contained file for the claude.ai artifact and GitHub Pages; the engine has one home.
//   node scripts/build.js            writes dist/index.html
//   require("./build").page()        the page text, for the tests
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HERE = path.join(__dirname, "..");
const ENGINE = path.join(HERE, "..", "..", "packages", "engine", "src", "index.ts");
const SLOT = /^ {2}\/\/ @@ENGINE packages\/engine.*$/m;

let cached = null;
// the block the page carries, between MODEL START and MODEL END, and the names it puts in scope
function engineBundle() {
  if (cached) return cached;
  const esbuild = require("esbuild");
  const out = esbuild.buildSync({
    entryPoints: [ENGINE], bundle: true, write: false, format: "iife", globalName: "XStrucEngine",
    platform: "neutral", target: "es2020", charset: "utf8", legalComments: "none", logLevel: "silent"
  });
  const code = out.outputFiles[0].text.trimEnd();
  const names = Object.keys(new vm.Script(code + "\n;XStrucEngine").runInNewContext({ console })).sort();
  const block = [
    "  // === MODEL START === (the engine, bundled from packages/engine by scripts/build.js: edit it there, not here)",
    code,
    "  const { " + names.join(", ") + " } = XStrucEngine;",
    "  // === MODEL END ==="
  ].join("\n");
  cached = { block, names, bytes: Buffer.byteLength(code) };
  return cached;
}
const engineBlock = () => engineBundle().block;

function page() {
  const tmpl = fs.readFileSync(path.join(HERE, "index.html"), "utf8");
  if (!SLOT.test(tmpl)) throw new Error("apps/prototype/index.html lost its @@ENGINE line");
  return tmpl.replace(SLOT, () => engineBlock());
}

const DIST = path.join(HERE, "dist", "index.html");
function build() {
  fs.mkdirSync(path.dirname(DIST), { recursive: true });
  const html = page();
  fs.writeFileSync(DIST, html);
  return { file: DIST, bytes: Buffer.byteLength(html) };
}

module.exports = { page, engineBlock, engineBundle, build, DIST, ENGINE };

if (require.main === module) {
  const r = build();
  console.log("prototype built: " + path.relative(process.cwd(), r.file) + " (" + r.bytes + " bytes; engine bundled: " + engineBundle().names.length + " names, " + engineBundle().bytes + " bytes)");
}
