// Golden set: the engine's full output for each fixture (canonical output, every layer's placing sheet, sections) is
// pinned by hash in golden/golden.json, so moving or retyping code cannot change a single bar unnoticed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as E from "../src/index.ts";
import { FIXTURES, SECTIONS } from "./golden/fixtures.js";

const FILE = new URL("./golden/golden.json", import.meta.url);
const sha = s => createHash("sha256").update(s).digest("hex");
// JSON with repeated objects (a run inside its bars, a bar inside its run) written once and then as "[seen]"
function stable(v) {
  const seen = new WeakSet();
  return JSON.stringify(v, (k, x) => {
    if (typeof x === "function") return "[fn]";
    if (x && typeof x === "object") { if (seen.has(x)) return "[seen]"; seen.add(x); }
    if (typeof x === "number" && !Number.isInteger(x)) return Math.round(x * 1e6) / 1e6;
    return x;
  });
}

function snapshot(cfg) {
  const M = E.buildModel(cfg);
  const order = M.ORDER || [];
  // a model with errors is not drawn (the viewer keeps the last good one), so only its errors are pinned
  const ok = !M.errors.length && M.kind !== "pit";   // a pit has no placing sheets or sections yet
  const sheets = ok ? order.map((l, i) => stable(E.buildSheet(M, [l], order.slice(0, i)))).concat(stable(E.buildSheet(M, order, []))) : [];
  const cuts = ok ? (M.kind === "panel" ? SECTIONS.panel : SECTIONS.floor).map(s => stable(E.buildSection(M, s))) : [];
  return {
    bars: (M.bars || []).filter(b => !b.existing).length, marks: (M.marks || []).length, kg: Math.round(M.kg || 0), errors: M.errors, warnings: M.warnings.length,
    canonical: sha(E.canonicalOutput(M)), model: sha(stable({ bars: M.bars, runs: M.runs, marks: M.marks, chairs: M.chairs, errors: M.errors, warnings: M.warnings })),
    sheets: sha(sheets.join("\n")), sections: sha(cuts.join("\n"))
  };
}

const now = Object.fromEntries(Object.entries(FIXTURES).map(([k, cfg]) => [k, snapshot(cfg)]));

if (process.env.UPDATE_GOLDEN || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify({ engine: E.ENGINE_VERSION, note: "Pinned engine output; see test/golden/fixtures.js", fixtures: now }, null, 2) + "\n");
}
const pinned = JSON.parse(readFileSync(FILE, "utf8"));

for (const [name, snap] of Object.entries(now)) {
  test("golden: " + name, () => {
    assert.ok(pinned.fixtures[name], name + " is not pinned yet (run with UPDATE_GOLDEN=1)");
    assert.deepEqual(snap, pinned.fixtures[name]);
  });
}
test("golden: the same engine version as pinned", () => assert.equal(E.ENGINE_VERSION, pinned.engine));
