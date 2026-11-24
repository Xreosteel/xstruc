// Vector PDF reader (research/05): one page of a CAD-plotted PDF as a Sheet in drawing millimetres, through pdf.js
// (Apache-2.0, pinned to 6.5.438: the path encoding below is that version's; the PDF tests fail loudly if it changes).
// Text runs (real fonts; SHX stroke text is a later step), stroked paths as lines and polylines, filled paths as
// solid hatches (arrowheads, solid fills). AutoCAD plots dashed linetypes as separate short strokes: they are joined
// back into one dashed line. The drawing scale comes from the sheet ("1:50") and is checked against the dimension
// figures; with none written, the scale the dimensions agree on is used. Headless: the caller passes pdf.js in.
import type { Entity, Pt, Sheet, Text } from "./sheet.ts";
import { boxOf, dist } from "./geom.ts";

/** The parts of pdf.js used here (pass `import("pdfjs-dist/legacy/build/pdf.mjs")` in Node, the app's copy in a browser). */
export interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; verbosity?: number; standardFontDataUrl?: string }): { promise: Promise<PdfDoc> };
  OPS: Record<string, number>;
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getOptionalContentConfig?(): Promise<{ getGroup(id: string): { name?: string } | null }>;
  destroy?(): Promise<void>;
}
interface PdfPage {
  view: number[];
  rotate: number;
  getTextContent(o?: { disableNormalization?: boolean }): Promise<{ items: { str?: string; transform?: number[]; width?: number; height?: number }[] }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
}

type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const ap = (m: M, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const PT = 25.4 / 72;   // millimetres per PDF point
// pdf.js 6.5 path encoding inside constructPath (DrawOPS in its source)
const D_MOVE = 0, D_LINE = 1, D_CURVE = 2, D_QUAD = 3, D_CLOSE = 4;
const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];

export interface PdfOptions { page?: number; scale?: number; standardFontDataUrl?: string }

