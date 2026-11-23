// Reads a slab plan the way a scheduler does, one step after another, each step using what the earlier ones found:
//   1 open the drawing   2 grid lines   3 slab edge (and balconies)   4 openings, set-downs, step
//   5 general notes (thickness, cover, concrete, laps)   6 reinforcement callouts (layer, direction, extent)
//   7 check   8 build
// Every rule is geometry or text matching (no AI, no network). Nothing an engineer decides is guessed: a value the
// drawing does not give is asked for (`missing`), and anything the engine cannot build yet is said (`issues`).
// The result is the engine's FloorInput plus the report a person reads before building.
import { buildModel, matDirectionError, parseCallout, type Callout, type FloorInput } from "@xstruc/engine";
import type { Circle, Entity, Hatch, Leader, Line, Pline, Pt, Sheet, Text } from "./sheet.ts";
import { isDashed } from "./sheet.ts";
import { area, boxCentre, boxDist, boxH, boxOf, boxW, dist, inBox, inPoly, isHorizontal, isOrthogonal, isRect, isVertical, median, segDist, simplify, type Box } from "./geom.ts";

export type FoundKind = "grid" | "slab" | "balcony" | "opening" | "setdown" | "step" | "column" | "note" | "callout" | "extent";
/** Something recognised on the drawing: what it is, the entities it came from (for highlighting), drawing mm. */
export interface Found { kind: FoundKind; label: string; ids: string[]; box?: Box; sure: boolean }
export interface Issue { level: "error" | "check"; step: number; text: string; ids: string[] }
export interface StepReport { n: number; title: string; status: "ok" | "check" | "error"; lines: string[] }
/** A value the drawing does not give (or gives more than one of) that a person must type before building. */
export interface Missing { key: string; label: string; unit: string; options?: number[] }

export interface PlanReading {
  input: FloorInput | null;
  missing: Missing[];
  steps: StepReport[];
  found: Found[];
  issues: Issue[];
  /** Drawing coordinates of the intersection of the first grid each way (the engine's 0, 0), or null. */
  origin: Pt | null;
  /** The engine's own check of the input (errors and warnings), run when nothing is missing. */
  engine: { errors: string[]; warnings: string[]; bars: number; kg: number } | null;
}

export interface ReadOptions {
  /** Values typed by a person for the keys in `missing` (thickness, cover, fc, lap, balcony.0.thk …). */
  values?: Record<string, number>;
  name?: string;
}

