// @xstruc/engine public entry (architecture v2 §6). The engine is split into section modules (backlog #39); every
// module's names are re-exported for the prototype page and the tests, and the main entry points are re-declared
// below with their types, which take precedence over the star exports.
import type { ElementInput, Model, PanelInput, FloorInput } from "./types.ts";
import { buildModel as buildModelImpl } from "./floor.ts";
import { buildPanel as buildPanelImpl, PANEL_CFG as PANEL_CFG_IMPL } from "./panel.ts";
import { DEFAULT_CFG as DEFAULT_CFG_IMPL } from "./defaults.ts";

export * from "./constants.ts";
export * from "./bending.ts";
export * from "./laps.ts";
export * from "./setout.ts";
export * from "./defaults.ts";
export * from "./grammar.ts";
export * from "./geometry.ts";
export * from "./floor.ts";
export * from "./panel.ts";
export * from "./mesh.ts";
export * from "./cover.ts";
export * from "./inserts.ts";
export * from "./sheet.ts";
export * from "./sheet-annotate.ts";
export * from "./sheet-panel.ts";
export * from "./print.ts";
export * from "./section.ts";
export { buildPit, PIT_CFG, PIT_LAYERS, type PitInput, type Solid } from "./pit.ts";
export type * from "./types.ts";

// Bump on any change that alters a golden output (semver: major = a schedule can change on the same inputs), with
// package.json and test/golden/golden.json (UPDATE_GOLDEN=1).
export const ENGINE_VERSION = "1.1.0";

// The modules behind these are not strictly typed yet (@ts-nocheck), so their inferred shapes are cast to the
// declared API once, here; the casts go as each module is converted.
/** Builds a floor slab or (kind: "panel") a precast panel. Never throws on bad inputs: they come back in `errors`. */
export const buildModel = buildModelImpl as unknown as (cfg: ElementInput) => Model;
export const buildPanel = buildPanelImpl as unknown as (cfg: PanelInput) => Model;
export const DEFAULT_CFG = DEFAULT_CFG_IMPL as unknown as FloorInput;
export const PANEL_CFG = PANEL_CFG_IMPL as unknown as PanelInput;

const num = (v: unknown) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
const pts = (p: number[][] | undefined) => (p || []).map(q => q.map(num));

/**
 * The parts of a model a fabricator or crew acts on, as plain JSON in a fixed key order: what an approval's hash is
 * taken over. Same inputs + same ENGINE_VERSION → the same string, in any browser or on the server.
 */
export function canonicalOutput(model: Model): string {
  const runIndex = new Map((model.runs || []).map((r, i) => [r, i]));
  const out = {
    engine: ENGINE_VERSION,
    kind: model.kind || "floor",
    errors: model.errors || [],
    warnings: model.warnings || [],
    kg: num(model.kg),
    marks: (model.marks || []).map(m => ({ mark: m.mark, type: m.type, size: m.size, code: m.code, dims: m.dimStr ?? null, len: num(m.len), qty: m.qty, layer: m.layer, kg: num(m.kg), flags: m.flags || [] })),
    bars: (model.bars || []).filter(b => !b.existing).map(b => ({ id: b.id, layer: b.layer, run: runIndex.has(b.run) ? runIndex.get(b.run) : null, size: b.size, type: b.type, code: b.code ?? null, mark: b.mark ?? null, len: num(b.len), pts: pts(b.pts) })),
    mesh: (model.meshPieces || []).map(p => ({ id: p.id, mark: p.mark ?? null, code: p.code, layer: p.layer, cutL: num(p.cutL), cutW: num(p.cutW), box: [p.x0, p.y0, p.x1, p.y1].map(num) }))
  };
  return JSON.stringify(out);
}
