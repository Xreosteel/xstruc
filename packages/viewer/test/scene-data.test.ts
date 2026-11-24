// The viewer's scene data from the engine's examples: every bar becomes segments in its layer, the fixing steps show
// the right layers, the concrete and bounds frame the element. Pure (no WebGL), so it runs in Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, DEFAULT_CFG, PANEL_CFG } from "@xstruc/engine";
import { sceneData, stepLayers, toScene } from "../src/scene-data.ts";

test("floor: every bar is drawn, in its layer, in fixing order", () => {
  const M = buildModel(DEFAULT_CFG), D = sceneData(M);
  const drawn = M.bars.filter(b => b.pts && b.pts.length > 1);
  assert.equal(D.bars.length, drawn.length + ((M as any).wires || []).length);
  const segs = Object.values(D.layers).reduce((n, L) => n + L.segments.length, 0) + D.context.length;
  assert.equal(segs, drawn.reduce((n, b) => n + b.pts.length - 1, 0));
  assert.deepEqual(D.order, (M as any).ORDER.filter((id: string) => D.layers[id] && (D.layers[id].segments.length || id === "CH")));
  assert.ok(D.order.includes("BM") && D.order.includes("CH"));
  for (const id of ["A", "B", "C", "D"]) assert.ok(D.layers[id].segments.length > 100, "layer " + id + " has its bars");
  assert.ok(D.context.length > 0, "the starters below are context");
  assert.ok(D.concrete.some(p => p.kind === "slab") && D.concrete.some(p => p.kind === "beam") && D.concrete.some(p => p.kind === "column"));
  const [w, , d] = [0, 1, 2].map(k => D.bounds.max[k] - D.bounds.min[k]);
  assert.ok(w > 14 && w < 20 && d > 9 && d < 16, "bounds are the floor's size in metres");
});

test("a floor without beams or columns has no steps for them", () => {
  const M = buildModel({ ...DEFAULT_CFG, features: { ...(DEFAULT_CFG as any).features, beams: false, columns: false, stair: false } } as never);
  const D = sceneData(M as never);
  assert.ok(!D.order.includes("BM") && !D.order.includes("ST"), D.order.join(","));
  assert.ok(D.order.includes("A") && D.order.includes("D"));
});

test("panel: faces in their order, the window cut out of the concrete", () => {
  const P = buildModel(PANEL_CFG), D = sceneData(P);
  assert.equal(D.kind, "panel");
  assert.deepEqual(D.order.slice(0, 2), ["FF1", "FF2"]);
  assert.ok(D.layers.FF1.segments.length > 0, "the far-face mesh wires are drawn");
  assert.equal(D.concrete.length, 1);
  assert.equal(D.concrete[0].holes.length, 1);
  assert.equal(D.concrete[0].z1, 200);
});

test("fixing steps: the step's layer solid, the ones below faint, the rest hidden", () => {
  const order = ["BM", "A", "B", "CH", "C", "D"];
  assert.deepEqual(stepLayers(order, 2), { solid: ["B"], ghost: ["BM", "A"], hidden: ["CH", "C", "D"] });
  assert.deepEqual(stepLayers(order, null), { solid: order, ghost: [], hidden: [] });
});

test("model mm to scene metres, y up", () => {
  assert.deepEqual(toScene([1000, 2000, 300]), [1, 0.3, -2]);
});

test("grids and run tags: four by three grid lines on the floor, one tag per labelled run", () => {
  const M = buildModel(DEFAULT_CFG), D = sceneData(M);
  assert.deepEqual(D.grids.map(g => g.name), ["1", "2", "3", "4", "A", "B", "C"]);
  const labelled = (M as any).runs.filter((r: any) => r.label && (r.dist || r.tagPos));
  assert.equal(D.tags.length, labelled.length);
  const a = D.tags.find(t => t.layer === "A" && t.line)!;
  assert.ok(a && /N16-200/.test(a.label), "layer A's main mat is tagged on its distribution line");
  const [p, q] = a.line!;
  assert.ok(a.at[2] <= Math.max(p[2], q[2]) && a.at[2] >= Math.min(p[2], q[2]), "the tag sits on its line");
  const P = sceneData(buildModel(PANEL_CFG));
  assert.equal(P.grids.length, 0, "a panel has no grids");
  assert.ok(P.tags.some(t => t.layer === "NF1"));
});