export async function readPdf(pdfjs: PdfJs, bytes: Uint8Array, opts: PdfOptions = {}): Promise<Sheet> {
  const warnings: string[] = [];
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0, ...(opts.standardFontDataUrl ? { standardFontDataUrl: opts.standardFontDataUrl } : {}) }).promise;
  const pageNo = Math.min(Math.max(1, opts.page ?? 1), doc.numPages);
  const page = await doc.getPage(pageNo);
  const [vx0, vy0, vx1, vy1] = page.view;
  if (page.rotate) warnings.push("The page is turned " + page.rotate + "° in the PDF; read unturned.");
  let ocNames: ((id: string) => string | undefined) | null = null;
  try { const oc = await doc.getOptionalContentConfig?.(); if (oc) ocNames = id => oc.getGroup(id)?.name ?? undefined; } catch { /* no layers */ }

  // ---- paths, in page points
  const OPS = pdfjs.OPS, ops = await page.getOperatorList();
  const raw: { kind: "stroke" | "fill"; pts: Pt[]; closed: boolean; curve: boolean; rgb: string; fillRgb: string; layer: string; width: number }[] = [];
  const stack: { ctm: M; stroke: string; fill: string; width: number }[] = [];
  let st = { ctm: [1, 0, 0, 1, 0, 0] as M, stroke: "#000000", fill: "#000000", width: 1 };
  const layerStack: string[] = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i] ?? [];
    if (fn === OPS.save) stack.push({ ...st });
    else if (fn === OPS.restore) st = stack.pop() ?? st;
    else if (fn === OPS.transform) st = { ...st, ctm: mul(st.ctm, args as unknown as M) };
    else if (fn === OPS.paintFormXObjectBegin) { stack.push({ ...st }); const m = args[0] as number[] | null; if (m && m.length === 6) st = { ...st, ctm: mul(st.ctm, m as unknown as M) }; }
    else if (fn === OPS.paintFormXObjectEnd) st = stack.pop() ?? st;
    else if (fn === OPS.setStrokeRGBColor) st = { ...st, stroke: String(args[0]) };
    else if (fn === OPS.setFillRGBColor) st = { ...st, fill: String(args[0]) };
    else if (fn === OPS.setLineWidth) st = { ...st, width: Number(args[0]) || 0 };
    else if (fn === OPS.beginMarkedContentProps) {
      const props = args[1] as { type?: string; id?: string } | null;
      layerStack.push(props && props.type === "OC" && props.id && ocNames ? ocNames(props.id) ?? "" : layerStack[layerStack.length - 1] ?? "");
    } else if (fn === OPS.beginMarkedContent) layerStack.push(layerStack[layerStack.length - 1] ?? "");
    else if (fn === OPS.endMarkedContent) layerStack.pop();
    else if (fn === OPS.constructPath) {
      const paint = args[0] as number;
      const stroke = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke || paint === OPS.closeEOFillStroke;
      const fill = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke || paint === OPS.closeEOFillStroke;
      if (!stroke && !fill) continue;   // a clipping path
      const a1 = args[1] as unknown;
      const data = (Array.isArray(a1) ? a1[0] : a1) as ArrayLike<number> | null;
      if (!data) continue;
      let cur: Pt[] = [], closed = false, curve = false;
      const flush = () => {
        if (cur.length >= 2) {
          const layer = layerStack[layerStack.length - 1] ?? "";
          if (stroke) raw.push({ kind: "stroke", pts: cur, closed: closed || paint === OPS.closeStroke || paint === OPS.closeFillStroke, curve, rgb: st.stroke, fillRgb: st.fill, layer, width: st.width });
          if (fill && cur.length >= 3) raw.push({ kind: "fill", pts: cur, closed: true, curve, rgb: st.fill, fillRgb: st.fill, layer, width: st.width });
        }
        cur = []; closed = false; curve = false;
      };
      for (let k = 0; k < data.length;) {
        const op = data[k++];
        if (op === D_MOVE) { flush(); cur.push(ap(st.ctm, data[k], data[k + 1])); k += 2; }
        else if (op === D_LINE) { cur.push(ap(st.ctm, data[k], data[k + 1])); k += 2; }
        else if (op === D_CURVE || op === D_QUAD) {
          const n = op === D_CURVE ? 6 : 4, p0 = cur[cur.length - 1] ?? ap(st.ctm, data[k], data[k + 1]);
          const c = Array.from({ length: n / 2 }, (_, j) => ap(st.ctm, data[k + 2 * j], data[k + 2 * j + 1]));
          k += n; curve = true;
          for (let s = 1; s <= 8; s++) {
            const t = s / 8, u = 1 - t;
            cur.push(op === D_CURVE
              ? [u * u * u * p0[0] + 3 * u * u * t * c[0][0] + 3 * u * t * t * c[1][0] + t * t * t * c[2][0], u * u * u * p0[1] + 3 * u * u * t * c[0][1] + 3 * u * t * t * c[1][1] + t * t * t * c[2][1]]
              : [u * u * p0[0] + 2 * u * t * c[0][0] + t * t * c[1][0], u * u * p0[1] + 2 * u * t * c[0][1] + t * t * c[1][1]]);
          }
        } else if (op === D_CLOSE) { closed = true; }
        else { warnings.push("Unknown path step " + op + " in the PDF (pdf.js changed?); the rest of that path is skipped."); break; }
      }
      flush();
    }
  }

  // ---- text, in page points: one run per item, then runs on one line joined, then stacked lines joined
  const tc = await page.getTextContent({ disableNormalization: true });
  interface Run { s: string; o: Pt; rot: number; h: number; w: number }
  let runs: Run[] = [];
  for (const it of tc.items) {
    const s = it.str ?? "", t = it.transform;
    if (!t || !s.trim()) continue;
    const h = Math.hypot(t[2], t[3]) || it.height || 1;
    runs.push({ s, o: [t[4], t[5]], rot: Math.atan2(t[1], t[0]), h, w: it.width ?? s.length * 0.6 * h });
  }
  runs = joinRuns(runs);
  const lines = stackLines(runs);

  await doc.destroy?.();

  // ---- the scale: written on the sheet, checked against the dimensions
  const pageMm: [number, number] = [(vx1 - vx0) * PT, (vy1 - vy0) * PT];
  const segsPt: [Pt, Pt][] = [];
  for (const r of raw) if (r.kind === "stroke") for (let i = 0; i + 1 < r.pts.length; i++) segsPt.push([r.pts[i], r.pts[i + 1]]);
  const written = [...new Set(lines.flatMap(l => [...l.text.matchAll(/(?:^|\s|:)1\s*:\s*(\d{1,4})(?!\d)/g)].map(m => +m[1])).filter(n => n > 0))];
  const agree = (n: number) => countAgreeing(lines, segsPt, n);
  let scale = opts.scale ?? 0, from = opts.scale ? "typed in" : "", agreeN = 0;
  if (!scale) {
    const cands = (written.length ? written : STANDARD_SCALES).map(n => ({ n, a: agree(n) })).sort((p, q) => q.a - p.a || written.indexOf(p.n) - written.indexOf(q.n));
    const best = cands[0];
    if (written.length && best) { scale = best.n; from = "the sheet (1:" + best.n + ")"; agreeN = best.a; }
    else if (best && best.a >= 3) { scale = best.n; from = "the dimensions (none written on the sheet)"; agreeN = best.a; warnings.push("No scale written on the sheet; 1:" + best.n + " is the scale " + best.a + " dimensions agree on."); }
    else { scale = 1; from = "not found"; warnings.push("No scale found on the sheet and the dimensions do not settle one; read at 1:1. Type the scale in."); }
    if (written.length > 1) warnings.push("The sheet shows more than one scale (" + written.map(n => "1:" + n).join(", ") + "); read at 1:" + scale + ", which the most dimensions agree with. Views at other scales will be the wrong size.");
  } else agreeN = agree(scale);
  const f = PT * scale;
  const P = (p: Pt): Pt => [(p[0] - vx0) * f, (p[1] - vy0) * f];

  // ---- entities in drawing millimetres
  const entities: Entity[] = [];
  let n = 0;
  const base = (rgb: string, layer: string, linetype = "CONTINUOUS") => ({ id: "p" + ++n, layer: layer || "PDF", color: 7, linetype, blocks: [] as string[], rgb });
  const strokes = raw.filter(r => r.kind === "stroke");
  const singles: { a: Pt; b: Pt; rgb: string; layer: string }[] = [];
  for (const r of strokes) {
    const pts = r.pts.map(P);
    if (pts.length === 2 && !r.closed) singles.push({ a: pts[0], b: pts[1], rgb: r.rgb, layer: r.layer });
    else entities.push({ ...base(r.rgb, r.layer), kind: "pline", pts: r.closed && dist(pts[0], pts[pts.length - 1]) < 0.01 ? pts.slice(0, -1) : pts, closed: r.closed || dist(pts[0], pts[pts.length - 1]) < 0.01 });
  }
  // a plotted dash is under 25 mm on paper and its gaps under 3 mm
  for (const l of joinDashes(singles, 3 * scale, 25 * scale)) entities.push({ ...base(l.rgb, l.layer, l.dashed ? "DASHED" : "CONTINUOUS"), kind: "line", a: l.a, b: l.b });
  for (const r of raw) if (r.kind === "fill") entities.push({ ...base(r.rgb, r.layer), kind: "hatch", loops: [r.pts.map(P)], solid: true, pattern: "SOLID" });
  for (const l of lines) {
    const o = P(l.o), h = l.h * f, w = l.w * f, rot = (l.rot * 180) / Math.PI;
    const ca = Math.cos(l.rot), sa = Math.sin(l.rot), H = l.height * f;
    const corner = (x: number, y: number): Pt => [o[0] + x * ca - y * sa, o[1] + x * sa + y * ca];
    const b = boxOf([corner(0, -0.2 * h), corner(w, -0.2 * h), corner(w, H), corner(0, H)]);
    const t: Text = { ...base("#000000", ""), kind: "text", text: l.text, raw: l.text, p: o, h, rot: ((rot % 360) + 360) % 360, box: [[b.x0, b.y0], [b.x1, b.y1]], src: "TEXT" };
    entities.push(t);
  }
  const ext = entities.length ? boxOf(entities.flatMap(e => e.kind === "text" ? e.box : e.kind === "line" ? [e.a, e.b] : e.kind === "pline" ? e.pts : e.kind === "hatch" ? e.loops.flat() : [])) : null;
  const dashed = entities.filter(e => e.kind === "line" && e.linetype === "DASHED").length;
  if (dashed) warnings.push(dashed + " dashed lines rebuilt from their dashes.");
  return {
    source: "pdf",
    units: { code: 0, name: "drawing millimetres at 1:" + scale, factor: f, inferred: from === "not found" },
    version: "PDF page " + pageNo,
    paper: { page: pageNo, pages: doc.numPages, size: [Math.round(pageMm[0]), Math.round(pageMm[1])], scale, from, agree: agreeN, others: written.filter(x => x !== scale) },
    layers: [...new Set(entities.map(e => e.layer))].map(name => ({ name, color: 7, off: false, frozen: false, linetype: "CONTINUOUS" })),
    entities,
    extents: ext ? { min: [ext.x0, ext.y0], max: [ext.x1, ext.y1] } : null,
    warnings,
    stats: { pairs: ops.fnArray.length, entities: entities.length, exploded: 0, skipped: {} }
  };
}

