// @xstruc/engine public entry. engine.js is the engine itself (moved verbatim from the prototype, see its header);
// this file adds the version and the canonical output that approvals hash (architecture v2, ADR-007).
export * from "./engine.js";

// Bump on any change that alters a golden output (semver: major = a schedule can change on the same inputs).
export const ENGINE_VERSION = "1.0.0";

const num = v => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
const pts = p => (p || []).map(q => q.map(num));

/**
 * The parts of a model a fabricator or crew acts on, as plain JSON in a fixed key order: what an approval's hash is
 * taken over. Same inputs + same ENGINE_VERSION → the same string, in any browser or on the server.
 */
export function canonicalOutput(model) {
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
