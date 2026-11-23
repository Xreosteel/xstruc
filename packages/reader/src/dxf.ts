// DXF reader (research/04): the file's model space as a Sheet in millimetres. Written in-house (the complete
// JavaScript DXF parsers are GPL-3; research/04 §4.1). ASCII DXF R12–R2018. Reads LINE, LWPOLYLINE (bulges),
// POLYLINE/VERTEX, CIRCLE, ARC, TEXT, MTEXT, ATTRIB, INSERT/MINSERT (exploded, nested), DIMENSION, LEADER and HATCH
// boundaries; everything else is counted in stats.skipped. Never throws on a damaged file: it returns what it read
// with a warning. Pure: no DOM, no network.
import type { Entity, Layer, Pt, Sheet, Text } from "./sheet.ts";
import { arcPoints, boxOf } from "./geom.ts";

type Pair = [number, string];
interface Rec { type: string; pairs: Pair[] }
/** 2D affine map (x, y) → (a·x + c·y + e, b·x + d·y + f). */
type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const ap = (m: M, p: Pt): Pt => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const det = (m: M) => m[0] * m[3] - m[1] * m[2];
const MIRROR_X: M = [-1, 0, 0, 1, 0, 0];
const DEG = Math.PI / 180;

const UNITS: Record<number, [string, number]> = { 1: ["inches", 25.4], 2: ["feet", 304.8], 4: ["millimetres", 1], 5: ["centimetres", 10], 6: ["metres", 1000] };

/** Decodes DXF bytes: UTF-8 from R2007 (AC1021) on, else the file's code page (Windows-1252 for the usual ANSI_1252). */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  if (head.startsWith("AutoCAD Binary DXF")) throw new Error("This is a binary DXF. Save it as an ASCII DXF (R2000 to R2018) and try again.");
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? "";
  if (ver >= "AC1021") return new TextDecoder("utf-8").decode(bytes);
  return new TextDecoder("windows-1252").decode(bytes);
}

function tokenise(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i -= 1; continue; }   // stray line: resynchronise on the next line
    out.push([code, lines[i + 1]]);
  }
  return out;
}

/** Splits a section's pairs into records, each starting at a group-0 pair. */
function records(pairs: Pair[]): Rec[] {
  const out: Rec[] = [];
  let cur: Rec | null = null;
  for (const p of pairs) {
    if (p[0] === 0) { cur = { type: p[1].trim(), pairs: [] }; out.push(cur); } else if (cur) cur.pairs.push(p);
  }
  return out;
}

const num = (r: Rec, code: number, dflt = 0): number => { const p = r.pairs.find(q => q[0] === code); const v = p ? parseFloat(p[1]) : NaN; return Number.isFinite(v) ? v : dflt; };
const str = (r: Rec, code: number, dflt = ""): string => { const p = r.pairs.find(q => q[0] === code); return p ? p[1].trim() : dflt; };
const has = (r: Rec, code: number) => r.pairs.some(q => q[0] === code);

/** MTEXT inline codes → plain text (research/04 §4.3 step 7). */
export function plainMtext(raw: string): string {
  let s = raw.replace(/\\\\/g, "\u0000").replace(/\\\{/g, "\u0001").replace(/\\\}/g, "\u0002");   // escaped \ { }
  s = s.replace(/\\P/g, "\n").replace(/\\~/g, " ");
  s = s.replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, "$1/$2");          // stacked fractions
  s = s.replace(/\\[ACcFfHhQTWp][^;]*;/g, "");                    // codes with an argument, ended by ;
  s = s.replace(/\\[LlOoKkX]/g, "");                              // on/off codes without an argument
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\u0000/g, "\\").replace(/\u0001/g, "{").replace(/\u0002/g, "}");
  return plainText(s);
}
/** TEXT control codes (%%d %%c %%p %%u %%o, \U+XXXX) → plain text. */
export function plainText(raw: string): string {
  return raw
    .replace(/%%[dD]/g, "°").replace(/%%[cC]/g, "Ø").replace(/%%[pP]/g, "±").replace(/%%[uUoOkK]/g, "").replace(/%%%/g, "%")
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t]+\n/g, "\n").trim();
}