interface Line { text: string; o: Pt; rot: number; h: number; w: number; height: number }

/** Joins text runs that continue each other on one baseline. */
function joinRuns(runs: { s: string; o: Pt; rot: number; h: number; w: number }[]) {
  const out: typeof runs = [];
  const sorted = [...runs].sort((a, b) => a.rot - b.rot || a.o[1] - b.o[1] || a.o[0] - b.o[0]);
  for (const r of sorted) {
    const ca = Math.cos(r.rot), sa = Math.sin(r.rot);
    const prev = out.find(p => Math.abs(p.rot - r.rot) < 0.01 && Math.abs(p.h - r.h) < 0.15 * r.h && (() => {
      const dx = r.o[0] - p.o[0], dy = r.o[1] - p.o[1], along = dx * ca + dy * sa, across = -dx * sa + dy * ca;
      return Math.abs(across) < 0.25 * r.h && along > 0 && along - p.w < 0.6 * r.h && along - p.w > -0.3 * r.h;
    })());
    if (!prev) { out.push({ ...r }); continue; }
    const dx = r.o[0] - prev.o[0], dy = r.o[1] - prev.o[1], along = dx * ca + dy * sa;
    prev.s += (along - prev.w > 0.15 * r.h && !/\s$/.test(prev.s) && !/^\s/.test(r.s) ? " " : "") + r.s;
    prev.w = along + r.w;
  }
  return out.map(r => ({ ...r, s: r.s.trim() }));
}

