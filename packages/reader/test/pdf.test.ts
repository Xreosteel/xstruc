// The PDF reader on an invented pad drawn the way a consultant's AutoCAD plot comes out (fixtures/make.py), and on a
// real job's plan when one is given privately (XSTRUC_PRIVATE_PLAN=<path to a PDF>; real drawings never go in the repo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdf, readPlan, type PdfJs, type Sheet } from "../src/index.ts";

const pdf = async (path: string | URL, page = 1): Promise<Sheet> => readPdf(pdfjs as unknown as PdfJs, new Uint8Array(readFileSync(path)), { page });
const fixture = new URL("./fixtures/washpad.pdf", import.meta.url);
const typed = { thickness: 300, cover: 50, fc: 32, lap: 500 };

test("PDF: scale from the sheet, checked by the dimensions; text lines stacked; dashes rejoined", async () => {
  const s = await pdf(fixture);
  assert.equal(s.source, "pdf");
  assert.deepEqual(s.paper && { page: s.paper.page, pages: s.paper.pages, size: s.paper.size, scale: s.paper.scale, from: s.paper.from }, { page: 1, pages: 2, size: [420, 297], scale: 50, from: "the sheet (1:50)" });
  assert.ok(s.paper!.agree >= 3, "dimensions agreeing with 1:50: " + s.paper!.agree);
  const texts = s.entities.filter(e => e.kind === "text").map(e => (e.kind === "text" ? e.text : ""));
  assert.ok(texts.filter(t => t === "N12-200\nTOP & BOT").length === 2, texts.join(" | "));
  assert.equal(s.entities.filter(e => e.kind === "line" && e.linetype === "DASHED").length, 4);
  // the pad's edges in drawing millimetres
  const lines = s.entities.filter(e => e.kind === "line");
  assert.ok(lines.some(e => e.kind === "line" && Math.abs(Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) - 13500) < 3));
});

test("PDF pad: no grids, edges as separate lines, callouts on their distribution lines, TOP & BOT", async () => {
  const r = readPlan(await pdf(fixture));
  assert.equal(r.input, null);
  assert.deepEqual(r.missing.map(m => m.key), ["thickness", "cover", "fc", "lap", "outer"]);
  assert.deepEqual(r.missing.find(m => m.key === "outer")!.options, ["E-W", "N-S"]);
  assert.match(r.steps[1].lines[0], /No grid lines/);
  assert.match(r.steps[2].lines[0], /Slab 13,500 × 7,500/);
  assert.ok(r.issues.some(i => /long narrow strip 510 × 7,200/.test(i.text)));
  const six = r.steps[5].lines.join("\n");
  assert.match(six, /bars N-S \(up the sheet\), written on its distribution line over 99 %/);
  assert.match(six, /bars E-W \(across the sheet\), written on its distribution line over 99 %/);
  assert.ok(!r.issues.some(i => i.level === "error"), JSON.stringify(r.issues));
  // the outer layers as chosen: N-S outside → A and D run N-S
  const built = readPlan(await pdf(fixture), { values: { ...typed, outer: "N-S" } });
  assert.ok(built.input, JSON.stringify(built.issues));
  const i = built.input as Record<string, unknown>;
  assert.deepEqual([i.gridX, i.gridY, i.overhang, i.name], [[0, 13500], [0, 7500], 0, "EXAMPLE PAD"]);
  assert.equal(i.callouts, "N12-200 A N-S\nN12-200 B E-W\nN12-200 C E-W\nN12-200 D N-S");
  assert.equal(built.engine?.errors.length, 0);
  assert.ok(Math.abs(built.engine!.kg - 2005) < 10, "kg " + built.engine!.kg);
  const ew = readPlan(await pdf(fixture), { values: { ...typed, outer: "E-W" } });
  assert.equal((ew.input as Record<string, unknown>).callouts, "N12-200 A E-W\nN12-200 B N-S\nN12-200 C N-S\nN12-200 D E-W");
});

test("PDF page 2 is a sections sheet: said, and not built", async () => {
  const r = readPlan(await pdf(fixture, 2), { values: { ...typed, outer: "N-S" } });
  assert.ok(r.issues.some(i => /looks like sections and details/.test(i.text)));
  assert.equal(r.input, null);
});

const privatePlan = process.env.XSTRUC_PRIVATE_PLAN;
test("a real wash pad plan (private, only when XSTRUC_PRIVATE_PLAN is set)", { skip: !privatePlan || !existsSync(privatePlan) }, async () => {
  // a 13.5 x 7.5 m slab-on-ground pad at 1:50: N12-200 top and bottom each way, a centre drain, no grids, no notes.
  // XREO's own schedule had 1,976 kg for these four mats (laps and end bends included).
  const r = readPlan(await pdf(privatePlan!), { values: { ...typed, outer: "N-S" } });
  assert.ok(r.input, JSON.stringify(r.issues));
  const i = r.input as Record<string, unknown>;
  assert.deepEqual([i.gridX, i.gridY], [[0, 13500], [0, 7500]]);
  assert.equal(i.callouts, "N12-200 A N-S\nN12-200 B E-W\nN12-200 C E-W\nN12-200 D N-S");
  assert.ok(r.issues.some(x => /long narrow strip 510/.test(x.text)));
  assert.ok(Math.abs(r.engine!.kg - 1976) / 1976 < 0.03, "within 3 % of XREO's schedule: " + r.engine!.kg);
});
