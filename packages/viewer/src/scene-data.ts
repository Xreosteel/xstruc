// What the 3D view draws, worked out from an engine model with no WebGL: bar segments by layer, concrete pieces,
// layer order and colours, bounds. Pure, so it is unit-tested in Node; viewer.ts turns it into three.js objects.
// Model space is millimetres, x east / along the panel, y north / up the panel, z up from the soffit or the bed;
// the scene is metres with y up (scene x = x, scene y = z, scene z = −y), as in the prototype's W().
import type { Model, Bar } from "@xstruc/engine";

export type V3 = [number, number, number];
export const toScene = (p: number[]): V3 => [p[0] / 1000, p[2] / 1000, -p[1] / 1000];

export interface Segment { a: V3; b: V3; r: number; bar: number }   // r: bar radius in metres; bar: index into SceneData.bars
export interface LayerData { id: string; name: string; color: string; segments: Segment[] }
/** A prism: a plan polygon (model mm, with holes) between two levels (model mm). */
/** Concrete: an outline extruded along an axis. z (default): a plan outline (x, y) from z0 to z1. x: a section
 *  outline (y, z) from x = z0 to x = z1 (a ramp, a wall stepping down beside it). */
export interface Prism { kind: string; outline: number[][]; holes: number[][][]; z0: number; z1: number; axis?: "x" | "z" }
/** A point of a prism's outline at its two ends, in model millimetres. */
export const prismPoints = (p: Prism): number[][] => p.outline.flatMap(q => (p.axis === "x" ? [[p.z0, q[0], q[1]], [p.z1, q[0], q[1]]] : [[q[0], q[1], p.z0], [q[0], q[1], p.z1]]));
/** A grid line with its name bubble at each end (floor only). */
export interface GridData { name: string; a: V3; b: V3 }
/** A run's tag: the label at its anchor, and its distribution line when it has one. */
export interface TagData { layer: string; label: string; callout: string; at: V3; line: [V3, V3] | null }
export interface SceneData {
  kind: "floor" | "panel" | "pit";
  grids: GridData[];
  tags: TagData[];
  order: string[];               // fixing order of the layers drawn
  layers: Record<string, LayerData>;
  context: Segment[];            // existing bars (starters below and the like), drawn faint, never picked
  bars: Bar[];                   // every drawn bar or wire, indexed by Segment.bar
  concrete: Prism[];
  bounds: { min: V3; max: V3 };
}

interface Rect { x0: number; y0: number; x1: number; y1: number }
const rect = (r: Rect): number[][] => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.y0 >= b.y0 && a.y1 <= b.y1;

/** Concrete as prisms. The stair flight and the step nib are not drawn yet (the bars are). */
export function concreteOf(M: Model): Prism[] {
  const m = M as Model & Record<string, any>;
  const T: number = m.panel ? m.panel.T : m.T;
  if (m.kind === "pit") return (m.solids || []).map((s: any) => ({ kind: s.kind, outline: s.outline, holes: s.holes || [], z0: s.z0, z1: s.z1, axis: s.axis }));
  if (m.kind === "panel") {
    const holes = (m.HOLES || []).filter((h: any) => !h.edge).map((h: Rect) => rect(h));
    return [{ kind: "panel", outline: m.outline || rect({ x0: 0, y0: 0, x1: m.panel.W, y1: m.panel.H }), holes, z0: 0, z1: T }];
  }
  const out: Prism[] = [];
  const SL: Rect = m.SL;
  const cut: Rect[] = (m.HOLES || []).concat(m.DROPS || []).filter((h: Rect) => inside(h, SL));
  const step: (Rect & { rise?: number }) | null = m.STEP && m.STEP.x1 != null ? m.STEP : null;
  out.push({ kind: "slab", outline: rect(SL), holes: cut.concat(step ? [step] : []).map(rect), z0: 0, z1: T });
  for (const d of m.DROPS || []) out.push({ kind: "set-down", outline: rect(d), holes: [], z0: -d.d, z1: T - d.d });
  if (step) out.push({ kind: "step", outline: rect(step), holes: (m.HOLES || []).filter((h: Rect) => inside(h, step)).map(rect), z0: step.rise ?? 0, z1: T + (step.rise ?? 0) });
  for (const b of m.BALCS || []) out.push({ kind: "balcony", outline: rect(b), holes: [], z0: b.bot, z1: b.top });
  for (const b of m.BEAMS || []) {
    const r = b.dir === "X" ? { x0: b.a, x1: b.b, y0: b.at - b.w / 2, y1: b.at + b.w / 2 } : { x0: b.at - b.w / 2, x1: b.at + b.w / 2, y0: b.a, y1: b.b };
    out.push({ kind: "beam", outline: rect(r), holes: [], z0: T - b.D, z1: 0 });
  }
  const c = (m.COL || 400) / 2;
  for (const col of m.COLS || []) out.push({ kind: "column", outline: rect({ x0: col.x - c, x1: col.x + c, y0: col.y - c, y1: col.y + c }), holes: [], z0: m.COLB ?? -3000, z1: 0 });
  return out;
}