/** Joins lines stacked under each other (a callout on two lines, a note) into one text, top line first. */
function stackLines(runs: { s: string; o: Pt; rot: number; h: number; w: number }[]): Line[] {
  const groups: { rows: typeof runs }[] = [];
  const ordered = [...runs].sort((a, b) => {
    const ca = Math.cos(a.rot), sa = Math.sin(a.rot);
    return -((a.o[1] * ca - a.o[0] * sa) - (b.o[1] * ca - b.o[0] * sa));   // top first in the text's own frame
  });
  for (const r of ordered) {
    const ca = Math.cos(r.rot), sa = Math.sin(r.rot);
    const g = groups.find(g => {
      const last = g.rows[g.rows.length - 1];
      if (Math.abs(last.rot - r.rot) > 0.01 || Math.abs(last.h - r.h) > 0.12 * r.h) return false;
      const dx = r.o[0] - last.o[0], dy = r.o[1] - last.o[1], along = dx * ca + dy * sa, down = -(-dx * sa + dy * ca);
      if (down < 0.9 * r.h || down > 2.0 * r.h) return false;
      const a0 = Math.max(0, along), a1 = Math.min(last.w, along + r.w);
      return a1 - a0 > 0.5 * Math.min(last.w, r.w) || Math.abs(along) < 0.6 * r.h || Math.abs(along + r.w / 2 - last.w / 2) < 0.6 * r.h;
    });
    if (g) g.rows.push(r); else groups.push({ rows: [r] });
  }
  return groups.map(({ rows }) => {
    const top = rows[0], bottom = rows[rows.length - 1], ca = Math.cos(top.rot), sa = Math.sin(top.rot);
    // origin: the bottom row's start, measured back to the leftmost start of any row
    const minAlong = Math.min(...rows.map(r => (r.o[0] - bottom.o[0]) * ca + (r.o[1] - bottom.o[1]) * sa));
    const o: Pt = [bottom.o[0] + minAlong * ca, bottom.o[1] + minAlong * sa];
    const w = Math.max(...rows.map(r => (r.o[0] - o[0]) * ca + (r.o[1] - o[1]) * sa + r.w));
    const height = (-(top.o[0] - o[0]) * sa + (top.o[1] - o[1]) * ca) + 0.8 * top.h;
    return { text: rows.map(r => r.s).join("\n"), o, rot: top.rot, h: top.h, w, height };
  });
}