// Australian layer words → the engine's layers (CLAUDE.md: A = B1, B = B2, C = T2, D = T1)
const LAYER_OF: Record<string, string> = { B1: "A", B2: "B", T2: "C", T1: "D" };
const OPENING_WORDS = /\b(VOID|OPENING|OPEN|PEN(?:ETRATION)?|STAIR(?:S|WELL)?|RISER|DUCT|LIFT|SHAFT|HOLE|HATCH)\b/;
const SETDOWN_RE = /\b(?:SET\s*-?\s*DOWN|SETDOWN|S\/D|RECESS(?:ED)?|DROP)\b\s*(?:OF\s*)?(\d{1,3})?|(\d{1,3})\s*(?:MM\s*)?(?:SET\s*-?\s*DOWN|SETDOWN|S\/D|RECESS|DROP)\b/;
const STEP_RE = /\bSTEP(?:\s*UP)?\b\s*(\d{2,3})?|\bRAISED\s*(\d{2,3})?|(\d{2,3})\s*(?:MM\s*)?STEP\b/;
const NIB_RE = [/\bNIB\s*(?:WIDTH\s*)?(\d{2,3})/, /(\d{2,3})\s*(?:MM\s*)?(?:WIDE\s*)?NIB\b/];
const RISE_RE = [/\bSTEP(?:\s*UP|\s*DOWN)?\s*(\d{2,3})/, /\bRAISED\s*(\d{2,3})/, /(\d{2,3})\s*(?:MM\s*)?STEP\b/];
const DEPTH_RE = [/\b(?:SET\s*-?\s*DOWN|SETDOWN|S\/D|RECESS(?:ED)?|DROP)\s*(?:OF\s*)?(\d{1,3})\b/, /\b(\d{1,3})\s*(?:MM\s*)?(?:SET\s*-?\s*DOWN|SETDOWN|S\/D|RECESS|DROP)\b/];
const THK_RE = /(?:\b|^)(\d{2,3})\s*(?:MM\s*)?(?:THK|THICK|THICKNESS)\b|\bTHICKNESS\s*(?:=|:)?\s*(\d{2,3})\b|\bSLAB\s+(\d{3})\b/;
const COVER_RE = /\bCOVERS?\s*(?:=|:|TO\s+\w+\s*)?\s*(\d{2,3})\b|\b(\d{2,3})\s*(?:MM\s*)?COVER\b/g;
const LAP_RE = /\bLAPS?\s*(?:LENGTH\s*)?(?:=|:)?\s*(\d{3,4})\b|\b(\d{3,4})\s*(?:MM\s*)?LAPS?\b/g;
const FC_RE = /\bF'?C\s*(?:=|:)?\s*(\d{2})\b|\b(\d{2})\s*MPA\b|\b(?:CONC(?:RETE)?|GRADE)\b[^\n]{0,20}?\bN(20|25|32|40|50|65)\b|\bN(20|25|32|40|50|65)\b[^\n]{0,12}?\bCONC(?:RETE)?\b/;
const CONCRETE_WORDS = /\b(CONC|CONCRETE|MPA|GRADE|F'?C)\b/;
const BALCONY_WORDS = /\b(BALCONY|BALC|TERRACE|DECK|CANTILEVER|VERANDAH)\b/;
const NOTES_HEAD = /\b(U\.?N\.?O\.?|UNLESS NOTED|TYPICAL|GENERAL NOTES?|SLAB REINF|REINFORCEMENT)\b/;

const up = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();
const fmt = (v: number) => Math.round(v).toLocaleString("en-AU");

export function readPlan(sheet: Sheet, opts: ReadOptions = {}): PlanReading {
  const values = opts.values ?? {};
  const found: Found[] = [], issues: Issue[] = [], steps: StepReport[] = [], missing: Missing[] = [];
  const issue = (level: Issue["level"], step: number, text: string, ids: string[] = []) => issues.push({ level, step, text, ids });
  const used = new Set<string>();   // entities already explained by an earlier step
  const E = sheet.entities;
  const texts = E.filter((e): e is Text => e.kind === "text");
  const circles = E.filter((e): e is Circle => e.kind === "circle");
  const leaders = E.filter((e): e is Leader => e.kind === "leader");
  const hatches = E.filter((e): e is Hatch => e.kind === "hatch");
  // straight pieces: LINEs and two-point polylines
  const segs: { id: string; a: Pt; b: Pt; e: Line | Pline }[] = [];
  for (const e of E) {
    if (e.kind === "line") segs.push({ id: e.id, a: e.a, b: e.b, e });
    else if (e.kind === "pline" && !e.closed && simplify(e.pts, false).length === 2) { const p = simplify(e.pts, false); segs.push({ id: e.id, a: p[0], b: p[1], e }); }
  }
  const rings = E.filter((e): e is Pline => e.kind === "pline" && (e.closed || (e.pts.length > 3 && dist(e.pts[0], e.pts[e.pts.length - 1]) < 1)))
    .map(e => ({ id: e.id, e, pts: simplify(e.pts, true), box: boxOf(e.pts) }));
  const leaderText = new Map<string, Text>();
  for (const l of leaders) {
    const tail = l.pts[l.pts.length - 1];
    let best: { t: Text; d: number } | null = null;
    for (const t of texts) { const d = boxDist(tail, boxOf(t.box)); if (d <= Math.max(2 * t.h, 300) && (!best || d < best.d)) best = { t, d }; }
    if (best) leaderText.set(l.id, best.t);
  }
  const finish = (input: FloorInput | null, origin: Pt | null, engine: PlanReading["engine"] = null): PlanReading => ({ input, missing, steps, found, issues, origin, engine });
  const status = (n: number): StepReport["status"] => issues.some(i => i.step === n && i.level === "error") ? "error" : issues.some(i => i.step === n) ? "check" : "ok";

  // ---------- 1 open the drawing
  {
    const lines = [
      E.length.toLocaleString("en-AU") + " items read (" + texts.length + " texts, " + segs.length + " lines, " + rings.length + " closed shapes" + (sheet.stats.exploded ? ", " + sheet.stats.exploded + " blocks opened" : "") + ")",
      "Units: " + sheet.units.name + (sheet.units.inferred ? " (not stated in the file; worked out from the drawing's size)" : "")
    ];
    sheet.warnings.forEach(w => lines.push(w));
    if (sheet.units.inferred) issue("check", 1, "The file does not say its units; read as " + sheet.units.name + ". Check one dimension.");
    if (!E.length) issue("error", 1, "Nothing was read from the file.");
    steps.push({ n: 1, title: "Open the drawing", status: status(1), lines });
    if (!E.length) return finish(null, null);
  }

  // ---------- 2 grid lines: a long straight line with a bubble (circle with a short label) at an end
  const gridV: { x: number; label: string; ids: string[] }[] = [], gridH: { y: number; label: string; ids: string[] }[] = [];
  {
    const ext = sheet.extents!, span = Math.max(ext.max[0] - ext.min[0], ext.max[1] - ext.min[1]);
    const bubbles: { c: Circle; label: string; tid: string }[] = [];
    for (const c of circles) {
      if (c.r < 50 || c.r > 2500) continue;
      const t = texts.find(t => dist(boxCentre(boxOf(t.box)), c.c) < c.r * 0.8 && /^[A-Z]{0,2}\d{0,3}[A-Z]?$/i.test(t.text.trim()) && t.text.trim().length <= 4 && t.text.trim().length > 0);
      if (t) bubbles.push({ c, label: t.text.trim().toUpperCase(), tid: t.id });
    }
    const minLen = Math.max(2000, span * 0.15);
    for (const b of bubbles) {
      // a straight line that stops at the bubble (or runs into it) and points through its centre
      let best: { s: (typeof segs)[number]; d: number } | null = null;
      for (const s of segs) {
        const L = dist(s.a, s.b);
        if (L < minLen || (!isVertical(s.a, s.b, 0.5) && !isHorizontal(s.a, s.b, 0.5))) continue;
        const end = Math.min(dist(s.a, b.c.c), dist(s.b, b.c.c));
        const off = isVertical(s.a, s.b, 0.5) ? Math.abs((s.a[0] + s.b[0]) / 2 - b.c.c[0]) : Math.abs((s.a[1] + s.b[1]) / 2 - b.c.c[1]);
        if (off > b.c.r * 0.15 || end > b.c.r * 2.5) continue;
        if (!best || end < best.d) best = { s, d: end };
      }
      if (!best) continue;
      const s = best.s, ids = [s.id, b.c.id, b.tid];
      if (isVertical(s.a, s.b, 0.5)) {
        const x = (s.a[0] + s.b[0]) / 2, g = gridV.find(g => Math.abs(g.x - x) < 1);
        if (g) { if (g.label !== b.label) issue("check", 2, "Grid line at the same place is labelled both " + g.label + " and " + b.label + ".", ids); g.ids.push(...ids); }
        else gridV.push({ x, label: b.label, ids });
      } else {
        const y = (s.a[1] + s.b[1]) / 2, g = gridH.find(g => Math.abs(g.y - y) < 1);
        if (g) { if (g.label !== b.label) issue("check", 2, "Grid line at the same place is labelled both " + g.label + " and " + b.label + ".", ids); g.ids.push(...ids); }
        else gridH.push({ y, label: b.label, ids });
      }
    }
    gridV.sort((p, q) => p.x - q.x); gridH.sort((p, q) => p.y - q.y);
    for (const g of [...gridV, ...gridH]) { g.ids.forEach(i => used.add(i)); found.push({ kind: "grid", label: "Grid " + g.label, ids: g.ids, sure: true }); }
    const lines: string[] = [];
    if (gridV.length) lines.push(gridV.length + " grid lines across (" + gridV.map(g => g.label).join(", ") + "), spacings " + gridV.slice(1).map((g, i) => fmt(g.x - gridV[i].x)).join(", "));
    if (gridH.length) lines.push(gridH.length + " grid lines up (" + gridH.map(g => g.label).join(", ") + "), spacings " + gridH.slice(1).map((g, i) => fmt(g.y - gridH[i].y)).join(", "));
    if (gridV.length < 2 || gridH.length < 2) issue("error", 2, "Need at least two grid lines each way, each a straight line ending in a bubble with its label; found " + gridV.length + " across and " + gridH.length + " up.");
    const order = (ls: string[]) => ls.every((l, i) => i === 0 || cmpLabel(ls[i - 1], l) < 0) ? "up" : ls.every((l, i) => i === 0 || cmpLabel(ls[i - 1], l) > 0) ? "down" : "mixed";
    const ax = gridV.map(g => g.label), ay = gridH.map(g => g.label);
    if (ax.length >= 2 && (!ax.every(l => /^\d+$/.test(l)) || order(ax) !== "up")) issue("check", 2, "The engine names the grids across 1, 2, 3 … from the left; the drawing has " + ax.join(", ") + ". The 3D uses the engine's names.");
    if (ay.length >= 2 && (!ay.every(l => /^[A-Z]+$/.test(l)) || order(ay) !== "up")) issue("check", 2, "The engine names the grids up A, B, C … from the bottom; the drawing has " + ay.join(", ") + ". The 3D uses the engine's names.");
    steps.push({ n: 2, title: "Find the grid lines", status: status(2), lines });
    if (gridV.length < 2 || gridH.length < 2) return finish(null, null);
  }
  const origin: Pt = [gridV[0].x, gridH[0].y];
  const G: Box = { x0: gridV[0].x, y0: gridH[0].y, x1: gridV[gridV.length - 1].x, y1: gridH[gridH.length - 1].y };
  const rel = (p: Pt): Pt => [Math.round(p[0] - origin[0]), Math.round(p[1] - origin[1])];
  const textIn = (poly: Pt[], box: Box) => texts.filter(t => { const c = boxCentre(boxOf(t.box)); return inBox(c, box) && inPoly(c, poly); });
  // texts leadered to a shape: a leader whose arrow end is inside it and whose tail is at a text (each leader
  // belongs to the one text nearest its tail)
  const textLeadered = (poly: Pt[], box: Box) => leaders.flatMap(l => {
    const t = leaderText.get(l.id);
    return t && inBox(l.pts[0], box) && inPoly(l.pts[0], poly) ? [{ t, via: l.id }] : [];
  });

  // ---------- 3 slab edge: the smallest closed shape around every grid intersection; balconies stick out of it
  let R: Box | null = null, overhang = 0;
  const balconies: { name: string; edge: "N" | "S" | "E" | "W"; from: number; to: number; proj: number; thk: number | null; down: number | null; ids: string[]; box: Box }[] = [];
  {
    const lines: string[] = [];
    const corners: Pt[] = [[G.x0, G.y0], [G.x1, G.y0], [G.x1, G.y1], [G.x0, G.y1]];
    const cands = rings.filter(r => !used.has(r.id) && corners.every(c => inPoly(c, r.pts, 1))).sort((a, b) => Math.abs(area(a.pts)) - Math.abs(area(b.pts)));
    const slab = cands[0];
    if (!slab) issue("error", 3, "No slab edge found: draw the slab outline as one closed polyline around the grids.");
    else {
      used.add(slab.id);
      const ring = slab.pts;
      if (!isOrthogonal(ring)) issue("error", 3, "The slab edge has sloping or curved sides; the engine builds square-cornered slabs only for now.", [slab.id]);
      // the main edge on each side: the longest edge piece parallel to that side outside the grids
      const sideEdge = (side: "N" | "S" | "E" | "W"): number | null => {
        const byV = new Map<number, number>();
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const horiz = isHorizontal(a, b, 0.5), vert = isVertical(a, b, 0.5);
          if ((side === "N" || side === "S") && !horiz) continue;
          if ((side === "E" || side === "W") && !vert) continue;
          const v = horiz ? a[1] : a[0], len = dist(a, b);
          const outside = side === "N" ? v > G.y1 : side === "S" ? v < G.y0 : side === "E" ? v > G.x1 : v < G.x0;
          // the piece must run along the grid box, not only along a balcony
          const lo = horiz ? Math.min(a[0], b[0]) : Math.min(a[1], b[1]), hi = horiz ? Math.max(a[0], b[0]) : Math.max(a[1], b[1]);
          const overlap = horiz ? Math.min(hi, G.x1) - Math.max(lo, G.x0) : Math.min(hi, G.y1) - Math.max(lo, G.y0);
          if (outside && overlap > 0) { const k = Math.round(v); byV.set(k, (byV.get(k) ?? 0) + overlap); }
        }
        let best: [number, number] | null = null;
        for (const [v, len] of byV) if (!best || len > best[1]) best = [v, len];
        return best ? best[0] : null;
      };
      const n = sideEdge("N"), s = sideEdge("S"), e = sideEdge("E"), w = sideEdge("W");
      if (n === null || s === null || e === null || w === null) issue("error", 3, "Could not find the slab edge on every side of the grids.", [slab.id]);
      else {
        const ov = { N: Math.round(n - G.y1), S: Math.round(G.y0 - s), E: Math.round(e - G.x1), W: Math.round(G.x0 - w) };
        const vals = Object.values(ov);
        overhang = Math.round(median(vals));
        if (Math.max(...vals) - Math.min(...vals) > 5) {
          issue("check", 3, "The slab edge is not the same distance outside the grids all round (north " + ov.N + ", south " + ov.S + ", east " + ov.E + ", west " + ov.W + "). The engine uses one distance for now: " + overhang + ".", [slab.id]);
        }
        R = { x0: G.x0 - overhang, y0: G.y0 - overhang, x1: G.x1 + overhang, y1: G.y1 + overhang };
        lines.push("Slab " + fmt(boxW(R)) + " × " + fmt(boxH(R)) + ", edge " + overhang + " outside the outer grids");
        found.push({ kind: "slab", label: "Slab edge", ids: [slab.id], box: R, sure: true });
        // balconies: the parts of the outline outside the main rectangle, one rectangle per side
        let extra = 0;
        for (const side of ["N", "S", "E", "W"] as const) {
          const out = ring.filter(p => side === "N" ? p[1] > R!.y1 + 1 : side === "S" ? p[1] < R!.y0 - 1 : side === "E" ? p[0] > R!.x1 + 1 : p[0] < R!.x0 - 1);
          if (!out.length) continue;
          const b = boxOf(out);
          const bx: Box = side === "N" ? { x0: b.x0, x1: b.x1, y0: R.y1, y1: b.y1 } : side === "S" ? { x0: b.x0, x1: b.x1, y0: b.y0, y1: R.y0 } : side === "E" ? { x0: R.x1, x1: b.x1, y0: b.y0, y1: b.y1 } : { x0: b.x0, x1: R.x0, y0: b.y0, y1: b.y1 };
          extra += boxW(bx) * boxH(bx);
          const poly: Pt[] = [[bx.x0, bx.y0], [bx.x1, bx.y0], [bx.x1, bx.y1], [bx.x0, bx.y1]];
          const words = [...textIn(poly, bx), ...textLeadered(poly, bx).map(x => x.t)];
          const all = up(words.map(t => t.text).join(" "));
          const thk = matchNum(all, /(\d{2,3})\s*(?:MM\s*)?(?:THK|THICK)\b/);
          const down = /\bFLUSH\b|\bNO SET\s*-?\s*DOWN\b/.test(all) ? 0 : /\b(?:SET\s*-?\s*DOWN|SETDOWN|S\/D|DOWN)\b/.test(all) ? matchAny(all, [...DEPTH_RE, /\bDOWN\s*(\d{1,3})\b/]) : null;
          const name = (BALCONY_WORDS.exec(all)?.[0] ?? "BALCONY").replace(/^BALC$/, "BALCONY");
          const along = side === "N" || side === "S" ? [bx.x0 - origin[0], bx.x1 - origin[0]] : [bx.y0 - origin[1], bx.y1 - origin[1]];
          const proj = side === "N" || side === "S" ? boxH(bx) : boxW(bx);
          const i = balconies.length;
          balconies.push({ name, edge: side, from: Math.round(along[0]), to: Math.round(along[1]), proj: Math.round(proj), thk: values["balcony." + i + ".thk"] ?? thk, down: values["balcony." + i + ".down"] ?? down, ids: [slab.id, ...words.map(t => t.id)], box: bx });
          words.forEach(t => used.add(t.id));
          found.push({ kind: "balcony", label: name + " off the " + ({ N: "north", S: "south", E: "east", W: "west" })[side] + " edge", ids: [slab.id, ...words.map(t => t.id)], box: bx, sure: true });
          lines.push(name + " on the " + ({ N: "north", S: "south", E: "east", W: "west" })[side] + " edge, " + fmt(boxW(bx)) + " × " + fmt(boxH(bx)) + (thk ? ", " + thk + " thick" : "") + (down !== null ? ", set down " + down : ""));
          if (thk === null && values["balcony." + i + ".thk"] === undefined) missing.push({ key: "balcony." + i + ".thk", label: name + " (" + side + " edge) slab thickness", unit: "mm" });
          if (down === null && values["balcony." + i + ".down"] === undefined) missing.push({ key: "balcony." + i + ".down", label: name + " (" + side + " edge) set-down below the main slab top", unit: "mm" });
        }
        const a = Math.abs(area(ring)), want = boxW(R) * boxH(R) + extra;
        if (Math.abs(a - want) > 0.005 * want) issue("error", 3, "The slab edge is not a rectangle with rectangular balconies (it has a notch or an L-shape); the engine builds that shape only for now.", [slab.id]);
      }
    }
    steps.push({ n: 3, title: "Find the slab edge", status: status(3), lines });
  }
  if (!R) return finish(null, origin);
  const slabBox = R;

  // ---------- 4 openings, set-downs and the step: closed shapes inside the slab, named by the text in or leadered to them
  const openings: { name: string; x0: number; y0: number; x1: number; y1: number }[] = [];
  const setdowns: { name: string; x0: number; y0: number; x1: number; y1: number; depth: number }[] = [];
  let step: { x0: number; y0: number; rise: number; nib: number } | null = null;
  let columns = 0;
  {
    const lines: string[] = [];
    const inside = rings.filter(r => !used.has(r.id) && r.pts.every(p => inBox(p, slabBox, 1)));
    const gridPts = gridV.flatMap(v => gridH.map(h => [v.x, h.y] as Pt));
    let unnamed = 0;
    for (const r of inside) {
      const w = boxW(r.box), h = boxH(r.box), c = boxCentre(r.box);
      // a column: a small square or circle on a grid intersection
      if (w <= 1500 && h <= 1500 && gridPts.some(g => inBox(g, r.box, 1))) { columns++; used.add(r.id); found.push({ kind: "column", label: "Column", ids: [r.id], box: r.box, sure: true }); continue; }
      const words = [...textIn(r.pts, r.box).map(t => ({ t, via: "" })), ...textLeadered(r.pts, r.box)].filter(x => !used.has(x.t.id) && !(CALLOUT_HINT.test(up(x.t.text)) && /\d\s*[-@]\s*\d|\b(?:T|B)[12]?\b/.test(up(x.t.text))));
      // a box drawn round a text (a framed note) is not an opening
      if (words.length === 1 && !words[0].via && boxW(boxOf(words[0].t.box)) * boxH(boxOf(words[0].t.box)) > 0.35 * w * h) continue;
      const all = up(words.map(x => x.t.text).join(" "));
      const ids = [r.id, ...words.flatMap(x => (x.via ? [x.t.id, x.via] : [x.t.id]))];
      const crossed = segs.filter(s => !used.has(s.id) && Math.min(dist(s.a, [r.box.x0, r.box.y0]), dist(s.a, [r.box.x1, r.box.y1]), dist(s.a, [r.box.x0, r.box.y1]), dist(s.a, [r.box.x1, r.box.y0])) < 5 && Math.min(dist(s.b, [r.box.x0, r.box.y0]), dist(s.b, [r.box.x1, r.box.y1]), dist(s.b, [r.box.x0, r.box.y1]), dist(s.b, [r.box.x1, r.box.y0])) < 5 && dist(s.a, s.b) > 0.9 * Math.hypot(w, h));
      const hatched = hatches.some(hh => hh.loops.some(l => { const b = boxOf(l); return Math.abs(b.x0 - r.box.x0) < 2 && Math.abs(b.y1 - r.box.y1) < 2 && Math.abs(b.x1 - r.box.x1) < 2 && Math.abs(b.y0 - r.box.y0) < 2; }));
      const rect = isRect(r.pts);
      const a = rel([r.box.x0, r.box.y0]), b = rel([r.box.x1, r.box.y1]);
      if (STEP_RE.test(all) && !SETDOWN_RE.test(all)) {
        const rise = values["step.rise"] ?? matchAny(all, RISE_RE), nib = values["step.nib"] ?? matchAny(all, NIB_RE);
        const ne = Math.abs(r.box.x1 - slabBox.x1) < 2 && Math.abs(r.box.y1 - slabBox.y1) < 2;
        ids.forEach(i => used.add(i));
        if (!ne) { issue("error", 4, "Step at " + fmt(a[0]) + ", " + fmt(a[1]) + ": the engine raises the north-east corner of the slab only for now; this step is elsewhere and is not built.", ids); continue; }
        if (rise === null) missing.push({ key: "step.rise", label: "Step height (rise)", unit: "mm" });
        if (nib === null) missing.push({ key: "step.nib", label: "Step nib width", unit: "mm" });
        step = { x0: a[0], y0: a[1], rise: rise ?? 0, nib: nib ?? 0 };
        found.push({ kind: "step", label: "Step up " + (rise ?? "?"), ids, box: r.box, sure: true });
        lines.push("Step up " + (rise ?? "(height not given)") + " in the north-east corner from " + fmt(a[0]) + ", " + fmt(a[1]) + (nib ? ", nib " + nib : ""));
        continue;
      }
      const sd = SETDOWN_RE.exec(all);
      if (sd) {
        const depth = matchAny(all, DEPTH_RE);
        const key = "setdown." + setdowns.length + ".depth";
        const d = values[key] ?? depth;
        const name = cleanName(all.replace(SETDOWN_RE, " ")) || "SET-DOWN " + (setdowns.length + 1);
        if (d === null) missing.push({ key, label: name + " set-down depth", unit: "mm" });
        if (!rect) issue("check", 4, name + " is not a rectangle; modelled as the rectangle around it.", ids);
        setdowns.push({ name, x0: a[0], y0: a[1], x1: b[0], y1: b[1], depth: d ?? 0 });
        ids.forEach(i => used.add(i));
        found.push({ kind: "setdown", label: name + " set down " + (d ?? "?"), ids, box: r.box, sure: true });
        lines.push("Set-down " + name + " " + fmt(w) + " × " + fmt(h) + ", " + (d ?? "(depth not given)") + " deep");
        continue;
      }
      if (OPENING_WORDS.test(all) || crossed.length >= 2 || (hatched && !all)) {
        const name = cleanName(all) || "OPENING " + (++unnamed + openings.length);
        if (!rect) issue("check", 4, name + " is not a rectangle; modelled as the rectangle around it.", ids);
        if (!OPENING_WORDS.test(all) && crossed.length < 2) issue("check", 4, "A hatched shape at " + fmt(a[0]) + ", " + fmt(a[1]) + " has no words; taken as an opening.", ids);
        openings.push({ name, x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
        [...ids, ...crossed.map(s => s.id)].forEach(i => used.add(i));
        found.push({ kind: "opening", label: name, ids: [...ids, ...crossed.map(s => s.id)], box: r.box, sure: OPENING_WORDS.test(all) || crossed.length >= 2 });
        lines.push("Opening " + name + " " + fmt(w) + " × " + fmt(h) + " at " + fmt(a[0]) + ", " + fmt(a[1]));
        continue;
      }
      if (w > 300 && h > 300 && words.length === 0 && !crossed.length) issue("check", 4, "A closed shape " + fmt(w) + " × " + fmt(h) + " at " + fmt(a[0]) + ", " + fmt(a[1]) + " has nothing saying what it is; left out.", [r.id]);
      else if (w > 300 && h > 300 && all && !CALLOUT_HINT.test(all)) issue("check", 4, "A closed shape at " + fmt(a[0]) + ", " + fmt(a[1]) + " is labelled \"" + all.slice(0, 40) + "\", which is not an opening, set-down or step; left out.", ids);
    }
    if (!openings.length && !setdowns.length && !step) lines.push("No openings, set-downs or steps");
    if (columns) lines.push(columns + " columns on grid intersections (seen; the engine does not draw them from a drawing yet)");
    steps.push({ n: 4, title: "Find openings, set-downs and steps", status: status(4), lines });
  }

  // ---------- 5 general notes: slab thickness, cover, concrete strength, laps
  const notes: { thickness: number | null; cover: number | null; fc: number | null; lap: number | null } = { thickness: null, cover: null, fc: null, lap: null };
  {
    const lines: string[] = [];
    const pool = texts.filter(t => !used.has(t.id));
    const hits = (re: RegExp, filter: (t: Text) => boolean = () => true) => {
      const out: { v: number; t: Text }[] = [];
      for (const t of pool) {
        if (!filter(t)) continue;
        for (const line of up(t.text).split("\n").length > 1 ? t.text.split("\n").map(up) : [up(t.text)]) {
          if (re.global) { re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = re.exec(line))) { const v = firstNum(m); if (v !== null) out.push({ v, t }); } }
          else { const m = re.exec(line); const v = m ? firstNum(m) : null; if (v !== null) out.push({ v, t }); }
        }
      }
      return out;
    };
    const decide = (key: "thickness" | "cover" | "fc" | "lap", label: string, unit: string, h: { v: number; t: Text }[], prefer?: (t: Text) => boolean) => {
      if (values[key] !== undefined) { notes[key] = values[key]; lines.push(label + ": " + values[key] + " " + unit + " (typed in)"); return; }
      let pick = h;
      if (prefer && h.some(x => prefer(x.t))) pick = h.filter(x => prefer(x.t));
      const distinct = [...new Set(pick.map(x => x.v))];
      if (distinct.length === 1) {
        notes[key] = distinct[0];
        lines.push(label + ": " + distinct[0] + " " + unit);
        found.push({ kind: "note", label: label + " " + distinct[0], ids: pick.map(x => x.t.id), sure: true });
        pick.forEach(x => used.add(x.t.id));
      } else if (distinct.length > 1) {
        missing.push({ key, label, unit, options: distinct });
        issue("check", 5, "The drawing gives more than one " + label.toLowerCase() + " (" + distinct.join(", ") + "); the engine uses one for the slab. Pick it.", pick.map(x => x.t.id));
      } else {
        missing.push({ key, label, unit });
        issue("check", 5, label + " is not on the drawing; type it in.");
      }
    };
    const notBalcony = (t: Text) => !balconies.some(b => inBox(boxCentre(boxOf(t.box)), b.box));
    decide("thickness", "Slab thickness", "mm", hits(THK_RE, t => notBalcony(t) && !OPENING_WORDS.test(up(t.text)) && !SETDOWN_RE.test(up(t.text))), t => /\bSLAB\b/.test(up(t.text)));
    decide("cover", "Cover", "mm", hits(COVER_RE));
    decide("fc", "Concrete strength f'c", "MPa", hits(FC_RE));
    decide("lap", "Lap length", "mm", hits(LAP_RE));
    if (notes.lap === null && missing.some(m => m.key === "lap")) issue("check", 5, "A lap table by bar size is not read yet; give one lap length for now.");
    steps.push({ n: 5, title: "Read the general notes", status: status(5), lines });
  }

  // ---------- 6 reinforcement callouts: parse every text in the callout grammar; layer, direction, extent
  interface Call { t: Text; text: string; c: Callout; ids: string[]; extent: { ids: string[]; cover: number } | null; where: "plan" | "notes" }
  const mats: Call[] = [];
  const calloutLines: string[] = [];
  {
    const lines: string[] = [];
    const callTexts: { t: Text; text: string }[] = [];
    for (const t of texts) {
      if (used.has(t.id)) continue;
      const T = up(t.text);
      if (CONCRETE_WORDS.test(T)) continue;
      const ls = t.text.split("\n").map(up).filter(Boolean);
      const designations = (T.match(/\b(?:\d+\s*[-X]?\s*)?[NRSW]\s?\d{1,2}\b|\b(?:SL|RL)\s?\d{2,4}\b/g) ?? []).length;
      if (ls.length > 1 && designations <= 1) callTexts.push({ t, text: ls.join(" ") });
      else ls.forEach(l => callTexts.push({ t, text: l }));
    }
    const pieceIds = new Set<string>();
    for (const { t, text } of callTexts) {
      const c = parseCallout(text, { scheme: "TB" });
      if (c.error || !c.kind || c.kind === "thickness") continue;
      if (c.kind === "bar" && c.spacing === null && !c.role && !c.count) continue;   // a bar size on its own (e.g. a mark) is not a callout
      const ids = [t.id];
      const tcentre = boxCentre(boxOf(t.box));
      const balc = balconies.find(b => inBox(tcentre, b.box));
      if (balc) {
        found.push({ kind: "callout", label: text + "  (" + balc.name.toLowerCase() + ")", ids, sure: false });
        issue("check", 6, "\"" + text + "\" on the " + balc.name.toLowerCase() + ": read, but the engine details balcony bars itself for now, not from the drawing.", ids);
        used.add(t.id);
        continue;
      }
      const inPlan = inBox(tcentre, slabBox, 0);
      const call: Call = { t, text, c, ids, extent: null, where: inPlan ? "plan" : "notes" };
      if (c.role && c.role !== "distribution") {
        found.push({ kind: "callout", label: text, ids, sure: false });
        issue("check", 6, "\"" + text + "\" (" + c.role + " bars): read, but the engine adds " + c.role + " bars by its own details for now, not from the drawing.", ids);
        used.add(t.id);
        continue;
      }
      if (c.kind === "bar" && c.spacing === null) continue;
      // the extent: a distribution line across the bars next to the callout (or leadered to it)
      if (inPlan) {
        const dir = c.direction;
        const across = (s: (typeof segs)[number]) => dir === "X" ? isVertical(s.a, s.b, 2) : dir === "Y" ? isHorizontal(s.a, s.b, 2) : isVertical(s.a, s.b, 2) || isHorizontal(s.a, s.b, 2);
        const tb = boxOf(t.box), tc = boxCentre(tb);
        // a distribution line is drawn solid (dashed lines are beams, walls, hidden edges), usually with end ticks
        const tickIds = (s: (typeof segs)[number]) => segs.filter(q => q !== s && dist(q.a, q.b) < Math.max(400, 0.1 * dist(s.a, s.b)) && [s.a, s.b].some(p => segDist(p, q.a, q.b) < 30)).map(q => q.id);
        const near = segs.filter(s => !used.has(s.id) && across(s) && dist(s.a, s.b) >= 1000 && !isDashed(s.e.linetype))
          .map(s => ({ s, d: Math.min(segDist(tc, s.a, s.b), segDist([tb.x0, tb.y0], s.a, s.b), segDist([tb.x1, tb.y1], s.a, s.b), segDist([tb.x0, tb.y1], s.a, s.b), segDist([tb.x1, tb.y0], s.a, s.b)), ticks: tickIds(s) }))
          .filter(x => x.d <= Math.max(3 * t.h, 500)).sort((p, q) => (q.ticks.length >= 2 ? 1 : 0) - (p.ticks.length >= 2 ? 1 : 0) || p.d - q.d);
        const viaLeader = leaders.find(l => leaderText.get(l.id) === t);
        const hit = (viaLeader ? segs.find(s => across(s) && !isDashed(s.e.linetype) && segDist(viaLeader.pts[0], s.a, s.b) < 20) : undefined) ?? near[0]?.s;
        if (near.length > 1 && !viaLeader && (near[0].ticks.length >= 2) === (near[1].ticks.length >= 2) && near[1].d < near[0].d * 1.5) issue("check", 6, "\"" + text + "\" is close to two distribution lines; took the nearer one.", [t.id, near[0].s.id, near[1].s.id]);
        if (hit) {
          const ticks = tickIds(hit);
          const L = isVertical(hit.a, hit.b, 2) ? Math.abs(hit.a[1] - hit.b[1]) : Math.abs(hit.a[0] - hit.b[0]);
          const S = isVertical(hit.a, hit.b, 2) ? boxH(slabBox) : boxW(slabBox);
          call.extent = { ids: [hit.id, ...ticks, ...(viaLeader ? [viaLeader.id] : [])], cover: L / S };
          call.ids.push(...call.extent.ids);
          [hit.id, ...ticks].forEach(i => pieceIds.add(i));
        }
      }
      mats.push(call);
    }
    pieceIds.forEach(i => used.add(i));
    mats.forEach(m => used.add(m.t.id));

    // layers: T1 / T2 / B1 / B2 directly; a lone T or B is the outer layer of that face; two T (or B) without numbers cannot be placed
    const byFace = (pos: string) => mats.filter(m => m.c.kind === "bar" && m.c.position === pos && !m.c.layer);
    for (const pos of ["T", "B"]) {
      const loose = byFace(pos), numbered = mats.filter(m => m.c.kind === "bar" && m.c.layer?.[0] === pos);
      const distinct = [...new Set(loose.map(m => norm(m.c)))];
      if (distinct.length === 1 && !numbered.length) loose.forEach(m => { m.c = { ...m.c, layer: pos + "1" }; });
      else if (loose.length) loose.forEach(m => issue("error", 6, "\"" + m.text + "\": say which " + (pos === "T" ? "top" : "bottom") + " layer, " + pos + "1 (outer) or " + pos + "2 (inner); the drawing has more than one " + (pos === "T" ? "top" : "bottom") + " mat.", m.ids));
    }
    const chosen = new Map<string, Call[]>();   // engine layer → callouts for it
    const meshes: Call[] = [];
    for (const m of mats) {
      const c = m.c;
      const dirErr = matDirectionError(c.direction);
      if (dirErr) { issue("error", 6, "\"" + m.text + "\": " + dirErr, m.ids); continue; }
      if (c.position === "EF" || c.position === "TB") { issue("error", 6, "\"" + m.text + "\": one line covers two layers; write one callout per layer (T1, T2, B1, B2).", m.ids); continue; }
      if (m.where === "plan" && !m.extent) issue("check", 6, "\"" + m.text + "\" has no distribution line next to it; taken as the whole slab.", m.ids);
      if (m.extent && m.extent.cover < 0.9) {
        issue("error", 6, "\"" + m.text + "\" covers only part of the slab (" + Math.round(m.extent.cover * 100) + " % of its width); the engine lays one mat per layer over the whole slab for now, so it is not built.", m.ids);
        continue;
      }
      if (c.kind === "mesh") { meshes.push(m); continue; }
      const L = c.layer && LAYER_OF[c.layer];
      if (!L) { if (!issues.some(i => i.ids[0] === m.ids[0] && i.step === 6)) issue("error", 6, "\"" + m.text + "\": no layer (T1, T2, B1 or B2).", m.ids); continue; }
      if (!chosen.has(L)) chosen.set(L, []);
      chosen.get(L)!.push(m);
    }
    for (const L of ["A", "B", "C", "D"]) {
      const list = chosen.get(L);
      if (!list) continue;
      const kinds = [...new Set(list.map(m => norm(m.c)))];
      if (kinds.length > 1) issue("error", 6, "Layer " + L + " has different callouts (" + kinds.join("; ") + "); the engine lays one mat per layer over the whole slab for now. Built with the first; check the drawing.", list.flatMap(m => m.ids));
      const c = list[0].c;
      calloutLines.push(String(c.type) + c.size + "-" + c.spacing + " " + L + " " + (c.direction === "X" ? "E-W" : "N-S"));
      list.forEach(m => found.push({ kind: "callout", label: m.text + "  →  layer " + L, ids: m.ids, sure: !!m.extent || m.where === "notes" }));
      lines.push("Layer " + L + " (" + ({ A: "B1", B: "B2", C: "T2", D: "T1" } as Record<string, string>)[L] + "): " + c.type + c.size + "-" + c.spacing + " " + (c.direction === "X" ? "E-W" : "N-S") + " · from " + (list.length > 1 ? list.length + " callouts" : list[0].where === "notes" ? "the notes" : "the plan") + (list[0].extent ? ", distribution line across " + Math.round(list[0].extent.cover * 100) + " % of the slab" : ""));
      // count check: a stated count against the distribution line
      for (const m of list) {
        if (!m.c.count || !m.extent || !m.c.spacing) continue;
        const spanAcross = m.c.direction === "X" ? boxH(slabBox) : boxW(slabBox);
        const cov = notes.cover ?? 0, derived = Math.floor((spanAcross * m.extent.cover - 2 * cov) / m.c.spacing) + 1;
        if (Math.abs(derived - m.c.count) > 1) issue("check", 6, "\"" + m.text + "\": " + m.c.count + " bars stated, but " + m.c.spacing + " centres over the distribution line gives about " + derived + ".", m.ids);
      }
    }
    for (const m of meshes) {
      const pos = m.c.position === "T" || m.c.position === "B" ? m.c.position : m.c.layer?.[0];
      if (!pos) { issue("error", 6, "\"" + m.text + "\": say top or bottom (T or B).", m.ids); continue; }
      calloutLines.push(m.c.mesh + " " + pos + " " + (m.c.direction === "X" ? "E-W" : "N-S"));
      found.push({ kind: "callout", label: m.text + "  →  " + (pos === "T" ? "top" : "bottom") + " mesh", ids: m.ids, sure: true });
      lines.push((pos === "T" ? "Top" : "Bottom") + " mesh " + m.c.mesh + ", long wires " + (m.c.direction === "X" ? "E-W" : "N-S"));
    }
    if (!calloutLines.length) issue("error", 6, "No slab mats read: each needs a callout like N12-200 T1 E-W (size, spacing, layer, direction).");
    for (const m of mats) if (m.extent) found.push({ kind: "extent", label: "Extent of " + m.text, ids: m.extent.ids, sure: true });
    steps.push({ n: 6, title: "Read the reinforcement callouts", status: status(6), lines });
  }

  // ---------- 7 check: everything the engine needs is there; anything left unread is said
  {
    const lines: string[] = [];
    const leftover = texts.filter(t => !used.has(t.id) && CALLOUT_HINT.test(up(t.text)) && !CONCRETE_WORDS.test(up(t.text)));
    if (leftover.length) issue("check", 7, leftover.length + " text(s) look like reinforcement but could not be read: " + leftover.slice(0, 4).map(t => "\"" + t.text.replace(/\n/g, " ") + "\"").join(", ") + (leftover.length > 4 ? " …" : ""), leftover.map(t => t.id));
    // the grid spacings against any dimensions drawn between grid lines
    const dims = E.filter((e): e is Extract<Entity, { kind: "dim" }> => e.kind === "dim");
    let agree = 0, disagree = 0;
    for (const d of dims) {
      const onGrid = (p: Pt) => gridV.some(g => Math.abs(g.x - p[0]) < 2) || gridH.some(g => Math.abs(g.y - p[1]) < 2);
      if (!onGrid(d.p1) || !onGrid(d.p2)) continue;
      const shown = parseFloat(d.text.replace(/[^\d.]/g, ""));
      if (!Number.isFinite(shown)) continue;
      if (Math.abs(shown - d.measured) <= Math.max(2, 0.002 * shown)) agree++; else disagree++;
    }
    if (agree) lines.push(agree + " grid dimension(s) agree with the drawn grid spacing");
    if (disagree) issue("check", 7, disagree + " dimension(s) show a different number from the distance drawn (the drawing may not be to scale there).");
    if (missing.length) lines.push(missing.length + " value(s) to type in before building: " + missing.map(m => m.label.toLowerCase()).join(", "));
    steps.push({ n: 7, title: "Check", status: status(7), lines });
  }

  // ---------- 8 build: the engine's input, and the engine's own check of it
  // the grids, the slab edge and at least one mat must be there; other errors are listed and the rest is built
  const blocked = issues.some(i => i.level === "error" && i.step <= 3) || !calloutLines.length;
  if (blocked || missing.length || notes.thickness === null || notes.cover === null || notes.fc === null || notes.lap === null) {
    steps.push({ n: 8, title: "Build", status: blocked ? "error" : "check", lines: [blocked ? "Not built: fix the errors above first." : "Waiting for the values above."] });
    return finish(null, origin);
  }
  const input: FloorInput = {
    name: opts.name || drawingTitle(texts) || "Floor from drawing",
    gridX: gridV.map(g => Math.round(g.x - origin[0])),
    gridY: gridH.map(g => Math.round(g.y - origin[1])),
    overhang,
    thickness: notes.thickness, cover: notes.cover, fc: notes.fc, lap: notes.lap,
    callouts: calloutLines.join("\n"),
    features: { beams: false, columns: false, drop: setdowns.length > 0, step: !!step, balcony: balconies.length > 0, openings: openings.length > 0, extras: false, edges: false, stair: false },
    scheme: "ABCD",
    openings, setdowns,
    balconies: balconies.map(b => ({ name: b.name, edge: b.edge, from: b.from, to: b.to, proj: b.proj, thk: b.thk ?? 0, down: b.down ?? 0 })),
    ...(step ? { step } : {}),
    gridLabels: { across: gridV.map(g => g.label), up: gridH.map(g => g.label) }
  };
  let engine: PlanReading["engine"] = null;
  try {
    const M = buildModel(input);
    engine = { errors: M.errors, warnings: M.warnings, bars: M.bars.filter(b => !b.existing).length, kg: Math.round(M.kg) };
    M.errors.forEach(e => issue("error", 8, "Engine: " + e));
  } catch (e) { issue("error", 8, "Engine failed: " + (e as Error).message); }
  steps.push({ n: 8, title: "Build", status: status(8), lines: engine ? [engine.errors.length ? "The engine found " + engine.errors.length + " error(s) in what was read." : fmt(engine.bars) + " bars, " + fmt(engine.kg) + " kg"] : [] });
  return finish(input, origin, engine);
}

