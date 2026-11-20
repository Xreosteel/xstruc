// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { LAYERS } from "./constants.ts";
import { fmt } from "./bending.ts";
import { nearestGrid } from "./setout.ts";

// ---------- section cut (backlog #10) ----------
// A true section through the model on a vertical plane, as plain geometry in millimetres: s along the cut line, z up
// (z = 0 at the main slab soffit). dir "NS": the cut line runs north–south at x = at, s is plan y; dir "EW": the line
// runs east–west at y = at, s is plan x. look is the way the viewer faces (N / S / E / W, at right angles to the line):
// the half of the model between the viewer and the plane is removed, the cut face is what remains. Bars crossing the
// plane are dots at their true size; bars running parallel to the plane within `depth` behind it (default 300, about
// one bar pitch) are lines, nearest line of each run first. The layer stack lists each layer at the cut with the clear
// cover to the nearest concrete face below and above; the covers at the outer layers are dimensioned. Headless: the
// viewer draws this on a canvas and clips the 3D scene on the same plane; a DXF export can write the same primitives.
// `mirror` tells the drawing which way s runs across the page: seen from the viewer's side north / west is on the
// left when looking east / south, so s increases to the LEFT there (true section, not a mirror image).
const SECTION_LOOK = { NS: ["E", "W"], EW: ["N", "S"] };
function buildSection(M, opt) {
  opt = opt || {};
  const PNL = M.kind === "panel", T = M.T;
  const dir = opt.dir === "EW" ? "EW" : "NS", looks = SECTION_LOOK[dir], look = looks.indexOf(opt.look) >= 0 ? opt.look : looks[0];
  const ax = dir === "NS" ? 0 : 1, sa = 1 - ax;   // ax: the plan index the plane is fixed on; sa: the index that runs along the cut
  const EXT = M.EXT, lo = ax ? EXT.y0 : EXT.x0, hi = ax ? EXT.y1 : EXT.x1;
  const at = Math.max(lo, Math.min(hi, isFinite(+opt.at) ? +opt.at : (lo + hi) / 2));
  const keep = look === "N" || look === "E" ? 1 : -1;   // the kept half: coordinate - at has this sign
  const depth = isFinite(+opt.depth) && +opt.depth >= 0 ? +opt.depth : 300;
  const mirror = look === "E" || look === "S";
  const S = { dir: dir, at: at, look: look, keep: keep, depth: depth, mirror: mirror, axis: ax ? "y" : "x", along: sa ? "y" : "x", pieces: [], dots: [], lines: [], stack: [], covers: [], grids: [], title: "", sub: "", bounds: null, lookName: (PNL ? { N: "towards the top edge", S: "towards the bottom edge", E: "towards the right edge", W: "towards the left edge" } : { N: "north", S: "south", E: "east", W: "west" })[look] };
  // --- concrete: the s-intervals a solid covers on the plane, as (s, z) rectangles or polygons ---
  // intervals of a closed polygon [[x, y], …] along the line (ax = at): scanline crossings paired up
  function polyIntervals(poly, ax, at) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], a = p[ax], b = q[ax];
      if (a === b) continue;
      if ((a < at && b >= at) || (b < at && a >= at)) { const t = (at - a) / (b - a); xs.push(p[1 - ax] + t * (q[1 - ax] - p[1 - ax])); }
    }
    xs.sort((u, v) => u - v);
    const out = []; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.5) out.push([xs[i], xs[i + 1]]);
    return out;
  }
  const rectInt = r => { const a = ax ? r.y0 : r.x0, b = ax ? r.y1 : r.x1; return at >= a && at <= b ? [[sa ? r.y0 : r.x0, sa ? r.y1 : r.x1]] : []; };
  const minus = (ivs, cuts) => { let out = ivs; cuts.forEach(c => { const nx = []; out.forEach(iv => { if (c[1] <= iv[0] || c[0] >= iv[1]) nx.push(iv); else { if (c[0] - iv[0] > 0.5) nx.push([iv[0], c[0]]); if (iv[1] - c[1] > 0.5) nx.push([c[1], iv[1]]); } }); out = nx; }); return out; };
  const piece = (iv, z0, z1, kind, id, extra) => { if (z1 - z0 < 0.5) return; S.pieces.push(Object.assign({ s0: iv[0], s1: iv[1], z0: z0, z1: z1, kind: kind, id: id || "" }, extra || {})); };
  const prism = (r, z0, z1, kind, id, holes, extra) => minus(rectInt(r), (holes || []).map(h => rectInt(h)).flat()).forEach(iv => piece(iv, z0, z1, kind, id, extra));
  // the main slab (a panel: its net outline with the doors and notches cut), less the voids, set-downs and the step
  const slabHoles = M.HOLES.filter(h => !h.edge).concat(M.DROPS).concat(M.STEP ? [M.STEP] : []);
  (M.outline ? minus(polyIntervals(M.outline, ax, at), slabHoles.map(h => rectInt(h)).flat()) : minus(rectInt(M.SL), slabHoles.map(h => rectInt(h)).flat())).forEach(iv => piece(iv, 0, T, PNL ? "panel" : "slab", PNL ? M.name : "SLAB"));
  M.DROPS.forEach(dd => prism(dd, -dd.d, T - dd.d, "drop", dd.id));
  if (M.STEP) {
    const st = M.STEP;
    prism(st, st.rise, st.rise + T, "step", "STEP");
    prism({ x0: st.x0, x1: st.x0 + st.nib, y0: st.y0, y1: st.y1 }, 0, st.rise + T, "nib", "NIB");
    prism({ x0: st.x0, x1: st.x1, y0: st.y0, y1: st.y0 + st.nib }, 0, st.rise + T, "nib", "NIB");
  }
  M.BALCS.forEach(b => prism(b, b.bot, b.top, "balcony", b.plain ? "BALCONY" : b.id));
  M.BEAMS.forEach(bm => prism(bm.dir === "X" ? { x0: bm.a, x1: bm.b, y0: bm.at - bm.w / 2, y1: bm.at + bm.w / 2 } : { x0: bm.at - bm.w / 2, x1: bm.at + bm.w / 2, y0: bm.a, y1: bm.b }, T - bm.D, 0, "beam", bm.id));
  M.COLS.forEach(c => prism({ x0: c.x - M.COL / 2, x1: c.x + M.COL / 2, y0: c.y - M.COL / 2, y1: c.y + M.COL / 2 }, M.COLB, c.top, "column", c.name, null, { existing: true }));
  if (M.STAIR) {   // the flight (#8): along the flight the section is its own polygon; across it, the riser / soffit depth at that point
    const ST = M.STAIR, flightAlong = ST.alongX === (sa === 0);   // the cut line runs the way the flight runs
    const planPoly = ST.poly.map(p => [ST.edge + ST.sg * p[0], p[1]]);   // (plan coordinate along the flight, z)
    if (flightAlong) { if (at >= ST.c0 && at <= ST.c1) S.pieces.push({ kind: "stair", id: "STAIR", poly: planPoly, s0: Math.min(...planPoly.map(p => p[0])), s1: Math.max(...planPoly.map(p => p[0])), z0: Math.min(...planPoly.map(p => p[1])), z1: Math.max(...planPoly.map(p => p[1])) }); }
    else polyIntervals(planPoly, 0, at).forEach(zz => piece([ST.c0, ST.c1], zz[0], zz[1], "stair", "STAIR"));
    // the floor below (context), as the viewer draws it: a pad under the foot of the flight out to a landing past the bottom riser
    const padA = ST.edge + ST.sg * (ST.sFoot - 600), padB = ST.edge + ST.sg * (ST.run + 1000);
    prism(ST.alongX ? { x0: Math.min(padA, padB), x1: Math.max(padA, padB), y0: ST.c0 - 300, y1: ST.c1 + 300 } : { x0: ST.c0 - 300, x1: ST.c1 + 300, y0: Math.min(padA, padB), y1: Math.max(padA, padB) }, ST.zLo - T, ST.zLo, "floor", "FLOOR BELOW", null, { existing: true });
  }
  // --- bars and mesh wires: crossing the plane → a dot; parallel within `depth` behind it → a line ---
  const list = M.bars.concat(M.wires || []);
  list.forEach(b => {
    const pts = b.pts, d = b.size, segs = [];
    let behind = null;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], a = p[ax], c = q[ax];
      if ((a < at && c >= at) || (c < at && a >= at)) {   // one dot per crossing (half-open, so a bend on the plane counts once)
        const t = (at - a) / (c - a);
        S.dots.push({ s: p[sa] + t * (q[sa] - p[sa]), z: p[2] + t * (q[2] - p[2]), d: d, bar: b, layer: b.layer, id: b.id, wire: !!b.wire, chair: !!b.chair, existing: !!b.existing });
      } else if (Math.abs(a - c) < 1) {   // parallel to the plane
        const dist = (a - at) * keep;
        if (dist >= 0 && dist <= depth) { segs.push([[p[sa], p[2]], [q[sa], q[2]]]); behind = dist; }
      }
    }
    if (segs.length) {
      const line = segs.reduce((acc, sg) => { const last = acc[acc.length - 1]; if (last && Math.abs(last[last.length - 1][0] - sg[0][0]) < 0.5 && Math.abs(last[last.length - 1][1] - sg[0][1]) < 0.5) last.push(sg[1]); else acc.push([sg[0], sg[1]]); return acc; }, []);
      line.forEach(pl => S.lines.push({ pts: pl, d: d, dist: behind, bar: b, layer: b.layer, id: b.id, wire: !!b.wire, existing: !!b.existing, run: b.run ? b.run.id : null }));
    }
  });
  // nearest line of each run first; lines further behind are kept (dimmer in the drawing) but ranked
  const nearest = {}; S.lines.forEach(L => { const k = L.run || "b" + L.id; if (!(k in nearest) || L.dist < nearest[k]) nearest[k] = L.dist; });
  S.lines.forEach(L => { L.near = Math.abs(L.dist - nearest[L.run || "b" + L.id]) < 1; });
  S.lines.sort((p, q) => (p.near ? 0 : 1) - (q.near ? 0 : 1) || p.dist - q.dist);
  // --- cover: the concrete faces nearest below and above each dot (the piece it sits in; a bar outside concrete has none) ---
  const inPiece = (pc, s, z) => s >= pc.s0 - 0.5 && s <= pc.s1 + 0.5 && z >= pc.z0 - 0.5 && z <= pc.z1 + 0.5 && !pc.poly;
  const inPoly = (poly, s, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const pi = poly[i], pj = poly[j]; if ((pi[1] > z) !== (pj[1] > z) && s < (pj[0] - pi[0]) * (z - pi[1]) / (pj[1] - pi[1]) + pi[0]) c = !c; } return c; };
  const faces = (s, z) => {   // the concrete piece a point sits in and its faces below / above along a vertical through it
    let below = null, above = null, host = null;
    S.pieces.forEach(pc => {
      if (pc.poly) {   // the stair polygon: faces are where a vertical through the point leaves it
        if (!inPoly(pc.poly, s, z)) return;
        const zs = polyIntervals(pc.poly, 0, s).find(zz => z >= zz[0] && z <= zz[1]); if (!zs) return;
        host = host || pc; if (below == null || zs[0] > below) below = zs[0]; if (above == null || zs[1] < above) above = zs[1];
      } else if (inPiece(pc, s, z)) { host = host || pc; if (below == null || pc.z0 > below) below = pc.z0; if (above == null || pc.z1 < above) above = pc.z1; }
    });
    return host ? { host: host.kind, below: below, above: above } : null;
  };
  S.dots.forEach(dt => {
    const f = faces(dt.s, dt.z);
    dt.host = f ? f.host : null;
    dt.cover = f ? { below: Math.round(dt.z - dt.d / 2 - f.below), above: Math.round(f.above - dt.z - dt.d / 2) } : null;
  });
  // a line beyond the plane sits at its own z: its cover is read at the middle of each straight piece (the least governs)
  // (its running pieces: a cog or crank leg is not where the layer sits, so near-vertical pieces are left out when there are others)
  const runSegs = L => { const all = L.pts.slice(1).map((q, i) => [L.pts[i], q]), flat = all.filter(sg => Math.abs(sg[1][1] - sg[0][1]) < 20); return flat.length ? flat : all; };
  S.lines.forEach(L => {
    let cb = null, ca = null, host = null;
    L.segs = runSegs(L); L.segInfo = [];
    for (let i = 0; i < L.segs.length; i++) {
      const s = (L.segs[i][0][0] + L.segs[i][1][0]) / 2, z = (L.segs[i][0][1] + L.segs[i][1][1]) / 2, f = faces(s, z);
      if (!f) { L.segInfo.push(null); continue; }
      host = host || f.host; const b = Math.round(z - L.d / 2 - f.below), a = Math.round(f.above - z - L.d / 2);
      L.segInfo.push({ host: f.host, below: b, above: a });
      if (cb == null || b < cb) cb = b; if (ca == null || a < ca) ca = a;
    }
    L.host = host; L.cover = host ? { below: cb, above: ca } : null;
  });
  // --- the layer stack at the cut: every layer with a dot or a near line, in the model's layer order; the bars in the
  // main slab (or the panel) set its level and cover when there are any, else whatever the layer has at the cut ---
  const LAY = M.LAYERS || LAYERS, isSlab = h => h === "slab" || h === "panel";
  LAY.forEach(l => {
    const ds = S.dots.filter(dt => dt.layer === l.id && !dt.chair && !dt.existing);
    const ls = S.lines.filter(L => L.layer === l.id && L.near && !L.existing);
    if (!ds.length && !ls.length) return;
    // every bar at the cut as (z, size, type, host, cover): a dot once, a line once per straight piece
    const lbl = b => b.wire ? (b.sheet ? b.sheet.code : "wire") : b.type + b.size;   // a wire is named by its mesh, a bar by type and size
    const items = ds.map(dt => ({ z: dt.z, d: dt.d, lbl: lbl(dt.bar), host: dt.host, cover: dt.cover, line: false }))
      .concat(ls.map(L => L.segs.map(sg => ({ z: (sg[0][1] + sg[1][1]) / 2, d: L.d, lbl: lbl(L.bar), host: L.host, cover: L.cover, line: true }))).flat());
    const inSlab = items.filter(it => isSlab(it.host)), use = inSlab.length ? inSlab : items;
    const zs = use.map(it => it.z), sizes = [...new Set(use.map(it => it.lbl))];
    const cb = use.filter(it => it.cover && it.cover.below != null).map(it => it.cover.below), ca = use.filter(it => it.cover && it.cover.above != null).map(it => it.cover.above);
    const hist = {}; zs.forEach(z => { const k = Math.round(z); hist[k] = (hist[k] || 0) + 1; });   // the level most bars sit at (a crank or cog leg does not move the layer)
    const zMode = +Object.keys(hist).reduce((a, k) => hist[k] > hist[a] ? k : a, Object.keys(hist)[0]);
    S.stack.push({ layer: l.id, name: l.name, short: l.short || l.id, css: l.css, n: ds.length, nLines: ls.length, sizes: sizes, z: zMode, zMean: Math.round(zs.reduce((a, b) => a + b, 0) / zs.length), zMin: Math.round(Math.min(...zs)), zMax: Math.round(Math.max(...zs)),
      coverBelow: cb.length ? Math.min(...cb) : null, coverAbove: ca.length ? Math.min(...ca) : null, inSlab: inSlab.length, host: use[0].host });
  });
  // cover dimensions at the outer layers: the lowest bar's bottom cover and the highest bar's top cover in the main slab,
  // dots first (a dot is the bar at the cut), else the nearest line beyond; at the bar nearest the middle of the cut
  const sMid = (lo + hi) / 2;
  const cands = S.dots.filter(dt => isSlab(dt.host) && dt.cover && !dt.chair && !dt.existing).map(dt => ({ s: dt.s, z: dt.z, d: dt.d, layer: dt.layer, cover: dt.cover, dot: true }))
    .concat(S.lines.filter(L => L.near && !L.existing).map(L => {   // each running piece of a line in the main slab, at its point nearest the middle
      const near = sg => { const a = Math.min(sg[0][0], sg[1][0]), b = Math.max(sg[0][0], sg[1][0]), s = Math.max(a, Math.min(b, sMid)), t = b > a ? (s - sg[0][0]) / (sg[1][0] - sg[0][0]) : 0; return { s: s, z: sg[0][1] + t * (sg[1][1] - sg[0][1]) }; };
      return L.segs.map((sg, i) => L.segInfo[i] && isSlab(L.segInfo[i].host) ? Object.assign(near(sg), { d: L.d, layer: L.layer, cover: { below: L.segInfo[i].below, above: L.segInfo[i].above }, dot: false }) : null).filter(Boolean);
    }).flat());
  if (cands.length) {
    const pick = ds => ds.reduce((a, b) => (b.dot && !a.dot) || (b.dot === a.dot && Math.abs(b.s - sMid) < Math.abs(a.s - sMid)) ? b : a, ds[0]);
    const zLo = Math.min(...cands.map(c => c.z - c.d / 2)), zHi = Math.max(...cands.map(c => c.z + c.d / 2));
    const dLo = pick(cands.filter(c => c.z - c.d / 2 < zLo + 1)), dHi = pick(cands.filter(c => c.z + c.d / 2 > zHi - 1));
    S.covers.push({ side: "below", layer: dLo.layer, s: dLo.s, zBar: dLo.z - dLo.d / 2, zFace: dLo.z - dLo.d / 2 - dLo.cover.below, v: dLo.cover.below, line: !dLo.dot, text: dLo.cover.below + " BTM COVER" + (dLo.cover.below !== M.C ? " (" + M.C + " SPECIFIED)" : "") });
    S.covers.push({ side: "above", layer: dHi.layer, s: dHi.s, zBar: dHi.z + dHi.d / 2, zFace: dHi.z + dHi.d / 2 + dHi.cover.above, v: dHi.cover.above, line: !dHi.dot, text: dHi.cover.above + " TOP COVER" + (dHi.cover.above !== M.C ? " (" + M.C + " SPECIFIED)" : "") });
  }
  // grids the cut line crosses (NS line: the lettered grids; EW line: the numbered grids), and where the cut sits from its nearest grid
  (sa ? M.GY : M.GX).forEach(g => S.grids.push({ name: g[0], s: g[1] }));
  const G = ax ? M.GY : M.GX, ref = G.length ? nearestGrid(G, at, ax ? ["N", "S"] : ["E", "W"]) : null;
  S.ref = ref;
  // --- extents: everything cut plus a margin; the title ---
  const allS = S.pieces.map(pc => [pc.s0, pc.s1]).flat().concat(S.dots.map(dt => dt.s)), allZ = S.pieces.map(pc => [pc.z0, pc.z1]).flat().concat(S.dots.map(dt => dt.z));
  const s0 = allS.length ? Math.min(...allS) : (sa ? EXT.y0 : EXT.x0), s1 = allS.length ? Math.max(...allS) : (sa ? EXT.y1 : EXT.x1);
  S.bounds = { s0: Math.min(s0, sa ? EXT.y0 : EXT.x0) - 400, s1: Math.max(s1, sa ? EXT.y1 : EXT.x1) + 400, z0: (allZ.length ? Math.min(...allZ) : 0) - 150, z1: Math.max(allZ.length ? Math.max(...allZ) : T, T) + 250 };
  S.empty = !S.pieces.length && !S.dots.length;
  const where = PNL ? (ax ? fmt(at) + " UP FROM THE BOTTOM EDGE" : fmt(at) + " FROM THE LEFT EDGE") : (ref ? ref.text.toUpperCase() : (ax ? "y " : "x ") + fmt(at));
  S.title = (PNL ? (ax ? "HORIZONTAL" : "VERTICAL") : dir === "NS" ? "N–S" : "E–W") + " SECTION · " + where + " · LOOKING " + S.lookName.toUpperCase();
  const cut = S.dots.filter(dt => !dt.chair && !dt.existing && !dt.wire).length, wires = S.dots.filter(dt => dt.wire).length;
  S.sub = T + " THK · COVER " + M.C + " · " + cut + " BARS CUT" + (wires ? " · " + wires + " WIRES CUT" : "") + " · " + S.lines.filter(L => L.near && !L.existing).length + " BARS BEYOND WITHIN " + depth + (S.stack.length ? " · LAYERS " + S.stack.map(st => st.layer).join(" ") : "");
  return S;
}

export { SECTION_LOOK, buildSection };