/** AutoCAD plots a dashed line as its dashes: collinear strokes with short gaps become one dashed line again. */
function joinDashes(segs: { a: Pt; b: Pt; rgb: string; layer: string }[], gap: number, dashMax: number) {
  const out: { a: Pt; b: Pt; rgb: string; layer: string; dashed: boolean }[] = [];
  const groups = new Map<string, { t0: number; t1: number; s: (typeof segs)[number] }[]>();
  for (const s of segs) {
    let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    dx /= L; dy /= L;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const ang = Math.round(Math.atan2(dy, dx) * 2000), off = Math.round((-s.a[0] * dy + s.a[1] * dx) / 0.5);   // 0.5 mm bands
    const key = ang + "|" + off + "|" + s.rgb + "|" + s.layer;
    const t0 = s.a[0] * dx + s.a[1] * dy, t1 = s.b[0] * dx + s.b[1] * dy;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ t0: Math.min(t0, t1), t1: Math.max(t0, t1), s });
  }
  for (const list of groups.values()) {
    list.sort((p, q) => p.t0 - q.t0);
    let run = [list[0]];
    const emit = () => {
      if (run.length === 1) { out.push({ ...run[0].s, dashed: false }); return; }
      const first = run[0], lastEnd = Math.max(...run.map(r => r.t1));
      const gaps = run.slice(1).map((r, i) => r.t0 - run[i].t1);
      const dashed = gaps.some(g => g > gap * 0.02);
      const u = [first.s.b[0] - first.s.a[0], first.s.b[1] - first.s.a[1]], L = Math.hypot(u[0], u[1]);
      const dir: Pt = first.s.a[0] * u[0] + first.s.a[1] * u[1] <= first.s.b[0] * u[0] + first.s.b[1] * u[1] ? [u[0] / L, u[1] / L] : [-u[0] / L, -u[1] / L];
      const base = first.s.a[0] * dir[0] + first.s.a[1] * dir[1] === first.t0 ? first.s.a : first.s.b;
      const a: Pt = [base[0] + (first.t0 - (base[0] * dir[0] + base[1] * dir[1])) * dir[0], base[1] + (first.t0 - (base[0] * dir[0] + base[1] * dir[1])) * dir[1]];
      out.push({ a, b: [a[0] + (lastEnd - first.t0) * dir[0], a[1] + (lastEnd - first.t0) * dir[1]], rgb: first.s.rgb, layer: first.s.layer, dashed });
    };
    for (let i = 1; i < list.length; i++) {
      const cur = run[run.length - 1], nx = list[i];
      const short = (r: { t0: number; t1: number }) => r.t1 - r.t0 < dashMax;
      if (nx.t0 - Math.max(...run.map(r => r.t1)) <= 0.01 || (nx.t0 - cur.t1 <= gap && short(cur) && short(nx))) run.push(nx);
      else { emit(); run = [nx]; }
    }
    emit();
  }
  return out;
}

/** How many dimension figures on the sheet match a parallel line of that length at scale 1:n. */
function countAgreeing(lines: Line[], segs: [Pt, Pt][], n: number): number {
  let c = 0;
  for (const l of lines) {
    if (!/^\d{2,6}$/.test(l.text)) continue;
    const v = +l.text, ca = Math.cos(l.rot), sa = Math.sin(l.rot);
    const mid: Pt = [l.o[0] + (l.w / 2) * ca, l.o[1] + (l.w / 2) * sa];
    const hit = segs.some(([a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < 1e-6 || Math.abs((dx * sa - dy * ca) / L) > 0.02) return false;   // parallel to the figure
      const off = Math.abs((mid[0] - a[0]) * (-dy / L) + (mid[1] - a[1]) * (dx / L));
      if (off > 3 * l.h) return false;
      const t = ((mid[0] - a[0]) * dx + (mid[1] - a[1]) * dy) / (L * L);
      if (t < -0.05 || t > 1.05) return false;
      return Math.abs(L * PT * n - v) <= Math.max(2, 0.01 * v);
    });
    if (hit) c++;
  }
  return c;
}
