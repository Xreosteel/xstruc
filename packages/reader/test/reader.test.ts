// Tests of the drawing reader against drawings written by a real CAD library (test/fixtures/make.py, ezdxf).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildModel, canonicalOutput, DEFAULT_CFG, exampleGeometry } from "@xstruc/engine";
import { decodeDxf, plainMtext, readDxf, readPlan, type Sheet } from "../src/index.ts";

const fixture = (name: string): Sheet => readDxf(decodeDxf(readFileSync(new URL("./fixtures/" + name, import.meta.url))));

test("DXF reader: entity kinds, blocks, text codes, units", () => {
  const s = fixture("entities.dxf");
  assert.equal(s.units.name, "millimetres");
  assert.equal(s.units.inferred, false);
  const kinds = s.entities.map(e => e.kind).sort();
  assert.deepEqual([...new Set(kinds)], ["arc", "circle", "dim", "hatch", "leader", "line", "pline", "text"]);
  // a bulge of 1 is a half circle through (500, -500)
  const pl = s.entities.find(e => e.kind === "pline");
  assert.ok(pl && pl.kind === "pline" && pl.closed && pl.pts.some(p => Math.abs(p[0] - 500) < 1 && Math.abs(p[1] + 500) < 1));
  // MTEXT codes stripped, %%c read, a block's attribute and circle placed by the INSERT (rotated 30, scaled 2)
  const texts = s.entities.filter(e => e.kind === "text").map(e => (e.kind === "text" ? e.text : ""));
  assert.ok(texts.includes("N16-200\nB1 E-W UNDER 1/2"), texts.join(" | "));
  assert.ok(texts.includes("N12-200 T1 Ø"));
  const attrib = s.entities.find(e => e.kind === "text" && e.src === "ATTRIB");
  assert.ok(attrib && attrib.kind === "text" && attrib.text === "A" && Math.abs(attrib.rot - 30) < 0.01 && Math.abs(attrib.h - 600) < 0.01);
  const circles = s.entities.filter(e => e.kind === "circle");
  assert.ok(circles.some(c => c.kind === "circle" && Math.abs(c.r - 800) < 0.01 && c.blocks[0] === "BUB"));
  // a block inserted mirrored (extrusion 0,0,-1) lands at -x
  assert.ok(circles.some(c => c.kind === "circle" && Math.abs(c.c[0] + 7000) < 0.01));
  const dim = s.entities.find(e => e.kind === "dim");
  assert.ok(dim && dim.kind === "dim" && dim.measured === 4500 && dim.text === "4500");
  assert.match(s.warnings.join(" "), /paper space/);
  assert.match(s.warnings.join(" "), /ELLIPSE/);
});

test("MTEXT formatting is removed but escaped braces and backslashes stay", () => {
  assert.equal(plainMtext("{\\fArial|b1|i0;N12}\\P\\H2.5x;T1 \\C1;E-W"), "N12\nT1 E-W");
  assert.equal(plainMtext("A\\\\B \\{x\\}"), "A\\B {x}");
});

// the Level 1 example as the engine builds it from typed inputs, with what the reader does not take from a
// drawing yet (beams, columns, extras, edge bars, the stair) switched off
const expected = () => {
  const g = exampleGeometry(DEFAULT_CFG);
  return {
    gridX: DEFAULT_CFG.gridX, gridY: DEFAULT_CFG.gridY, overhang: 250, thickness: 200, cover: 30, fc: 32, lap: 600,
    callouts: DEFAULT_CFG.callouts,
    features: { beams: false, columns: false, drop: true, step: true, balcony: true, openings: true, extras: false, edges: false, stair: false },
    scheme: "ABCD", openings: g.openings, setdowns: g.setdowns, balconies: g.balconies, step: g.step
  };
};

test("Level 1 plan: read step by step into exactly the floor that was drawn", () => {
  const r = readPlan(fixture("level1.dxf"));
  assert.deepEqual(r.steps.map(s => s.title), ["Open the drawing", "Find the grid lines", "Find the slab edge", "Find openings, set-downs and steps", "Read the general notes", "Read the reinforcement callouts", "Check", "Build"]);
  assert.ok(r.input, JSON.stringify(r.issues));
  const { name, gridLabels, ...got } = r.input as Record<string, unknown>;
  assert.equal(name, "LEVEL 1 SLAB");
  assert.deepEqual(gridLabels, { across: ["1", "2", "3", "4"], up: ["A", "B", "C"] });
  assert.deepEqual(got, expected());
  assert.deepEqual(r.missing, []);
  assert.equal(r.issues.filter(i => i.level === "error").length, 0);
  assert.deepEqual(r.issues.map(i => i.text), ["\"2-N16 TRIMMERS T&B\" (trim bars): read, but the engine adds trim bars by its own details for now, not from the drawing."]);
  assert.deepEqual(r.origin, [100000, 50000]);
  // what was found, with the entities it came from
  const count = (k: string) => r.found.filter(f => f.kind === k).length;
  assert.equal(count("grid"), 7); assert.equal(count("column"), 12); assert.equal(count("opening"), 2); assert.equal(count("setdown"), 1);
  assert.equal(count("step"), 1); assert.equal(count("balcony"), 1); assert.equal(count("extent"), 4);
  assert.ok(r.found.every(f => f.ids.length > 0));
  // the engine builds it, and the 3D is the same as typing the example in by hand
  assert.ok(r.engine && r.engine.errors.length === 0 && r.engine.bars > 1000);
  const fromDrawing = buildModel(r.input!), byHand = buildModel({ ...expected(), name: "LEVEL 1 SLAB" } as never);
  assert.equal(canonicalOutput(fromDrawing), canonicalOutput(byHand));
});