const CALLOUT_HINT = /\b(?:\d+\s*[-X]?\s*)?[NR]\s?(10|12|16|20|24|28|32|36|40)\b|\b(?:SL|RL)\s?\d{2,4}\b/;
const norm = (c: Callout) => (c.kind === "mesh" ? c.mesh : c.type + "" + c.size + "-" + c.spacing) + " " + (c.layer ?? c.position ?? "") + " " + (c.direction ?? "");
function firstNum(m: RegExpExecArray): number | null { for (let i = 1; i < m.length; i++) if (m[i] !== undefined) return +m[i]; return null; }
function matchAny(s: string, res: RegExp[]): number | null { for (const re of res) { const v = matchNum(s, re); if (v !== null) return v; } return null; }
function matchNum(s: string, re: RegExp): number | null { const r = new RegExp(re.source, re.flags.replace("g", "")); const m = r.exec(s); return m ? firstNum(m) : null; }
function cleanName(s: string): string { return s.replace(/\b\d{1,4}\s*(?:MM)?\b/g, " ").replace(/\b(?:DEEP|DEPTH|THK|BELOW|FFL|SSL|U\.?N\.?O\.?)\b/g, " ").replace(/[^A-Z0-9 ./-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40); }
function cmpLabel(a: string, b: string): number {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return +a - +b;
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}
function drawingTitle(texts: Text[]): string | null {
  const t = texts.map(t => up(t.text)).find(s => /\b(LEVEL|LVL|GROUND|FIRST|SECOND|ROOF|PODIUM|SUSPENDED)\b.*\b(SLAB|FLOOR|PLAN)\b|\b(SLAB|FLOOR)\b.*\bPLAN\b/.test(s) && s.length < 60);
  return t ? t.replace(/\s*(?:REINFORCEMENT|REO)?\s*PLAN\b.*$/, "").trim() || t : null;
}