export function sceneData(M: Model): SceneData {
  const m = M as Model & Record<string, any>;
  const order: string[] = (m.ORDER || []).slice();
  const layers: Record<string, LayerData> = {};
  for (const l of m.LAYERS || []) layers[l.id] = { id: l.id, name: l.name, color: (l as any).css || "#cccccc", segments: [] };
  const bars: Bar[] = [], context: Segment[] = [];
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: V3) => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } };
  const add = (b: Bar) => {
    if (!b.pts || b.pts.length < 2) return;
    const i = bars.length; bars.push(b);
    const r = Math.max(2, (+b.size || 6) / 2) / 1000;
    for (let k = 1; k < b.pts.length; k++) {
      const s: Segment = { a: toScene(b.pts[k - 1]), b: toScene(b.pts[k]), r, bar: i };
      grow(s.a); grow(s.b);
      if (b.existing) context.push(s);
      else (layers[b.layer] || (layers[b.layer] = { id: b.layer, name: b.layer, color: "#cccccc", segments: [] })).segments.push(s);
    }
  };
  (m.bars || []).forEach(add);
  (m.wires || []).forEach(add);
  const concrete = concreteOf(M);
  for (const p of concrete) for (const q of prismPoints(p)) grow(toScene(q));
  for (const id of Object.keys(layers)) if (!order.includes(id) && layers[id].segments.length) order.push(id);
  // grid lines on the slab's top, run 1,000 past the slab and balconies each way, a bubble at each end
  const grids: GridData[] = [];
  const E = m.EXT || m.SL, T = m.T || 0;
  if (E) {
    for (const [name, x] of (m.GX || []) as [string, number][]) grids.push({ name, a: toScene([x, E.y0 - 1000, T]), b: toScene([x, E.y1 + 1000, T]) });
    for (const [name, y] of (m.GY || []) as [string, number][]) grids.push({ name, a: toScene([E.x0 - 1000, y, T]), b: toScene([E.x1 + 1000, y, T]) });
  }
  // run tags: on the distribution line at its fraction (a line across the bars), else at the run's tag anchor
  const tags: TagData[] = [];
  for (const r of (m.runs || []) as any[]) {
    if (!r.label) continue;
    if (r.dist) {
      const d = r.dist, P = (p: number) => (d.dir === "X" ? [d.at, p, d.z] : [p, d.at, d.z]);
      tags.push({ layer: r.layer, label: r.label, callout: r.callout || "", at: toScene(P(d.p0 + (d.frac ?? 0.5) * (d.p1 - d.p0))), line: [toScene(P(d.p0)), toScene(P(d.p1))] });
    } else if (r.tagPos) tags.push({ layer: r.layer, label: r.label, callout: r.callout || "", at: toScene(r.tagPos), line: null });
  }
  // steps only for layers with something in them (a pad with no beams has no "beam cages" step); bar chairs stay
  const shown = order.filter(id => layers[id] && (layers[id].segments.length || (id === "CH" && ((m as any).chairs || []).length)));
  return { kind: m.kind === "panel" ? "panel" : m.kind === "pit" ? "pit" : "floor", grids, tags, order: shown, layers, context, bars, concrete, bounds: { min, max } };
}

/** Which layers a fixing step shows: everything up to the step, the step's own layer solid and the rest ghosted. */
export function stepLayers(order: string[], step: number | null): { solid: string[]; ghost: string[]; hidden: string[] } {
  if (step == null || step >= order.length) return { solid: order.slice(), ghost: [], hidden: [] };
  const i = Math.max(0, step);
  return { solid: [order[i]], ghost: order.slice(0, i), hidden: order.slice(i + 1) };
}
