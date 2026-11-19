// Package-level tests for @xstruc/engine: it loads as an ES module, builds the examples, is deterministic, keeps to
// its no-clock / no-randomness rule and its typed API compiles. The engine's own invariants are checked by the
// prototype's suite (apps/prototype/scripts/check.js and the rest), which runs the same source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as E from "../src/index.js";

const src = readFileSync(new URL("../src/engine.js", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("builds the example floor and panel", () => {
  const F = E.buildModel(E.DEFAULT_CFG);
  assert.deepEqual(F.errors, []);
  assert.ok(F.bars.filter(b => !b.existing).length > 1000, "the example floor has its bars");
  assert.ok(F.marks.length > 50 && F.kg > 4000);
  const P = E.buildModel(E.PANEL_CFG);
  assert.equal(P.kind, "panel");
  assert.deepEqual(P.errors, []);
  assert.ok(P.bars.length > 50 && (P.meshPieces || []).length >= 1);
});

test("bad inputs come back as errors, not exceptions", () => {
  const M = E.buildModel({ ...E.DEFAULT_CFG, callouts: "N16-200 A" });
  assert.ok(M.errors.some(e => /E-W or N-S/.test(e)), "a mat with no direction is an error");
});

test("deterministic: the same inputs give the same canonical output", () => {
  for (const cfg of [E.DEFAULT_CFG, E.PANEL_CFG]) {
    const a = E.canonicalOutput(E.buildModel(cfg));
    const b = E.canonicalOutput(E.buildModel(JSON.parse(JSON.stringify(cfg))));
    assert.equal(a, b);
    assert.equal(JSON.parse(a).engine, E.ENGINE_VERSION);
  }
});

test("deterministic across separate realms (fresh globals, as in a Web Worker or on the server)", () => {
  const block = src.slice(src.indexOf("  // === MODEL START ==="), src.indexOf("\nexport {"));
  const ctx = { out: null };
  vm.runInNewContext(block + "\n;out = buildModel(DEFAULT_CFG);", ctx);
  const here = E.buildModel(E.DEFAULT_CFG);
  assert.equal(ctx.out.marks.length, here.marks.length);
  assert.equal(JSON.stringify(ctx.out.marks), JSON.stringify(here.marks));
});

test("keeps its rules: no clock, no randomness, no DOM, no three.js, no network", () => {
  for (const bad of [/Math\.random/, /new Date\b/, /Date\.now/, /\bdocument\./, /\bwindow\./, /\bTHREE\./, /\bfetch\(/, /XMLHttpRequest/, /\brequire\(/]) {
    assert.ok(!bad.test(src), "engine.js must not use " + bad);
  }
  assert.ok(!/toLocale\w*\((?!"en-AU")/.test(src), "any locale formatting is pinned to en-AU");
});

test("version matches package.json", () => {
  assert.equal(E.ENGINE_VERSION, pkg.version);
});