test("the reader does not guess: missing notes, layers and directions are asked or refused", () => {
  const r = readPlan(fixture("problems.dxf"));
  assert.equal(r.input, null);
  assert.deepEqual(r.missing, [{ key: "thickness", label: "Slab thickness", unit: "mm" }, { key: "cover", label: "Cover", unit: "mm", options: [30, 40] }]);
  const errs = r.issues.filter(i => i.level === "error").map(i => i.text);
  assert.ok(errs.some(e => /"N16-200 B1": say which way this mat runs/.test(e)));
  assert.ok(errs.some(e => /"N12-200 B EW": "each way" covers two layers/.test(e)));
  assert.equal(errs.filter(e => /say which top layer, T1 \(outer\) or T2 \(inner\)/.test(e)).length, 2);
  assert.ok(errs.some(e => /"N16-200 T1 N-S" covers only part of the slab \(22 %/.test(e)));
  // a beam's dashed edge through a callout is not its distribution line
  assert.ok(!errs.some(e => /N16-200 T1 N-S.*9[0-9] %/.test(e)));
  // typing the values in does not unlock a drawing whose callouts are wrong
  const again = readPlan(fixture("problems.dxf"), { values: { thickness: 200, cover: 30 } });
  assert.equal(again.input, null);
  assert.deepEqual(again.missing, []);
  assert.equal(again.steps.find(s => s.n === 8)!.lines[0], "Not built: fix the errors above first.");
});

test("values typed in for what the notes do not say build the floor", () => {
  const s = fixture("level1.dxf");
  const noNotes: Sheet = { ...s, entities: s.entities.filter(e => !(e.kind === "text" && /GENERAL NOTES/.test(e.text))) };
  const r = readPlan(noNotes);
  assert.equal(r.input, null);
  assert.deepEqual(r.missing.map(m => m.key), ["thickness", "cover", "fc", "lap"]);
  const typed = readPlan(noNotes, { values: { thickness: 200, cover: 30, fc: 32, lap: 600 } });
  assert.ok(typed.input);
  const { name, gridLabels, ...got } = typed.input as Record<string, unknown>;
  void name; void gridLabels;
  assert.deepEqual(got, expected());
  assert.match(typed.steps.find(s => s.n === 5)!.lines.join(" "), /Slab thickness: 200 mm \(typed in\)/);
});

test("a plan in metres with lettered grids, mesh, and a lone bottom mat", () => {
  for (const f of ["metres.dxf", "nounits.dxf"]) {
    const r = readPlan(fixture(f));
    assert.ok(r.input, f + ": " + JSON.stringify(r.issues));
    const i = r.input as Record<string, unknown>;
    assert.deepEqual(i.gridX, [0, 6000, 12000, 19200, 25200]);
    assert.deepEqual(i.gridY, [0, 7000, 14000, 21000]);
    assert.equal(i.overhang, 300);
    assert.deepEqual([i.thickness, i.cover, i.fc, i.lap], [250, 25, 40, 500]);
    assert.equal(i.callouts, "N12-200 A E-W\nSL92 T E-W");   // a lone B is the outer bottom layer
    assert.ok(r.issues.some(x => /The engine names the grids across 1, 2, 3/.test(x.text)));
    assert.equal(r.issues.some(x => x.step === 1), f === "nounits.dxf");
    assert.equal(r.engine?.errors.length, 0);
  }
});

test("reading is deterministic and never throws on a damaged file", () => {
  const a = JSON.stringify(readPlan(fixture("level1.dxf"))), b = JSON.stringify(readPlan(fixture("level1.dxf")));
  assert.equal(a, b);
  const junk = readDxf("0\nSECTION\n2\nENTITIES\n0\nLINE\n10\nabc\n0\nTEXT\n1\n");
  assert.ok(Array.isArray(junk.entities));
  const r = readPlan(readDxf("not a drawing"));
  assert.equal(r.input, null);
  assert.equal(r.steps[0].status, "error");
});