interface Ctx { m: M; blocks: string[]; layer: string | null; color: number; linetype: string; idPrefix: string; depth: number }

export function readDxf(input: string, opts: { chordTol?: number } = {}): Sheet {
  const chordTol = opts.chordTol ?? 2;
  const warnings: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (t: string) => { skipped[t] = (skipped[t] ?? 0) + 1; };
  const pairs = tokenise(input);
  if (!pairs.length) return emptySheet(["The file is empty or not a DXF."]);

  // sections
  const sections = new Map<string, Pair[]>();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === "SECTION" && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].trim(), body: Pair[] = [];
      let j = i + 2;
      for (; j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1].trim() === "ENDSEC"); j++) body.push(pairs[j]);
      sections.set(name, body); i = j;
    }
  }
  if (!sections.has("ENTITIES")) warnings.push("No ENTITIES section: the file may be damaged or not a DXF.");

  // header
  const header = new Map<string, Pair[]>();
  { let cur = ""; for (const p of sections.get("HEADER") ?? []) { if (p[0] === 9) { cur = p[1].trim(); header.set(cur, []); } else if (cur) header.get(cur)!.push(p); } }
  const hv = (name: string, code: number): string | undefined => header.get(name)?.find(p => p[0] === code)?.[1].trim();
  const version = hv("$ACADVER", 1) ?? "";
  const insunits = parseInt(hv("$INSUNITS", 70) ?? "0", 10) || 0;

  // layers
  const layers = new Map<string, Layer>();
  for (const r of records(sections.get("TABLES") ?? [])) {
    if (r.type !== "LAYER") continue;
    const name = str(r, 2); if (!name) continue;
    const c = num(r, 62, 7), flags = num(r, 70, 0);
    layers.set(name, { name, color: Math.abs(c) || 7, off: c < 0, frozen: (flags & 1) === 1, linetype: str(r, 6, "CONTINUOUS").toUpperCase() });
  }
  const layerOf = (n: string): Layer => { let l = layers.get(n); if (!l) { l = { name: n, color: 7, off: false, frozen: false, linetype: "CONTINUOUS" }; layers.set(n, l); } return l; };

  // blocks
  const blocks = new Map<string, { base: Pt; recs: Rec[]; xref: boolean }>();
  { let cur: { name: string; base: Pt; recs: Rec[]; xref: boolean } | null = null;
    for (const r of records(sections.get("BLOCKS") ?? [])) {
      if (r.type === "BLOCK") { cur = { name: str(r, 2), base: [num(r, 10), num(r, 20)], recs: [], xref: (num(r, 70) & 4) === 4 }; }
      else if (r.type === "ENDBLK") { if (cur) blocks.set(cur.name, { base: cur.base, recs: cur.recs, xref: cur.xref }); cur = null; }
      else if (cur) cur.recs.push(r);
    }
  }

  const entities: Entity[] = [];
  let exploded = 0, paperSpace = 0, seq = 0;

  const resolve = (r: Rec, ctx: Ctx) => {
    let layer = str(r, 8, "0");
    if (layer === "0" && ctx.layer) layer = ctx.layer;
    const L = layerOf(layer);
    let color = has(r, 62) ? num(r, 62) : 256;
    if (color === 256) color = L.color; else if (color === 0) color = ctx.color || 7;
    let lt = str(r, 6, "BYLAYER").toUpperCase();
    if (lt === "BYLAYER") lt = L.linetype; else if (lt === "BYBLOCK") lt = ctx.linetype || "CONTINUOUS";
    const h = str(r, 5) || "n" + ++seq;
    return { id: ctx.idPrefix + h, layer, color: Math.abs(color), linetype: lt, blocks: ctx.blocks };
  };
  // the object coordinate system: plan drawings only use +Z or the mirrored −Z extrusion
  const ocs = (r: Rec): M | null => {
    const nx = num(r, 210), ny = num(r, 220), nz = num(r, 230, 1);
    if (Math.abs(nx) < 1 / 64 && Math.abs(ny) < 1 / 64) return nz < 0 ? MIRROR_X : I;
    return null;
  };

  const emitText = (r: Rec, ctx: Ctx, kind: "TEXT" | "ATTRIB", m: M) => {
    const raw = str(r, 1); if (!raw.trim()) return;
    const h0 = num(r, 40, 2.5), rot0 = num(r, 50, 0), wf = num(r, 41, 1) || 1;
    const ha = num(r, 72, 0), va = num(r, 73 + (kind === "ATTRIB" ? 1 : 0), 0);
    const aligned = ha !== 0 || va !== 0;
    const p0: Pt = aligned && has(r, 11) ? [num(r, 11), num(r, 21)] : [num(r, 10), num(r, 20)];
    const text = plainText(raw);
    const w = 0.8 * h0 * wf * Math.max(...text.split("\n").map(l => l.length));
    const ax = ha === 1 || ha === 4 ? 0.5 : ha === 2 ? 1 : 0;
    const vy0 = ha === 4 || va === 2 ? -h0 / 2 : va === 3 ? -h0 : 0;
    pushText(raw, text, p0, h0, rot0, [-ax * w, vy0], [(1 - ax) * w, vy0 + h0], kind, r, ctx, m);
  };
  const emitMtext = (r: Rec, ctx: Ctx, m: M) => {
    const raw = r.pairs.filter(p => p[0] === 3).map(p => p[1]).join("") + str(r, 1);
    if (!raw.trim()) return;
    const h0 = num(r, 40, 2.5), att = num(r, 71, 1) || 1, refW = num(r, 41, 0);
    const rot0 = has(r, 11) ? Math.atan2(num(r, 21), num(r, 11)) / DEG : num(r, 50, 0);
    const text = plainMtext(raw);
    const lines = text.split("\n");
    let w = 0.8 * h0 * Math.max(...lines.map(l => l.length));
    if (refW > 0 && w > refW) w = refW;
    const H = h0 * (1 + (lines.length - 1) * 1.667);
    const ax = [0, 0.5, 1][(att - 1) % 3], row = Math.floor((att - 1) / 3);
    const y1 = row === 0 ? 0 : row === 1 ? H / 2 : H;
    pushText(raw, text, [num(r, 10), num(r, 20)], h0, rot0, [-ax * w, y1 - H], [(1 - ax) * w, y1], "MTEXT", r, ctx, m);
  };
  const pushText = (raw: string, text: string, p0: Pt, h0: number, rot0: number, lo: Pt, hi: Pt, src: Text["src"], r: Rec, ctx: Ctx, m: M) => {
    const ca = Math.cos(rot0 * DEG), sa = Math.sin(rot0 * DEG);
    const local = (x: number, y: number): Pt => ap(m, [p0[0] + x * ca - y * sa, p0[1] + x * sa + y * ca]);
    const corners = [local(lo[0], lo[1]), local(hi[0], lo[1]), local(hi[0], hi[1]), local(lo[0], hi[1])];
    const b = boxOf(corners);
    const xAxis: Pt = [m[0] * ca + m[2] * sa, m[1] * ca + m[3] * sa];
    const sy = Math.hypot(m[2], m[3]);
    entities.push({ ...resolve(r, ctx), kind: "text", text, raw, p: ap(m, p0), h: h0 * sy, rot: norm360(Math.atan2(xAxis[1], xAxis[0]) / DEG), box: [[b.x0, b.y0], [b.x1, b.y1]], src });
  };

  const bulgePts = (verts: { p: Pt; b: number }[], closed: boolean): Pt[] => {
    const out: Pt[] = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const v = verts[i];
      out.push(v.p);
      const nextI = i + 1 < n ? i + 1 : closed ? 0 : -1;
      if (nextI < 0 || !v.b) continue;
      const p1 = v.p, p2 = verts[nextI].p, d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (d < 1e-9) continue;
      const b = v.b, mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
      const k = (d * (1 - b * b)) / (4 * b), nx = -(p2[1] - p1[1]) / d, ny = (p2[0] - p1[0]) / d;
      const c: Pt = [mx + nx * k, my + ny * k], r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
      const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]) / DEG, sweep = (4 * Math.atan(b)) / DEG;
      const pts = b > 0 ? arcPoints(c, r, a1, a1 + sweep, chordTol) : arcPoints(c, r, a1 + sweep, a1, chordTol).reverse();
      out.push(...pts.slice(1, -1));
    }
    return out;
  };

  const emit = (recs: Rec[], ctx: Ctx) => {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (num(r, 67) === 1 && ctx.depth === 0) { paperSpace++; continue; }
      const o = ocs(r);
      if (!o) { skip(r.type + " (tilted 3D)"); continue; }
      const m = mul(ctx.m, o);
      switch (r.type) {
        case "LINE": entities.push({ ...resolve(r, ctx), kind: "line", a: ap(ctx.m, [num(r, 10), num(r, 20)]), b: ap(ctx.m, [num(r, 11), num(r, 21)]) }); break;
        case "LWPOLYLINE": {
          const verts: { p: Pt; b: number }[] = [];
          for (const p of r.pairs) {
            if (p[0] === 10) verts.push({ p: [parseFloat(p[1]), 0], b: 0 });
            else if (p[0] === 20 && verts.length) verts[verts.length - 1].p[1] = parseFloat(p[1]);
            else if (p[0] === 42 && verts.length) verts[verts.length - 1].b = parseFloat(p[1]) || 0;
          }
          const closed = (num(r, 70) & 1) === 1;
          if (verts.length >= 2) entities.push({ ...resolve(r, ctx), kind: "pline", pts: bulgePts(verts, closed).map(p => ap(m, p)), closed });
          break;
        }
        case "POLYLINE": {
          const flags = num(r, 70), verts: { p: Pt; b: number }[] = [];
          let j = i + 1;
          for (; j < recs.length && recs[j].type === "VERTEX"; j++) { if (num(recs[j], 70) & 16) continue; verts.push({ p: [num(recs[j], 10), num(recs[j], 20)], b: num(recs[j], 42) }); }
          if (recs[j]?.type === "SEQEND") j++;
          i = j - 1;
          if (flags & (16 | 64)) { skip("POLYLINE (mesh)"); break; }
          const closed = (flags & 1) === 1;
          if (verts.length >= 2) entities.push({ ...resolve(r, ctx), kind: "pline", pts: bulgePts(verts, closed).map(p => ap(flags & 8 ? ctx.m : m, p)), closed });
          break;
        }
        case "CIRCLE": case "ARC": {
          const c: Pt = [num(r, 10), num(r, 20)], rr = num(r, 40);
          const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
          if (Math.abs(sx - sy) > 1e-6 * Math.max(sx, sy)) {   // stretched: an ellipse, kept as points
            const pts = r.type === "CIRCLE" ? arcPoints(c, rr, 0, 360, chordTol).slice(0, -1) : arcPoints(c, rr, num(r, 50), num(r, 51), chordTol);
            entities.push({ ...resolve(r, ctx), kind: "pline", pts: pts.map(p => ap(m, p)), closed: r.type === "CIRCLE" });
            break;
          }
          if (r.type === "CIRCLE") { entities.push({ ...resolve(r, ctx), kind: "circle", c: ap(m, c), r: rr * sx }); break; }
          const a0 = num(r, 50), a1 = num(r, 51), C = ap(m, c);
          const s = ap(m, [c[0] + rr * Math.cos(a0 * DEG), c[1] + rr * Math.sin(a0 * DEG)]), e = ap(m, [c[0] + rr * Math.cos(a1 * DEG), c[1] + rr * Math.sin(a1 * DEG)]);
          const ang = (p: Pt) => norm360(Math.atan2(p[1] - C[1], p[0] - C[0]) / DEG);
          entities.push({ ...resolve(r, ctx), kind: "arc", c: C, r: rr * sx, ...(det(m) < 0 ? { a0: ang(e), a1: ang(s) } : { a0: ang(s), a1: ang(e) }) });
          break;
        }
        case "TEXT": emitText(r, ctx, "TEXT", m); break;
        case "ATTRIB": emitText(r, ctx, "ATTRIB", m); break;
        case "MTEXT": emitMtext(r, ctx, ctx.m); break;
        case "INSERT": {
          const name = str(r, 2), blk = blocks.get(name);
          const attribs: Rec[] = [];
          let j = i + 1;
          if (num(r, 66) === 1) { for (; j < recs.length && recs[j].type === "ATTRIB"; j++) attribs.push(recs[j]); if (recs[j]?.type === "SEQEND") j++; }
          i = j - 1;
          const head = resolve(r, ctx);
          for (const a of attribs) emitText(a, { ...ctx, layer: head.layer }, "ATTRIB", mul(ctx.m, ocs(a) ?? I));
          if (!blk) { skip("INSERT of a missing block"); break; }
          if (blk.xref) { skip("INSERT of an external reference"); break; }
          if (ctx.depth >= 8 || ctx.blocks.includes(name)) { warnings.push("Block " + name + " is nested too deep or inside itself; not drawn."); break; }
          const sx = num(r, 41, 1) || 1, sy = num(r, 42, 1) || 1, rot = num(r, 50) * DEG;
          const cols = Math.max(1, num(r, 70, 1)), rows = Math.max(1, num(r, 71, 1)), cs = num(r, 44), rs = num(r, 45);
          const ins: Pt = [num(r, 10), num(r, 20)];
          for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
            const off: Pt = [ins[0] + (ci * cs * Math.cos(rot) - ri * rs * Math.sin(rot)), ins[1] + (ci * cs * Math.sin(rot) + ri * rs * Math.cos(rot))];
            const local: M = mul(mul([1, 0, 0, 1, off[0], off[1]], [Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), 0, 0]), [sx, 0, 0, sy, -sx * blk.base[0], -sy * blk.base[1]]);
            exploded++;
            emit(blk.recs.filter(b => b.type !== "ATTDEF"), {
              m: mul(m, local), blocks: [...ctx.blocks, name], layer: head.layer, color: head.color, linetype: head.linetype,
              idPrefix: head.id + (cols * rows > 1 ? "[" + ci + "," + ri + "]" : "") + "/", depth: ctx.depth + 1
            });
          }
          break;
        }
        case "DIMENSION": {
          const p1 = ap(m, [num(r, 13), num(r, 23)]), p2 = ap(m, [num(r, 14), num(r, 24)]), at = ap(m, [num(r, 10), num(r, 20)]);
          const type = num(r, 70) & 7;
          if (type > 1) { skip("DIMENSION (angular, radial or ordinate)"); break; }
          const a = num(r, 50) * DEG;
          const measured = has(r, 42) ? num(r, 42) : type === 0 ? Math.abs((num(r, 14) - num(r, 13)) * Math.cos(a) + (num(r, 24) - num(r, 23)) * Math.sin(a)) : Math.hypot(num(r, 14) - num(r, 13), num(r, 24) - num(r, 23));
          const over = str(r, 1);
          const shown = !over || over.includes("<>") ? (over || "<>").replace("<>", String(Math.round(measured))) : over;
          entities.push({ ...resolve(r, ctx), kind: "dim", p1, p2, at, measured, text: plainMtext(shown) });
          break;
        }
        case "LEADER": {
          const pts: Pt[] = [];
          for (const p of r.pairs) { if (p[0] === 10) pts.push([parseFloat(p[1]), 0]); else if (p[0] === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(p[1]); }
          if (pts.length >= 2) entities.push({ ...resolve(r, ctx), kind: "leader", pts: pts.map(p => ap(ctx.m, p)), arrow: num(r, 71, 1) !== 0 });
          break;
        }
        case "HATCH": {
          const loops = hatchLoops(r, chordTol);
          if (loops.bad) skip("HATCH boundary edge (spline or ellipse)");
          if (loops.rings.length) entities.push({ ...resolve(r, ctx), kind: "hatch", loops: loops.rings.map(l => l.map(p => ap(m, p))), solid: num(r, 70) === 1, pattern: str(r, 2).toUpperCase() });
          break;
        }
        case "SEQEND": case "VERTEX": case "ATTDEF": case "VIEWPORT": break;
        default: skip(r.type);
      }
    }
  };

  emit(records(sections.get("ENTITIES") ?? []), { m: I, blocks: [], layer: null, color: 7, linetype: "CONTINUOUS", idPrefix: "", depth: 0 });

  // units: $INSUNITS, or inferred from the size of the drawing (a building plan in millimetres spans thousands)
  let unitName = "", factor = 1, inferred = false;
  if (UNITS[insunits]) {
    [unitName, factor] = UNITS[insunits];
    if (insunits === 1 || insunits === 2) warnings.push("The drawing is in " + unitName + "; converted to millimetres.");
  } else {
    const ext = extentsOf(entities.filter(e => e.kind !== "text"));
    const span = ext ? Math.max(ext.max[0] - ext.min[0], ext.max[1] - ext.min[1]) : 0;
    inferred = true;
    if (span > 0 && span < 500) { unitName = "metres"; factor = 1000; } else { unitName = "millimetres"; factor = 1; }
    warnings.push("The file does not say its units ($INSUNITS); read as " + unitName + " from the size of the drawing. Check one dimension.");
  }
  if (factor !== 1) for (const e of entities) scaleEntity(e, factor);
  if (paperSpace) warnings.push(paperSpace + " item(s) on the sheet layout (paper space) left out; only the plan (model space) is read.");
  const sk = Object.entries(skipped);
  if (sk.length) warnings.push("Not read: " + sk.map(([k, n]) => n + " × " + k).join(", ") + ".");

  return {
    source: "dxf", units: { code: insunits, name: unitName, factor, inferred }, version,
    layers: [...layers.values()], entities, extents: extentsOf(entities), warnings,
    stats: { pairs: pairs.length, entities: entities.length, exploded, skipped }
  };
}

function hatchLoops(r: Rec, chordTol: number): { rings: Pt[][]; bad: boolean } {
  const P = r.pairs, rings: Pt[][] = [];
  let i = P.findIndex(p => p[0] === 91), bad = false;
  if (i < 0) return { rings, bad };
  const nLoops = parseInt(P[i][1], 10) || 0;
  i++;
  const next = (code: number) => { while (i < P.length && P[i][0] !== code) i++; return i < P.length ? parseFloat(P[i++][1]) : NaN; };
  for (let L = 0; L < nLoops && i < P.length; L++) {
    const flags = next(92);
    if (!Number.isFinite(flags)) break;
    const ring: Pt[] = [];
    if ((flags & 2) === 2) {
      const hasBulge = next(72), n = next(93) || 0, verts: { p: Pt; b: number }[] = [];
      for (let k = 0; k < n; k++) {
        const x = next(10), y = next(20);
        let b = 0;
        if (hasBulge && P[i]?.[0] === 42) b = parseFloat(P[i++][1]) || 0;
        verts.push({ p: [x, y], b });
      }
      for (let k = 0; k < verts.length; k++) {
        ring.push(verts[k].p);
        if (verts[k].b) {
          const p1 = verts[k].p, p2 = verts[(k + 1) % verts.length].p, b = verts[k].b, d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          if (d > 1e-9) {
            const kk = (d * (1 - b * b)) / (4 * b), c: Pt = [(p1[0] + p2[0]) / 2 - ((p2[1] - p1[1]) / d) * kk, (p1[1] + p2[1]) / 2 + ((p2[0] - p1[0]) / d) * kk];
            const rr = Math.hypot(p1[0] - c[0], p1[1] - c[1]), a1 = (Math.atan2(p1[1] - c[1], p1[0] - c[0]) * 180) / Math.PI, sw = (4 * Math.atan(b) * 180) / Math.PI;
            const pts = b > 0 ? arcPoints(c, rr, a1, a1 + sw, chordTol) : arcPoints(c, rr, a1 + sw, a1, chordTol).reverse();
            ring.push(...pts.slice(1, -1));
          }
        }
      }
    } else {
      const n = next(93) || 0;
      for (let k = 0; k < n; k++) {
        const t = next(72);
        if (t === 1) { const a: Pt = [next(10), next(20)], b: Pt = [next(11), next(21)]; if (!ring.length) ring.push(a); ring.push(b); }
        else if (t === 2) {
          const c: Pt = [next(10), next(20)], rr = next(40), a0 = next(50), a1 = next(51), ccw = P[i]?.[0] === 73 ? parseFloat(P[i++][1]) : 1;
          const pts = ccw ? arcPoints(c, rr, a0, a1, chordTol) : arcPoints(c, rr, 360 - a0, 360 - a1, chordTol).map(([x, y]) => [x, 2 * c[1] - y] as Pt);
          if (ring.length) pts.shift();
          ring.push(...pts);
        } else { bad = true; break; }
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return { rings, bad };
}

const norm360 = (a: number) => ((a % 360) + 360) % 360;

function scaleEntity(e: Entity, f: number) {
  const s = (p: Pt): Pt => [p[0] * f, p[1] * f];
  switch (e.kind) {
    case "line": e.a = s(e.a); e.b = s(e.b); break;
    case "pline": e.pts = e.pts.map(s); break;
    case "circle": case "arc": e.c = s(e.c); e.r *= f; break;
    case "text": e.p = s(e.p); e.h *= f; e.box = [s(e.box[0]), s(e.box[1])]; break;
    case "dim": e.p1 = s(e.p1); e.p2 = s(e.p2); e.at = s(e.at); e.measured *= f; break;
    case "leader": e.pts = e.pts.map(s); break;
    case "hatch": e.loops = e.loops.map(l => l.map(s)); break;
  }
}

/** Every point an entity occupies, for extents and overlap tests. */
export function entityPoints(e: Entity): Pt[] {
  switch (e.kind) {
    case "line": return [e.a, e.b];
    case "pline": case "leader": return e.pts;
    case "circle": return [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]];
    case "arc": return arcPoints(e.c, e.r, e.a0, e.a1, Math.max(1, e.r / 20));
    case "text": return e.box;
    case "dim": return [e.p1, e.p2, e.at];
    case "hatch": return e.loops.flat();
  }
}

function extentsOf(es: Entity[]): { min: Pt; max: Pt } | null {
  if (!es.length) return null;
  const b = boxOf(es.flatMap(entityPoints));
  return Number.isFinite(b.x0) ? { min: [b.x0, b.y0], max: [b.x1, b.y1] } : null;
}

function emptySheet(warnings: string[]): Sheet {
  return { source: "dxf", units: { code: 0, name: "", factor: 1, inferred: true }, version: "", layers: [], entities: [], extents: null, warnings, stats: { pairs: 0, entities: 0, exploded: 0, skipped: {} } };
}
