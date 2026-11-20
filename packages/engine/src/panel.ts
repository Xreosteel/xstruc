// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { KGM } from "./constants.ts";
import { STOCK, bendGeom, classify, cutLength, fmt } from "./bending.ts";
import { LAP_CASES, lapCalc } from "./laps.ts";
import { barAxis } from "./setout.ts";
import { parseCallout } from "./grammar.ts";
import { MESH, MESH_MADE, layMesh, meshMarks, meshSummary } from "./mesh.ts";
import { COVER_TABLE, MIN_REO, barAreaPerM, coverRequired } from "./cover.ts";
import { INSERT_CAT, INSERT_KIND, INSERT_RULES, insertWll } from "./inserts.ts";

const PANEL_CFG = {
  kind: "panel", name: "P1", W: 6000, H: 3000, T: 200, cover: 30, fc: 40, fcLift: 25, lap: 600, castFace: "FF", density: 2400,
  // exposure B1 is the example's value (an external wall panel, near-coastal); the cover table defaults to standard
  // formwork (Findings 12.1) and the record names the table used (#33e). Blank exposure = not checked, with a warning.
  exposure: "B1", coverTable: "standard",
  meshSheets: "made",
  faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "mesh", callouts: "SL82 H" } },
  openings: [{ name: "WINDOW", x0: 3200, y0: 1100, x1: 4600, y1: 2300 }],
  // two 10 t edge lifters in the top edge in the piers beside the window, symmetric about the centre of gravity (the window
  // pulls it west), their tension bars clear of the window's corner diagonals; two brace inserts on the near face (the face
  // up on the bed) below 60 % of the height, off the lifter lines
  inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 450 }, { id: "L2", type: "3DX10", edge: "top", x: 5364 }, { id: "B1", type: "QF20B", edge: "NF", x: 1000, y: 1600 }, { id: "B2", type: "QF20B", edge: "NF", x: 5600, y: 1600 }],
  features: { perimeter: true, trims: true },
  approval: { drawn: "", checked: "", approved: "", rev: "" }   // printed in the sheet's approval block (#33d); blank lines where empty
};
const FACE_NAME = { NF: "Near face", FF: "Far face" };
// Perimeter bar: one continuous N16 round the edge in each face; AS 3850.2 asks for at least one perimeter bar for
// transport and Reid's edge-lifter capacities assume N16 (Findings 12.1). Here four bars per face crossing at the
// corners. Opening bars: one bar each side extended 600 past each corner, N16 when the opening is 1,500 or more across,
// else N12, and an N12 × 1,200 diagonal across each corner (Findings 12.1 / 12.5 step 4: trade-typical defaults, not a
// cited standard; question for Baji).
const PANEL_EDGE = { perim: 16, trimSmall: 12, trimBig: 16, big: 1500, ext: 600, diag: 12, diagLen: 1200 };

// The panel's net outline (#33f): a closed polygon in panel mm, counter-clockwise from its lowest left corner, with the
// openings that reach an edge (doors, notches) cut out of it; openings inside the panel stay holes. Each edge of the
// panel less the openings on it, plus each edge opening's sides that lie inside the panel, chained into one loop (the
// openings are checked to leave the panel in one piece). The 3D concrete, the sheet and the tests take it.
function panelOutline(PW, PH, holes) {
  const edge = (holes || []).filter(h => h.edge);
  if (!edge.length) return [[0, 0], [PW, 0], [PW, PH], [0, PH]];
  const segs = [];
  const panelEdge = (fixed, X, len) => {   // the panel edge at `fixed` (y for an X edge) from 0 to len, less the openings on it
    let parts = [[0, len]];
    edge.forEach(h => {
      const on = X ? (fixed === 0 ? h.E.bottom : h.E.top) : (fixed === 0 ? h.E.left : h.E.right); if (!on) return;
      const lo = X ? h.x0 : h.y0, hi = X ? h.x1 : h.y1, out = [];
      parts.forEach(p => { if (hi <= p[0] || lo >= p[1]) { out.push(p); return; } if (lo > p[0]) out.push([p[0], lo]); if (hi < p[1]) out.push([hi, p[1]]); });
      parts = out;
    });
    parts.forEach(p => segs.push(X ? [[p[0], fixed], [p[1], fixed]] : [[fixed, p[0]], [fixed, p[1]]]));
  };
  panelEdge(0, true, PW); panelEdge(PH, true, PW); panelEdge(0, false, PH); panelEdge(PW, false, PH);
  edge.forEach(h => {
    if (!h.E.bottom) segs.push([[h.x0, h.y0], [h.x1, h.y0]]);
    if (!h.E.top) segs.push([[h.x0, h.y1], [h.x1, h.y1]]);
    if (!h.E.left) segs.push([[h.x0, h.y0], [h.x0, h.y1]]);
    if (!h.E.right) segs.push([[h.x1, h.y0], [h.x1, h.y1]]);
  });
  const same = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
  const pts = [segs[0][0], segs[0][1]], used = new Set([0]);
  while (used.size < segs.length) {
    const end = pts[pts.length - 1]; let found = -1, flip = false;
    for (let i = 0; i < segs.length && found < 0; i++) { if (used.has(i)) continue; if (same(segs[i][0], end)) found = i; else if (same(segs[i][1], end)) { found = i; flip = true; } }
    if (found < 0) break;
    used.add(found); pts.push(flip ? segs[found][0] : segs[found][1]);
  }
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
  const out = pts.filter((p, i) => { const a = pts[(i + pts.length - 1) % pts.length], b = pts[(i + 1) % pts.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-6; });
  const area2 = out.reduce((s, p, i) => { const q = out[(i + 1) % out.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  if (area2 < 0) out.reverse();
  let k = 0; out.forEach((p, i) => { if (p[1] < out[k][1] - 0.01 || (Math.abs(p[1] - out[k][1]) < 0.01 && p[0] < out[k][0])) k = i; });
  return out.slice(k).concat(out.slice(0, k));
}

function buildPanel(cfg) {
  cfg = Object.assign({}, PANEL_CFG, cfg || {});
  cfg.features = Object.assign({}, PANEL_CFG.features, cfg.features || {});
  cfg.faces = Object.assign({}, PANEL_CFG.faces, cfg.faces || {});
  const F = cfg.features, errors = [], warnings = [];
  const num = v => (v === "" || v == null) ? NaN : +v;
  const PW = num(cfg.W), PH = num(cfg.H), T = num(cfg.T), C = num(cfg.cover), FC = num(cfg.fc), LAPLEN = num(cfg.lap);
  const FCL = cfg.fcLift === "" || cfg.fcLift == null ? FC : num(cfg.fcLift);   // strength at lift: blank = the service f'c
  const name = String(cfg.name == null ? "P1" : cfg.name).trim().toUpperCase().replace(/\s+/g, " ").slice(0, 12) || "P1";
  cfg.name = name;
  const bed = cfg.castFace === "NF" ? "NF" : "FF", top = bed === "FF" ? "NF" : "FF";
  if (!(PW >= 1000 && PW <= 15000) || !(PH >= 1000 && PH <= 15000)) errors.push("Panel size: width and height must be 1,000–15,000 mm.");
  if (!(T >= 100 && T <= 400)) errors.push("Panel thickness must be 100–400 mm.");
  if (!(C >= 15 && C <= 75)) errors.push("Cover must be 15–75 mm.");
  if (!(FC >= 20 && FC <= 100)) errors.push("Concrete f'c must be 20–100 MPa.");
  if (!(FCL >= 10 && FCL <= FC)) errors.push("Concrete f'c at lift must be 10 MPa or more and not above the service f'c (" + (isFinite(FC) ? FC : "?") + ").");
  if (!(LAPLEN >= 300 && LAPLEN <= 2500)) errors.push("Lap must be 300–2500 mm.");
  if (errors.length) return { kind: "panel", cfg: cfg, errors: errors, warnings: warnings };

  // laps: the panel's flat lap, with the AS 3600 Cl 13.2.2 value beside it (a panel is a wide element; k1 from the
  // concrete cast below the bar on the bed), as on the floor (#5)
  const LAPS = { source: "flat", flat: LAPLEN, table: null, rows: [], missing: [], text: LAPLEN + " all bars" };
  function lapUse(o) {
    const calc = lapCalc({ size: o.size, type: "N", fc: FC, cover: o.cover, spacing: o.sp, below: o.below });
    const key = ["panel", "N" + o.size, o.sp | 0, o.cover, o.below > 300 ? 1 : 0].join("|");
    let row = LAPS.rows.find(r => r.key === key);
    if (!row) { row = { key: key, kase: "panel", caseName: LAP_CASES.panel.name, caseShort: LAP_CASES.panel.short, size: o.size, type: "N", fc: FC, sp: o.sp || 0, cover: o.cover, below: o.below, calc: calc, len: LAPLEN, src: "flat", diff: LAPLEN - calc.lap, short: LAPLEN < calc.raw, lapped: 0, what: [] }; LAPS.rows.push(row); }
    if (o.what && row.what.indexOf(o.what) < 0) row.what.push(o.what);
    return row;
  }

  // openings, mm from the panel's bottom-left corner as it lies on the bed
  const HOLES = [];
  (Array.isArray(cfg.openings) ? cfg.openings : []).forEach((o, i) => {
    const nm = (String(o.name == null ? "" : o.name).trim().toUpperCase() || "OPENING " + (i + 1)).slice(0, 24);
    const where = "Opening " + (i + 1) + " (" + nm + "): ";
    const v = ["x0", "y0", "x1", "y1"].map(k => num(o[k]));
    if (v.some(x => !isFinite(x))) { errors.push(where + "give all four numbers (x0 y0 x1 y1, mm from the panel's bottom-left corner)."); return; }
    const h = { id: nm, x0: Math.min(v[0], v[2]), x1: Math.max(v[0], v[2]), y0: Math.min(v[1], v[3]), y1: Math.max(v[1], v[3]), row: i + 1 };
    if (h.x1 - h.x0 < 300 || h.y1 - h.y0 < 300) { errors.push(where + "each side must be at least 300."); return; }
    // an opening may reach a panel edge (#33f): a door comes up from the bottom edge, a notch cuts in from a side or
    // the top, a corner notch takes two edges; it ends ON the edge (0, or the panel size), never past it
    if (h.x0 < 0 || h.y0 < 0 || h.x1 > PW || h.y1 > PH) { errors.push(where + "runs past the panel edge; a door or notch ends on the edge (write 0, or the panel size)."); return; }
    h.E = { left: h.x0 === 0, bottom: h.y0 === 0, right: h.x1 === PW, top: h.y1 === PH };
    h.edges = ["bottom", "left", "right", "top"].filter(k => h.E[k]);
    h.edge = h.edges.length > 0;
    if ((h.E.left && h.E.right) || (h.E.top && h.E.bottom)) { errors.push(where + "would cut the panel in two (it reaches both " + (h.E.left && h.E.right ? "side edges" : "the top and bottom edges") + ")."); return; }
    if ((!h.E.left && h.x0 < 300) || (!h.E.bottom && h.y0 < 300) || (!h.E.right && h.x1 > PW - 300) || (!h.E.top && h.y1 > PH - 300)) { errors.push(where + "each side must either reach the panel edge (a door or notch: 0, or the panel size) or sit at least 300 inside it."); return; }
    const clash = HOLES.find(q => !(h.x1 + 300 <= q.x0 || h.x0 >= q.x1 + 300 || h.y1 + 300 <= q.y0 || h.y0 >= q.y1 + 300));
    if (clash) { errors.push(where + "keep 300 clear of " + clash.id + " so the trimmer bars fit."); return; }
    h.kind = !h.edge ? "opening" : h.edges.length === 1 && h.E.bottom ? "door" : "notch";
    h.edgeText = !h.edge ? "" : h.edges.length === 1 ? "to the " + h.edges[0] + " edge" : "at the " + (h.E.bottom ? "bottom" : "top") + "-" + (h.E.left ? "left" : "right") + " corner";
    h.label = nm + " " + fmt(h.x1 - h.x0) + " × " + fmt(h.y1 - h.y0);
    h.big = Math.max(h.x1 - h.x0, h.y1 - h.y0) >= PANEL_EDGE.big;
    HOLES.push(h);
  });
  const outline = panelOutline(PW, PH, HOLES);

  // each face's reinforcement from its callouts (scheme TB: NF / FF are positions; a line need not repeat its face)
  const faces = {};
  ["NF", "FF"].forEach(f => {
    const fc = cfg.faces[f] || {}, kind = fc.kind === "mesh" ? "mesh" : "bar";
    const fa = faces[f] = { id: f, kind: kind, down: f === bed, layers: [], mesh: null, Name: FACE_NAME[f] };
    const lines = String(fc.callouts == null ? "" : fc.callouts).split(/\r?\n/).map((s, i) => ({ s: s.trim(), i: i + 1 })).filter(l => l.s);
    if (!lines.length) { warnings.push(FACE_NAME[f] + " has no reinforcement; that face is left out of the panel."); return; }
    lines.forEach(l => {
      const where = FACE_NAME[f] + " line " + l.i + " (" + l.s + "): ";
      const p = parseCallout(l.s, { scheme: "TB" });
      if (p.error) { errors.push(where + p.error + "."); return; }
      if (p.kind === "thickness") { errors.push(where + "the panel thickness has its own field."); return; }
      if (p.position && p.position !== f) {
        errors.push(where + (p.position === "EF" ? "write each face in its own box." : p.position === "NF" || p.position === "FF" ? "this box is the " + FACE_NAME[f].toLowerCase() + " (" + f + "); that line says " + p.position + "." : "a panel face is NF or FF, not top or bottom; leave the position out or write " + f + "."));
        return;
      }
      if (p.role) { errors.push(where + p.role + " bars are not read from the face boxes; the perimeter and opening bars have their own switches."); return; }
      const d = p.direction;
      const dirErr = !d ? "say which way it runs: H (horizontal) or V (vertical); nothing is assumed."
        : d === "X" || d === "Y" ? "E-W and N-S are plan directions; on a panel write H (horizontal) or V (vertical)."
        : d === "EW" ? "\"each way\" covers two layers; give each direction its own line, H or V."
        : d !== "H" && d !== "V" ? "on a panel write H (horizontal) or V (vertical)." : null;
      if (kind === "mesh") {
        if (p.kind !== "mesh") { errors.push(where + "this face is set to mesh; write one mesh line such as SL82 H, or set the face to bars."); return; }
        if (!MESH[p.mesh]) { errors.push(where + p.mesh + " is not a sheet mesh for a panel here (SL62–SL102, SL81, RL718–RL1218)."); return; }
        if (p.count && p.count > 1) { errors.push(where + "one mesh per face."); return; }
        if (fa.mesh) { errors.push(where + "this face already has " + fa.mesh.code + " on line " + fa.mesh.line + "; one mesh per face."); return; }
        if (dirErr) { errors.push(where + dirErr.replace("it runs", "its long wires run")); return; }
        fa.mesh = { code: p.mesh, dir: d, line: l.i, spec: MESH[p.mesh] };
      } else {
        if (p.kind === "mesh") { errors.push(where + "this face is set to bars; write lines such as N12-200 H, or set the face to mesh."); return; }
        if (p.type !== "N") { errors.push(where + "panel bars must be N (D500N) bars."); return; }
        if (!p.spacing) { errors.push(where + "no spacing found (write N12-200 H)."); return; }
        if (dirErr) { errors.push(where + dirErr); return; }
        const same = fa.layers.find(q => q.dir === d);
        if (same) { errors.push(where + "this face already has " + (d === "H" ? "horizontal" : "vertical") + " bars on line " + same.line + "; one line each way."); return; }
        if (p.spacing < p.size * 2 + 20) { errors.push(where + "spacing " + p.spacing + " is too tight for N" + p.size + "."); return; }
        fa.layers.push({ size: p.size, sp: p.spacing, dir: d, line: l.i });
      }
    });
    if (kind === "bar" && fa.layers.length === 1) warnings.push(FACE_NAME[f] + " has bars one way only (" + (fa.layers[0].dir === "H" ? "horizontal" : "vertical") + ").");
  });

  // depth of every steel plane from its own face: the face's mesh or bar layers (first line outer), then the edge
  // steel just inside them, stacked where it crosses: horizontal edge bars (perimeter, opening sides), then the
  // vertical ones, then the opening diagonals, which cross both
  const has = fa => !!(fa.mesh || fa.layers.length);
  ["NF", "FF"].forEach(f => {
    const fa = faces[f]; let d = C;
    if (fa.mesh) { const s = fa.mesh.spec; fa.mesh.dLong = d + s.dl / 2; fa.mesh.dCross = d + s.dl + s.dc / 2; d += s.dl + s.dc; }
    fa.layers.forEach((L, k) => { L.depth = d + L.size / 2; L.coverTo = d; L.k = k; d += L.size; });
    fa.reoDepth = d;
    const sizes = [], dg = has(fa) && F.trims && HOLES.length ? PANEL_EDGE.diag : 0;
    if (has(fa) && F.perimeter) sizes.push(PANEL_EDGE.perim);
    if (dg) HOLES.forEach(h => sizes.push(h.big ? PANEL_EDGE.trimBig : PANEL_EDGE.trimSmall));
    const e = fa.edgeD = sizes.length ? Math.max(...sizes) : 0;
    fa.dH = d + e / 2; fa.dV = d + e * 1.5; fa.dD = d + 2 * e + dg / 2;
    fa.deepest = d + 2 * e + dg;
  });
  const need = faces.NF.deepest + faces.FF.deepest;
  if (need > T - 10) errors.push("Panel too thin for this steel: cover, both faces and their edge bars take " + Math.round(need) + " of the " + T + " thickness, leaving under 10 between the faces. Thicken the panel or lighten a face.");
  if (has(faces.NF) && has(faces.FF) && T < 150) warnings.push("Two faces of steel in a panel under 150 thick: check the cover can be met (Findings 12.5).");
  if (errors.length) return { kind: "panel", cfg: cfg, errors: errors, warnings: warnings };
  const zOf = (f, depth) => faces[f].down ? depth : T - depth;

  // ---- cover against the AS 3600 table (#33e): the exposure and the table (standard / rigid) are the panel's inputs ----
  const exposure = COVER_TABLE.v[cfg.exposure] ? cfg.exposure : null, coverTable = cfg.coverTable === "rigid" ? "rigid" : "standard";
  const maxBar = Math.max(0, ...["NF", "FF"].map(f => faces[f].edgeD), ...["NF", "FF"].map(f => Math.max(0, ...faces[f].layers.map(L => L.size))));
  const cover = coverRequired(exposure, FC, coverTable, maxBar);
  cover.input = C;
  cover.pass = cover.required == null ? null : C >= cover.required;
  cover.text = !exposure ? "exposure not stated; cover not checked against AS 3600 Table 4.10.3"
    : cover.tabulated == null ? "no cover is tabulated for " + exposure + " at " + FC + " MPa (Table " + cover.tableNo + ", " + cover.tableName + ")"
    : cover.required + " required: " + exposure + " at " + FC + " MPa, Table " + cover.tableNo + " (" + cover.tableName + ") gives " + cover.tabulated + (cover.concession ? " (Cl 4.3.2 concession)" : "") + (cover.govern === "bar" ? ", the N" + maxBar + " bar governs" : "") + (cover.other != null ? "; " + cover.other + (cover.otherConcession ? " (concession)" : "") + " with " + cover.otherTable + " formwork" : "");
  if (!exposure) warnings.push("Cover " + C + ": exposure class not stated, so the cover is not checked against AS 3600 Table 4.10.3 (secondary source).");
  else if (cover.tabulated == null) warnings.push("Cover " + C + ": AS 3600 Table " + cover.tableNo + " tabulates no cover for exposure " + exposure + " at f'c " + FC + " MPa; a higher grade is needed for that exposure. Check with the engineer (secondary source, Findings 12.3).");
  else if (cover.pass === false) warnings.push("Cover " + C + " each face is under the " + cover.required + " AS 3600 Table " + cover.tableNo + " (" + cover.tableName + ") gives for exposure " + exposure + " at f'c " + FC + " MPa" + (cover.govern === "bar" ? " (the N" + maxBar + " bar governs)" : "") + (cover.other != null && cover.other <= C && cover.otherTable === "rigid" ? "; " + cover.other + " would do with rigid formwork and intense compaction (Table 4.10.3.3)" : "") + ". Check with the engineer (secondary source, Findings 12.3).");
  if (exposure && cover.concession) warnings.push("Cover: the " + cover.tabulated + " for exposure " + exposure + " at f'c " + FC + " MPa is a bracketed value in AS 3600 Table " + cover.tableNo + " that applies only with the Cl 4.3.2 strength-grade concession. Check with the engineer.");

  // ---- minimum reinforcement (#33e): As / Ag per direction, both faces together, against AS 3600 Cl 11.7.1 ----
  // Only the face mats count (bars or mesh wires per metre); the perimeter, opening and insert bars are local.
  const minReo = { Ag: T * 1000, dirs: {}, pass: true, flags: [], source: MIN_REO.source, crack: MIN_REO.crack };
  ["H", "V"].forEach(d => {
    const per = {}; let As = 0;
    ["NF", "FF"].forEach(f => {
      const fa = faces[f]; let a = 0, what = "none";
      if (fa.mesh) { const s = fa.mesh.spec, long = fa.mesh.dir === d; a = long ? barAreaPerM(s.dl, s.pl) : barAreaPerM(s.dc, s.pc); what = fa.mesh.code + (long ? " long wires" : " cross wires") + " " + (long ? s.dl : s.dc) + " at " + (long ? s.pl : s.pc); }
      else { const L = fa.layers.find(q => q.dir === d); if (L) { a = barAreaPerM(L.size, L.sp); what = "N" + L.size + "-" + L.sp; } }
      per[f] = { As: Math.round(a), what: what, rho: a / minReo.Ag };
      As += a;
    });
    const rho = As / minReo.Ag, min = MIN_REO[d], pass = rho >= min - 1e-9;
    minReo.dirs[d] = { As: Math.round(As), rho: rho, rhoText: rho.toFixed(4), min: min, pass: pass, faces: per, word: d === "H" ? "horizontal" : "vertical" };
    if (!pass) {
      minReo.pass = false; minReo.flags.push(d);
      warnings.push("Minimum reinforcement: " + (d === "H" ? "horizontal" : "vertical") + " ρ " + rho.toFixed(4) + " (" + Math.round(As) + " mm²/m over both faces: " + ["NF", "FF"].map(f => f + " " + per[f].what).join(", ") + ") is under the AS 3600 Cl 11.7.1 minimum " + min + " for a wall (secondary source). Check with the engineer.");
    }
  });

  // setout from the panel edges: a fixer on the bed sets out with a tape from the nearest form edge
  const EDGEX = [["left edge", 0], ["right edge", PW]], EDGEY = [["bottom edge", 0], ["top edge", PH]];
  function edgeRef(G, v, force) {
    const g = force ? G.find(q => q[0] === force) : (Math.abs(v - G[0][1]) <= Math.abs(v - G[1][1]) ? G[0] : G[1]);
    const d = Math.round(v - g[1]), on = Math.abs(d) < 5;
    return { v: Math.round(v), grid: g[0], at: g[1], d: d, side: "", text: on ? "on the " + g[0] : fmt(Math.abs(d)) + " from the " + g[0] };
  }
  function panelSetout(b, lap) {
    const ax = barAxis(b); if (!ax) return null;
    const X = ax.X, cross = X ? EDGEY : EDGEX, along = X ? EDGEX : EDGEY, ends = X ? ["left", "right"] : ["bottom", "top"];
    const g = { dir: X ? "X" : "Y", dirWord: X ? "horizontal" : "vertical", ends: ends, line: edgeRef(cross, ax.p), from: edgeRef(along, ax.a), to: edgeRef(along, ax.b), laps: [] };
    if (b.line && b.run && b.run.n) { g.lineIndex = b.line; g.n = b.run.n; g.sp = b.run.sp; }
    if (lap) {
      if (b.lapPrev) g.laps.push({ end: ends[0], len: lap, a: g.from, b: edgeRef(along, ax.a + lap, g.from.grid) });
      if (b.lapNext) g.laps.push({ end: ends[1], len: lap, a: edgeRef(along, ax.b - lap, g.to.grid), b: g.to });
      g.laps.forEach(z => { z.text = fmt(z.len) + " lap at the " + z.end + " end, lap zone " + z.a.text + " to " + z.b.text; });
    }
    return g;
  }
  function runSetout(r, X, start, end) { r.grid = { cross: X ? "y" : "x", first: edgeRef(X ? EDGEY : EDGEX, start), last: edgeRef(X ? EDGEY : EDGEX, end), n: r.n, sp: r.sp }; }

  // ---- bars ----
  const bars = [], runs = [], chairs = [], wires = [], pieces = [];
  const polyLen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0, 0);
  function addRun(r) { r.id = "R" + runs.length; r.bars = []; runs.push(r); return r; }
  function addBar(run, o) {
    const b = Object.assign({ id: bars.length, layer: run.layer, run: run, size: run.size, type: "N", shape: "straight" }, o);
    b.geom = bendGeom(b.type, b.size, b.role || "main");   // insert component bars bend on fitment (4 db) pins
    b.geomLen = Math.round(polyLen(b.pts));
    b.len = Math.ceil(cutLength(b.pts, b.geom, 0) / 5) * 5;
    b.kg = b.len / 1000 * (KGM[b.type + b.size] || 0);
    const c = classify(b, b.geom);
    b.code = c.code; b.shapeName = c.name; b.dims = c.dims; b.dimStr = c.dimStr; b.flags = c.flags;
    b.grid = panelSetout(b, run.lap ? run.lap.len : 0);
    if (run.lap && (b.lapPrev || b.lapNext)) run.lap.lapped++;
    bars.push(b); run.bars.push(b); return b;
  }
  // a bar line [a, b] in stock lengths with laps, alternate lines staggered from the far end (as on the floor)
  function stockPieces(a, b, lap, odd) {
    if (b - a <= STOCK) return [[a, b]];
    if (odd) return stockPieces(-b, -a, lap, false).map(p => [-p[1], -p[0]]).reverse();
    const out = []; let s = a;
    for (;;) { if (b - s <= STOCK) { out.push([s, b]); break; } let e = s + STOCK; if (e > b - lap - 300) e = b - lap - 300; out.push([s, e]); s = e - lap; }
    return out;
  }
  const minus = (a, b, cuts) => { let segs = [{ s: a, e: b }]; cuts.forEach(c => { const out = []; segs.forEach(g => { if (c.b <= g.s || c.a >= g.e) { out.push(g); return; } if (c.a > g.s) out.push({ s: g.s, e: c.a, cut: true }); if (c.b < g.e) out.push({ s: c.b, e: g.e, cut: true }); }); segs = out; }); return segs; };
  // a bar line at p crossing (or passing within cover of) an opening stops cover short of it
  const cutsAt = (X, p, d) => HOLES.filter(h => X ? (p > h.y0 - C - d / 2 && p < h.y1 + C + d / 2) : (p > h.x0 - C - d / 2 && p < h.x1 + C + d / 2)).map(h => ({ a: (X ? h.x0 : h.y0) - C, b: (X ? h.x1 : h.y1) + C }));
  const TAG = { H: [0.07, 0.19, 0.31, 0.43], V: [0.09, 0.2, 0.83, 0.93] }, FRAC = [0.3, 0.55, 0.45, 0.7];
  const slot = id => ({ [bed + "1"]: 0, [bed + "2"]: 1, [top + "2"]: 2, [top + "1"]: 3 })[id];
  ["NF", "FF"].forEach(f => {
    const fa = faces[f];
    fa.layers.forEach((Ly, k) => {
      const id = f + (k + 1), X = Ly.dir === "H", d = Ly.size, z = zOf(f, Ly.depth);
      const len = X ? PW : PH, wid = X ? PH : PW;
      const n = Math.floor((wid - 2 * C - d) / Ly.sp) + 1;
      if (n < 2) { errors.push(FACE_NAME[f] + " line " + Ly.line + ": fewer than two bar lines fit; check the spacing and the panel size."); return; }
      const start = (wid - (n - 1) * Ly.sp) / 2;
      Ly.lap = lapUse({ size: d, sp: Ly.sp, cover: Ly.coverTo, below: fa.down ? z - d / 2 : 0, what: f + (k ? " inner" : " outer") });
      const run = addRun({ layer: id, size: d, dir: X ? "X" : "Y", sp: Ly.sp, n: n, kind: "main", z: z, face: f, lap: Ly.lap,
        label: n + " N" + d + "-" + Ly.sp + " " + Ly.dir + " · " + f,
        callout: "N" + d + "-" + Ly.sp + " " + f + " " + (X ? "HORIZONTAL" : "VERTICAL") + " (" + (k ? "INNER" : "OUTER") + " LAYER)" });
      for (let i = 0; i < n; i++) {
        const p = start + i * Ly.sp;
        minus(C, len - C, cutsAt(X, p, d)).filter(g => g.e - g.s >= 300).forEach(g => {
          const ps = stockPieces(g.s, g.e, Ly.lap.len, i % 2 === 1);
          ps.forEach((pc, j) => addBar(run, { pts: X ? [[pc[0], p, z], [pc[1], p, z]] : [[p, pc[0], z], [p, pc[1], z]], lapPrev: j > 0, lapNext: j < ps.length - 1, line: i + 1,
            setout: FACE_NAME[f].toLowerCase() + ", bar line " + (i + 1) + " of " + n, note: FACE_NAME[f] + " " + (k ? "inner" : "outer") + " layer, " + (X ? "horizontal" : "vertical") + "." + (g.cut ? " Stops " + C + " short of the opening." : "") }));
        });
      }
      const sl = slot(id);
      run.dist = { dir: run.dir, at: len * TAG[Ly.dir][sl], p0: start, p1: start + (n - 1) * Ly.sp, z: z + 15, frac: FRAC[sl] };
      runSetout(run, X, start, start + (n - 1) * Ly.sp);
    });
  });

  // ---- edge steel in each face: perimeter bars and opening bars, in the face's inner (edge) layer ----
  ["NF", "FF"].forEach(f => {
    const fa = faces[f]; if (!has(fa)) return;
    const id = f + "2", zH = zOf(f, fa.dH), zV = zOf(f, fa.dV), zD = zOf(f, fa.dD);
    if (F.perimeter) {
      const d = PANEL_EDGE.perim, e = C + d / 2;
      const lap = lapUse({ size: d, sp: 0, cover: C, below: fa.down ? zH - d / 2 : 0, what: f + " perimeter" });
      const edgeHoles = HOLES.filter(h => h.edge);
      const run = addRun({ layer: id, size: d, kind: "perim", face: f, lap: lap, label: "N16 PERIMETER · " + f, callout: "N16 PERIMETER BARS, " + f + ", ROUND THE PANEL EDGE, CROSSING AT THE CORNERS" + (edgeHoles.length ? ", STOPPING " + C + " SHORT OF " + edgeHoles.map(h => h.id).join(" AND ") : "") });
      // along each edge, stopping cover short of a door or notch that reaches it (#33f): the opening's own side bars
      // take over there; a stub under 300 between the corner and the opening is left out (the other edge's bar and the
      // opening bar cover it) and said so
      const line = (X, p, z, which) => minus(C, (X ? PW : PH) - C, cutsAt(X, p, d)).forEach(g => {
        const at = edgeHoles.find(h => X ? (Math.abs(g.s - h.x1 - C) < 0.5 || Math.abs(g.e - h.x0 + C) < 0.5) : (Math.abs(g.s - h.y1 - C) < 0.5 || Math.abs(g.e - h.y0 + C) < 0.5));
        if (g.e - g.s < 300) { warnings.push("Perimeter bar, " + which + " edge (" + FACE_NAME[f].toLowerCase() + "): the " + fmt(Math.round(g.e - g.s)) + " piece beside " + (at ? at.id : "the opening") + " is left out; the opening bar and the other edge's bar cover it."); return; }
        stockPieces(g.s, g.e, lap.len, false).forEach((pc, j, ps) => addBar(run, { pts: X ? [[pc[0], p, z], [pc[1], p, z]] : [[p, pc[0], z], [p, pc[1], z]], lapPrev: j > 0, lapNext: j < ps.length - 1, setout: which + " edge, " + f, note: "Perimeter bar along the " + which + " edge (" + FACE_NAME[f].toLowerCase() + ")." + (g.cut ? " Stops " + C + " short of " + (at ? at.id + " (" + at.kind + " " + at.edgeText + ")" : "the opening") + "; the opening bars take over there." : "") + " AS 3850.2 asks for at least one continuous perimeter bar; N16 is what the edge-lifter capacities assume (Findings 12.1)." }));
      });
      line(true, e, zH, "bottom"); line(true, PH - e, zH, "top"); line(false, e, zV, "left"); line(false, PW - e, zV, "right");
      if (edgeHoles.length) warnings.push("Perimeter bars (" + FACE_NAME[f].toLowerCase() + ") stop at " + edgeHoles.map(h => h.id + " (" + h.kind + " " + h.edgeText + ")").join(", ") + ", so the loop is not continuous; AS 3850.2 asks for a continuous perimeter bar, and whether it should turn up the jambs is a question for the engineer (Findings 12.1).");
      // the tag sits on the longest bottom-edge piece (a door may take the middle of that edge), else on the top edge
      const along = run.bars.filter(b => b.pts[0][1] === b.pts[1][1]).sort((a, b) => (a.pts[0][1] - b.pts[0][1]) || ((b.pts[1][0] - b.pts[0][0]) - (a.pts[1][0] - a.pts[0][0])));
      const tb = along[0] || run.bars[0];
      run.tagPos = edgeHoles.length && tb ? [tb.pts[0][0] + (tb.pts[1][0] - tb.pts[0][0]) * (f === bed ? 0.25 : 0.62), tb.pts[0][1], tb.pts[0][2]] : [PW * (f === bed ? 0.25 : 0.62), e, zH];
    }
    if (F.trims && HOLES.length) {
      const anyEdge = HOLES.some(h => h.edge);
      const run = addRun({ layer: id, size: PANEL_EDGE.trimSmall, kind: "trim", face: f, label: "OPENING BARS · " + f,
        callout: "1 BAR EACH SIDE OF EACH OPENING (N16 AT 1,500 OR MORE, ELSE N12), " + PANEL_EDGE.ext + " PAST THE CORNERS, + N12 × " + fmt(PANEL_EDGE.diagLen) + " DIAGONAL AT EACH CORNER, " + f + (anyEdge ? "; NO BAR OR DIAGONAL ALONG A PANEL EDGE, JAMB BARS RUN TO THE EDGE" : "") });
      const lo = C, hiX = PW - C, hiY = PH - C;
      HOLES.forEach(h => {
        const d = h.big ? PANEL_EDGE.trimBig : PANEL_EDGE.trimSmall, ext = PANEL_EDGE.ext;
        // a side that lies on a panel edge (the foot of a door, the open side of a notch) gets no bar: the panel stops
        // there (Findings 12.5 step 4); the bars along the other sides run out to that edge instead of 600 past the
        // corner, which is by design, not a shortening to flag
        const side = (X, p, a, b, z, which, onEdge, touchA, touchB) => {
          if (onEdge) return;
          const a1 = Math.max(a, lo), b1 = Math.min(b, X ? hiX : hiY), shortA = a1 > a && !touchA, shortB = b1 < b && !touchB, short = shortA || shortB, toEdge = (a1 > a && touchA) || (b1 < b && touchB);
          addBar(run, { size: d, pts: X ? [[a1, p, z], [b1, p, z]] : [[p, a1, z], [p, b1, z]], setout: which + " " + h.id, opening: h,
            note: "Opening bar " + which + " " + h.id + (h.edge ? " (" + h.kind + " " + h.edgeText + ")" : "") + ", " + ext + " past each corner" + (toEdge ? ", running to the panel edge" : "") + (short ? ", shortened at the panel edge (" + fmt(b1 - a1) + " instead of " + fmt(b - a) + ")" : "") + ". Trade-typical size and extension (Findings 12.1), not a cited standard." });
          if (short) warnings.push(h.id + " (" + FACE_NAME[f].toLowerCase() + "): the opening bar " + which + " it is shortened at the panel edge to " + fmt(b1 - a1) + ".");
        };
        side(true, h.y0 - C - d / 2, h.x0 - ext, h.x1 + ext, zH, "below", h.E.bottom, h.E.left, h.E.right);
        side(true, h.y1 + C + d / 2, h.x0 - ext, h.x1 + ext, zH, "above", h.E.top, h.E.left, h.E.right);
        side(false, h.x0 - C - d / 2, h.y0 - ext, h.y1 + ext, zV, "left of", h.E.left, h.E.bottom, h.E.top);
        side(false, h.x1 + C + d / 2, h.y0 - ext, h.y1 + ext, zV, "right of", h.E.right, h.E.bottom, h.E.top);
        // a diagonal across each corner, square to the crack line that runs out of the corner at 45°, set off the corner by cover;
        // a corner that sits on a panel edge is not a re-entrant corner and gets none
        const dd = PANEL_EDGE.diag, off = Math.max(100, C + dd), half = PANEL_EDGE.diagLen / 2, r2 = Math.SQRT1_2;
        [[h.x0, h.y0, -1, -1, "bottom-left"], [h.x1, h.y0, 1, -1, "bottom-right"], [h.x1, h.y1, 1, 1, "top-right"], [h.x0, h.y1, -1, 1, "top-left"]].forEach(c => {
          if (c[0] === 0 || c[0] === PW || c[1] === 0 || c[1] === PH) return;
          const cx = c[0] + c[2] * off * r2, cy = c[1] + c[3] * off * r2, ux = c[3] * r2, uy = -c[2] * r2;
          // clip the 1,200 bar to the panel inside cover
          let t0 = -half, t1 = half;
          [[ux, cx, lo, hiX], [uy, cy, lo, hiY]].forEach(q => { if (Math.abs(q[0]) < 1e-9) return; const ta = (q[2] - q[1]) / q[0], tb = (q[3] - q[1]) / q[0]; t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb)); });
          const short = t0 > -half + 0.5 || t1 < half - 0.5;
          if (t1 - t0 < 300) { warnings.push(h.id + " (" + FACE_NAME[f].toLowerCase() + "): no room for the " + c[4] + " diagonal; left out."); return; }
          addBar(run, { size: dd, pts: [[cx + ux * t0, cy + uy * t0, zD], [cx + ux * t1, cy + uy * t1, zD]], setout: "diagonal across the " + c[4] + " corner of " + h.id, opening: h,
            note: "N12 diagonal across the " + c[4] + " corner of " + h.id + ", centred " + off + " off the corner, for crack control (Findings 12.1)." + (short ? " Shortened at the panel edge." : "") });
        });
      });
      const h0 = HOLES[0];
      run.tagPos = [Math.max(C + 200, h0.x0 - 250), Math.min(PH - C - 200, h0.y1 + 350), zH];
    }
  });

  // ---- mesh: lay each mesh face with the shared layout (layMesh, #6 / Findings 11.4) ----
  const MSUM = [];
  ["NF", "FF"].forEach(f => {
    const fa = faces[f]; if (!fa.mesh) return;
    const ms = fa.mesh, s = ms.spec, X = ms.dir === "H", id = f + "1";
    const U0 = C, U1 = (X ? PW : PH) - C, V0 = C, V1 = (X ? PH : PW) - C, U = U1 - U0, V = V1 - V0;   // u along the long wires, v across
    const xy = (u, v) => X ? [u, v] : [v, u];
    const holes = HOLES.map(h => X ? { u0: h.x0 - C, u1: h.x1 + C, v0: h.y0 - C, v1: h.y1 + C, id: h.id } : { u0: h.y0 - C, u1: h.y1 + C, v0: h.x0 - C, v1: h.x1 + C, id: h.id });
    const made = cfg.meshSheets !== "stock" && U <= MESH_MADE.L && V <= MESH_MADE.W;
    if (cfg.meshSheets !== "stock" && !made) warnings.push(FACE_NAME[f] + " mesh: " + fmt(U) + " × " + fmt(V) + " inside cover is larger than a made-to-size sheet (" + fmt(MESH_MADE.L) + " × " + fmt(MESH_MADE.W) + "); laid as lapped stock sheets.");
    const run = addRun({ layer: id, kind: "mesh", face: f, size: s.dl, code: ms.code, mesh: [], label: ms.code + " " + ms.dir + " · " + f, callout: "" });
    const res = layMesh({ U0: U0, U1: U1, V0: V0, V1: V1, holes: holes, spec: s, code: ms.code, layer: id, run: run, xy: xy, zL: zOf(f, ms.dLong), zC: zOf(f, ms.dCross), made: made, C: C,
      dirShort: ms.dir, dirWord: X ? "horizontal" : "vertical", extra: { face: f } }, { pieces: pieces, wires: wires });
    const LAP = res.LAP;
    if (res.lapped) warnings.push(FACE_NAME[f] + " mesh laps " + LAP.end + " end / " + LAP.side + " side are placeholders (AS 3600 Cl 13.2.3 geometry with the fly ends trimmed, Findings 11.3); confirm the mesh lap rule.");
    run.mesh.forEach(pc => { pc.pos = fmt(Math.round(pc.x0)) + " from the left edge, " + fmt(Math.round(pc.y0)) + " from the bottom edge"; });
    run.n = run.mesh.length;
    run.label = ms.code + " " + ms.dir + " · " + f + (run.mesh.length > 1 ? " · " + run.mesh.length + " SHEETS" : "");
    run.callout = ms.code + " " + f + ", LONG WIRES " + (X ? "HORIZONTAL" : "VERTICAL") + ", " + (made ? "ONE SHEET MADE TO SIZE " + fmt(U) + " × " + fmt(V) : run.mesh.length + " SHEETS FROM 6.0 × 2.4 STOCK, LAPS " + LAP.end + " END / " + LAP.side + " SIDE");
    const p0 = run.mesh[0];
    if (p0) run.tagPos = [p0.x0 + (p0.x1 - p0.x0) * (f === bed ? 0.22 : 0.4), p0.y0 + (p0.y1 - p0.y0) * (f === bed ? 0.3 : 0.62), zOf(f, ms.dCross)];
    MSUM.push(meshSummary(run, res.area));
  });

  // ---- concrete: net area, mass and centre of gravity (Findings 12.1; density 2,400 is an open question) ----
  const DENS = num(cfg.density) || 2400;
  const gross = PW * PH, holeA = HOLES.map(h => (h.x1 - h.x0) * (h.y1 - h.y0)), net = gross - holeA.reduce((s, a) => s + a, 0);
  const cogX = (gross * PW / 2 - HOLES.reduce((s, h, i) => s + holeA[i] * (h.x0 + h.x1) / 2, 0)) / net;
  const cogY = (gross * PH / 2 - HOLES.reduce((s, h, i) => s + holeA[i] * (h.y0 + h.y1) / 2, 0)) / net;
  const panel = { W: PW, H: PH, T: T, area: net / 1e6, volume: net * T / 1e9, mass: net * T / 1e9 * DENS, density: DENS, cog: { x: Math.round(cogX), y: Math.round(cogY) }, castFace: bed, topFace: top, sheets: cfg.meshSheets === "stock" ? "stock" : "made", fcLift: FCL };

  // ---- cast-in inserts (#33c): positions from the erection designer's drawing, checked against the catalogue ----
  // Each row names a catalogue type and where it goes: an edge anchor by its position along the top / bottom / left /
  // right edge (centred in the thickness), a face insert by x, y on NF or FF. Hard checks (catalogue minimums, the COP
  // placement rules) and advisory checks are listed on the insert and repeated as warnings; a failed hard check never
  // stops the build — the engineer moves the insert. Component bars come from the catalogue entry, are tagged with the
  // insert's id and scheduled with the panel's bars (Findings 12.5 steps 5–7).
  const INS = [], insBodies = [], insFlags = [];
  const EDGE_WORD = { top: "top edge", bottom: "bottom edge", left: "left edge", right: "right edge" };
  const EDGE_IN = { top: [0, -1], bottom: [0, 1], left: [1, 0], right: [-1, 0] };   // unit vector from the edge into the panel
  (Array.isArray(cfg.inserts) ? cfg.inserts : []).forEach((o, i) => {
    const id = (String(o.id == null ? "" : o.id).trim().toUpperCase().replace(/\s+/g, "") || "I" + (i + 1)).slice(0, 8);
    const where = "Insert " + (i + 1) + " (" + id + "): ";
    const cat = INSERT_CAT.items[String(o.type == null ? "" : o.type).trim().toUpperCase()];
    if (!cat) { errors.push(where + "unknown insert type " + JSON.stringify(o.type == null ? "" : String(o.type)) + "; pick one from the catalogue."); return; }
    const at = String(o.edge == null ? "" : o.edge).trim(), isEdge = !!EDGE_WORD[at], isFace = at === "NF" || at === "FF";
    if (cat.place === "edge" && !isEdge) { errors.push(where + cat.name + " is an edge anchor; place it in the top, bottom, left or right edge."); return; }
    if (cat.place === "face" && !isFace) { errors.push(where + cat.name + " sits in a face; place it on NF or FF."); return; }
    let x = num(o.x), y = num(o.y);
    if (isEdge) { if (at === "top") y = PH; else if (at === "bottom") y = 0; else if (at === "left") x = 0; else x = PW; }
    const alongX = at === "top" || at === "bottom";
    if (!isFinite(x) || !isFinite(y)) { errors.push(where + (isEdge ? "give its position along the " + EDGE_WORD[at] + " (" + (alongX ? "x from the left edge" : "y from the bottom edge") + ")." : "give x (from the left edge) and y (from the bottom edge).")); return; }
    if (x < 0 || x > PW || y < 0 || y > PH) { errors.push(where + "is off the panel."); return; }
    if (INS.some(q => q.id === id)) { errors.push(where + "another insert already has this id."); return; }
    const inHole = HOLES.find(h => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);   // an edge anchor in a door or notch too (#33f)
    if (inHole) { errors.push(where + "sits in " + (inHole.edge ? inHole.id + " (" + inHole.kind + " " + inHole.edgeText + "); there is no concrete there" : "an opening") + "."); return; }
    const face = isFace ? at : null;
    if (isFace && !has(faces[face])) warnings.push(where + "placed on the " + FACE_NAME[face].toLowerCase() + ", which has no reinforcement.");
    const ins = { id: id, row: i + 1, type: cat.key, cat: cat, kind: cat.kind, kindName: INSERT_KIND[cat.kind], place: cat.place, edge: isEdge ? at : null, face: face, x: x, y: y,
      z: isEdge ? T / 2 : (faces[face].down ? 0 : T), along: isEdge ? (alongX ? x : y) : null, checks: [], fails: [], advis: [], bars: [], layer: "IN",
      pos: isEdge ? fmt(alongX ? x : y) + " from the " + (alongX ? "left" : "bottom") + " edge, in the " + EDGE_WORD[at] : fmt(x) + " from the left edge, " + fmt(y) + " from the bottom edge, on " + face,
      short: cat.brand + " " + cat.name.replace(/^SwiftLift /, "").replace(/ edge lift$/, "").replace(/ (brace insert|ferrule)/, "") };
    ins.wll = cat.kind === "lifter" ? insertWll(cat, FCL) : { wll: null, at: null, text: cat.wllText || "see the catalogue" };
    INS.push(ins);
  });
  const rectDist = (x, y, h) => Math.hypot(Math.max(h.x0 - x, 0, x - h.x1), Math.max(h.y0 - y, 0, y - h.y1));
  const nearestHole = ins => HOLES.reduce((b, h) => { const d = rectDist(ins.x, ins.y, h); return !b || d < b.d ? { d: d, h: h } : b; }, null);
  // one check: value against its minimum (or a plain pass / fail); a failed hard check is a flag, a failed advisory a note
  function check(ins, rule, hard, pass, text, value, min) {
    ins.checks.push({ rule: rule, hard: hard, pass: pass, text: text, value: value == null ? null : Math.round(value), min: min == null ? null : min });
    if (!pass) (hard ? ins.fails : ins.advis).push(rule);
    return pass;
  }
  const ge = (v, m) => v + 1e-6 >= m;
  INS.forEach(ins => {
    const cat = ins.cat, who = "Insert " + ins.row + " (" + ins.id + ", " + ins.short + ")";
    if (cat.T) check(ins, "thickness", true, T >= cat.T[0] && T <= cat.T[1], "panel " + T + " thick; published for " + cat.T[0] + "–" + cat.T[1], T, cat.T[0]);
    if (ins.kind === "lifter" && ins.wll.below) check(ins, "fc-lift", true, false, "no WLL published below " + ins.wll.below + " MPa; f'c at lift is " + FCL, FCL, ins.wll.below);
    if (ins.edge) {
      check(ins, "centred", true, true, "centred in the thickness (" + T / 2 + " from each face)", T / 2, null);
      const L = ins.edge === "top" || ins.edge === "bottom" ? PW : PH, dEnd = Math.min(ins.along, L - ins.along);
      if (cat.em) check(ins, "edge", true, ge(dEnd, cat.em), fmt(dEnd) + " to the panel corner; catalogue edge distance " + cat.em, dEnd, cat.em);
      const nh = nearestHole(ins);
      if (nh && cat.em) check(ins, "opening", true, ge(nh.d, cat.em), fmt(nh.d) + " to " + nh.h.id + "; catalogue edge distance " + cat.em, nh.d, cat.em);
      const others = INS.filter(q => q !== ins && q.kind === "lifter");
      if (others.length && cat.am) {
        const q = others.reduce((b, o) => { const d = Math.hypot(o.x - ins.x, o.y - ins.y); return !b || d < b.d ? { d: d, o: o } : b; }, null), am = Math.max(cat.am, q.o.cat.am || 0);
        check(ins, "spacing", true, ge(q.d, am), fmt(q.d) + " to " + q.o.id + "; catalogue spacing " + am, q.d, am);
      }
    } else {
      const dEdge = Math.min(ins.x, PW - ins.x, ins.y, PH - ins.y), c1 = cat.c1 || 0, minE = ins.kind === "brace" ? Math.max(INSERT_RULES.braceEdge, c1) : c1;
      if (minE) check(ins, "edge", true, ge(dEdge, minE), fmt(dEdge) + " to the nearest panel edge; minimum " + minE + (ins.kind === "brace" && INSERT_RULES.braceEdge >= c1 ? " (brace inserts 300 from an edge, COP)" : " (catalogue c1)"), dEdge, minE);
      const nh = nearestHole(ins);
      if (nh && c1) check(ins, "opening", true, ge(nh.d, c1), fmt(nh.d) + " to " + nh.h.id + "; catalogue c1 " + c1, nh.d, c1);
      const same = INS.filter(q => q !== ins && q.face === ins.face && q.kind !== "lifter");
      if (same.length && cat.s1) {
        const q = same.reduce((b, o) => { const d = Math.hypot(o.x - ins.x, o.y - ins.y); return !b || d < b.d ? { d: d, o: o } : b; }, null), s1 = Math.max(cat.s1, q.o.cat.s1 || 0);
        check(ins, "spacing", true, ge(q.d, s1), fmt(q.d) + " to " + q.o.id + "; catalogue spacing s1 " + s1, q.d, s1);
      }
      if (ins.kind === "brace") {
        const lifters = INS.filter(q => q.kind === "lifter" && q.edge);
        if (lifters.length) {
          const q = lifters.reduce((b, o) => { const d = o.edge === "top" || o.edge === "bottom" ? Math.abs(o.x - ins.x) : Math.abs(o.y - ins.y); return !b || d < b.d ? { d: d, o: o } : b; }, null);
          check(ins, "lifter-line", true, ge(q.d, INSERT_RULES.braceOffLifter), fmt(q.d) + " off the line of lifter " + q.o.id + "; at least " + INSERT_RULES.braceOffLifter + " so the brace hangs clear (COP)", q.d, INSERT_RULES.braceOffLifter);
        }
      }
    }
    if (ins.kind === "lifter" && ins.face) check(ins, "edge", false, ge(Math.min(ins.x, PW - ins.x, ins.y, PH - ins.y), 300), "face lifter: edge distance not published for this anchor; " + fmt(Math.min(ins.x, PW - ins.x, ins.y, PH - ins.y)) + " to the nearest edge", null, null);
    // the assumed panel reinforcement behind the published capacity (mesh + perimeter bar, centrally placed)
    if (cat.assumes) { const okA = F.perimeter && ["NF", "FF"].some(f => faces[f].mesh); check(ins, "assumes", false, okA, "WLL assumes " + cat.assumes + (okA ? "" : "; this panel has " + (F.perimeter ? "" : "no perimeter bars and ") + (["NF", "FF"].some(f => faces[f].mesh) ? "mesh" : "bars, no mesh")), null, null); }
    ins.fails.forEach(rule => { const c = ins.checks.find(k => k.rule === rule); warnings.push(who + " fails the " + rule.replace("-", " ") + " check: " + c.text + "."); });
  });
  // panel-level lifter and brace rules (advisory)
  const lifters = INS.filter(q => q.kind === "lifter"), braces = INS.filter(q => q.kind === "brace");
  const advise = (rule, text) => { insFlags.push({ rule: rule, text: text }); warnings.push(text); };
  if (lifters.length === 1) advise("lifter-count", "Lifters: one lifter only; panels are lifted on 2 to 16 anchors (COP). Check with the erection designer.");
  if (INSERT_RULES.lifterCounts.indexOf(lifters.length) >= 0) advise("lifter-count", "Lifters: " + lifters.length + " lifters; the any-two-of-four rule avoids 3, 6, 9 or 12 lifting points (QLD COP s14.1.1). Check with the erection designer.");
  if (lifters.length >= 2) {
    const horiz = lifters.filter(q => !q.edge || q.edge === "top" || q.edge === "bottom"), vert = lifters.filter(q => q.edge === "left" || q.edge === "right");
    const mx = horiz.length ? horiz.reduce((s, q) => s + q.x, 0) / horiz.length : null, my = vert.length ? vert.reduce((s, q) => s + q.y, 0) / vert.length : null;
    if (mx != null && Math.abs(mx - cogX) > INSERT_RULES.symmetry) advise("lifter-symmetry", "Lifters: their centre (" + fmt(mx) + " from the left edge) is " + fmt(Math.abs(mx - cogX)) + " off the centre of gravity (" + fmt(cogX) + "); the panel will hang out of plumb. Check with the erection designer.");
    if (my != null && Math.abs(my - cogY) > INSERT_RULES.symmetry) advise("lifter-symmetry", "Lifters: their centre (" + fmt(my) + " from the bottom edge) is " + fmt(Math.abs(my - cogY)) + " off the centre of gravity (" + fmt(cogY) + "). Check with the erection designer.");
  }
  if (braces.length === 1) advise("brace-count", "Braces: one brace insert only; at least two braces per element (COP).");
  if (braces.length) { const by = braces.reduce((s, q) => s + q.y, 0) / braces.length; if (by > INSERT_RULES.braceHeight * PH) advise("brace-height", "Braces: their centroid " + fmt(by) + " up is above 60 % of the height (" + fmt(INSERT_RULES.braceHeight * PH) + "); advisory rule of thumb."); }

  // component bars from the catalogue: tagged with the insert's id, one run per insert (its 3D body is drawn with them)
  const faceSteel = bars.concat(wires);
  function roomCheck(ins, b, what) {
    // inside the panel less cover and clear of the openings by cover; crossing face steel at least a bar apart
    let bad = null;
    b.pts.forEach(p => { if (p[0] < C - 0.5 || p[0] > PW - C + 0.5 || p[1] < C - 0.5 || p[1] > PH - C + 0.5 || p[2] < C - 0.5 || p[2] > T - C + 0.5) bad = bad || "leaves the panel (less cover)"; });
    for (let i = 1; i < b.pts.length && !bad; i++) for (let k = 0; k <= 20 && !bad; k++) {
      const t = k / 20, p = b.pts[i - 1], q = b.pts[i], x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
      const h = HOLES.find(o => x > o.x0 - C + 1 && x < o.x1 + C - 1 && y > o.y0 - C + 1 && y < o.y1 + C - 1); if (h) bad = "runs into " + h.id;
    }
    for (let i = 1; i < b.pts.length && !bad; i++) {
      const p = b.pts[i - 1], r = [b.pts[i][0] - p[0], b.pts[i][1] - p[1]];
      for (let j = 0; j < faceSteel.length && !bad; j++) {
        const o = faceSteel[j]; if (o.pts.length !== 2) continue;
        const q = o.pts[0], u = [o.pts[1][0] - q[0], o.pts[1][1] - q[1]], den = r[0] * u[1] - r[1] * u[0]; if (Math.abs(den) < 1e-6) continue;
        const t = ((q[0] - p[0]) * u[1] - (q[1] - p[1]) * u[0]) / den, s = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
        if (t <= 0 || t >= 1 || s <= 0 || s >= 1) continue;
        const dz = Math.abs(p[2] + t * (b.pts[i][2] - p[2]) - (q[2] + s * (o.pts[1][2] - q[2])));
        if (dz < (b.size + o.size) / 2 - 0.5) bad = "crosses " + (o.wire ? "the " + o.sheet.code + " mesh" : o.run.label) + " in one plane";
      }
    }
    check(ins, "room-" + what, true, !bad, "the " + what + " bar " + (bad || "fits: inside cover, clear of openings and of the face steel"), null, null);
    if (bad) warnings.push("Insert " + ins.row + " (" + ins.id + ", " + ins.short + "): its " + what + " bar " + bad + ". Move the insert or check the detail with the supplier.");
  }
  INS.forEach(ins => {
    const cat = ins.cat, dz = ins.face ? (faces[ins.face].down ? 1 : -1) : 0;
    const run = addRun({ layer: "IN", size: cat.bars.length ? cat.bars[0].size : 0, kind: "insert", insert: ins, face: ins.face,
      label: ins.id + " · " + ins.short.replace(/^(Reid|Ancon) /, ""),
      callout: (ins.kindName + " " + ins.id + ": " + cat.brand + " " + cat.name + ", " + ins.pos + (ins.kind === "lifter" ? ", WLL " + ins.wll.text : "") + (cat.bars.length ? "; " + cat.bars.map(cb => cb.role + " bar N" + cb.size + (cb.shape === "TB" ? " legs " + cb.leg + " at " + cb.angle + "°" : cb.shape === "U" ? " legs " + cb.leg + " × " + cb.width : " × " + cb.len)).join(", ") : "; no component bars")).toUpperCase() });
    run.tagPos = ins.edge ? [ins.x + (EDGE_IN[ins.edge][0] * 120), ins.y + EDGE_IN[ins.edge][1] * 120, ins.z] : [ins.x, ins.y, ins.z + dz * 40];
    ins.run = run; ins.label = run.label;
    if (ins.edge) {
      const n = EDGE_IN[ins.edge], a = [Math.abs(n[1]), Math.abs(n[0])], E = cat.embed || 200, P = [ins.x + n[0] * E, ins.y + n[1] * E];
      insBodies.push({ pts: [[ins.x, ins.y, ins.z], [P[0], P[1], ins.z]], size: cat.body || 30, insert: ins, layer: "IN", kind: "body" });
      cat.bars.forEach(cb => {
        const g = bendGeom("N", cb.size, "fitment");   // the suppliers' component bars bend on 4 db pins (Reid 3Dx document)
        if (cb.shape === "TB") {
          const Lc = cb.leg - cb.size / 2, th = cb.angle / 2 * Math.PI / 180, d1 = [n[0] * Math.cos(th) + a[0] * Math.sin(th), n[1] * Math.cos(th) + a[1] * Math.sin(th)], d2 = [n[0] * Math.cos(th) - a[0] * Math.sin(th), n[1] * Math.cos(th) - a[1] * Math.sin(th)];
          const b = addBar(run, { size: cb.size, shape: "TB", role: "fitment", insert: ins, pts: [[P[0] + d1[0] * Lc, P[1] + d1[1] * Lc, ins.z], [P[0], P[1], ins.z], [P[0] + d2[0] * Lc, P[1] + d2[1] * Lc, ins.z]], setout: "through the lower hole of " + ins.id, note: "Tension bar for " + ins.kindName + " " + ins.id + " (" + ins.short + "): N" + cb.size + ", legs " + cb.leg + " at " + cb.angle + "° included, bent on a " + g.dp + " pin (4 db), through the anchor's lower hole in the panel plane (" + cat.doc + "). The hole is placed " + E + " in from the edge: a placeholder until the anchor drawing is read." });
          ins.bars.push(b); roomCheck(ins, b, "tension");
        } else if (cb.shape === "U") {
          const Lc = cb.leg - cb.size / 2, w = cb.width, notch = C + cb.size, Q = [ins.x + n[0] * notch, ins.y + n[1] * notch];
          const b = addBar(run, { size: cb.size, shape: "U-bar", role: "fitment", insert: ins, pts: [[Q[0] + n[0] * Lc, Q[1] + n[1] * Lc, ins.z - w / 2], [Q[0], Q[1], ins.z - w / 2], [Q[0], Q[1], ins.z + w / 2], [Q[0] + n[0] * Lc, Q[1] + n[1] * Lc, ins.z + w / 2]], setout: "over the notch of " + ins.id, note: "Shear bar for " + ins.kindName + " " + ins.id + " (" + ins.short + "): N" + cb.size + " U, legs " + cb.leg + ", " + w + " wide, hooked over the anchor's notch with a leg each side of the plate, legs running into the panel (" + cat.doc + "). Read as a hairpin over the anchor: confirm against the supplier's drawing." });
          ins.bars.push(b); roomCheck(ins, b, "shear");
        } else {
          const b = addBar(run, { size: cb.size, shape: "straight", role: "fitment", insert: ins, pts: [[P[0] - a[0] * cb.len / 2, P[1] - a[1] * cb.len / 2, ins.z], [P[0] + a[0] * cb.len / 2, P[1] + a[1] * cb.len / 2, ins.z]], setout: "through the hole of " + ins.id, note: "Tension bar for " + ins.kindName + " " + ins.id + " (" + ins.short + "): N" + cb.size + " × " + cb.len + " straight through the anchor's hole, along the edge (" + cat.doc + "). The hole is placed " + E + " in from the edge: a placeholder until the anchor drawing is read." });
          ins.bars.push(b); roomCheck(ins, b, "tension");
        }
      });
    } else {
      const zF = ins.z, L = cat.len || Math.round(T / 2);
      insBodies.push({ pts: [[ins.x, ins.y, zF], [ins.x, ins.y, zF + dz * L]], size: cat.body || 24, insert: ins, layer: "IN", kind: "body" });
      cat.bars.forEach(cb => {
        if (cb.role === "floating") {
          [-1, 1].forEach(s => {
            const b = addBar(run, { size: cb.size, shape: "straight", role: "fitment", insert: ins, pts: [[ins.x - cb.len / 2, ins.y + s * cb.pair / 2, T / 2], [ins.x + cb.len / 2, ins.y + s * cb.pair / 2, T / 2]], setout: "clipped to " + ins.id, note: "Floating bar for " + ins.kindName + " " + ins.id + " (" + ins.short + "): one of two N" + cb.size + " × " + cb.len + " clipped to the anchor's foot (" + cat.doc + "). Placed at mid-thickness, " + cb.pair + " apart: placeholders until the anchor drawing is read." });
            ins.bars.push(b); roomCheck(ins, b, "floating");
          });
        } else {
          const depth = Math.max(C + cb.size / 2, L - cb.size), b = addBar(run, { size: cb.size, shape: "straight", role: "fitment", insert: ins, pts: [[ins.x - cb.len / 2, ins.y, zF + dz * depth], [ins.x + cb.len / 2, ins.y, zF + dz * depth]], setout: "through the cross hole of " + ins.id, note: "Cross bar for " + ins.kindName + " " + ins.id + " (" + ins.short + "): N" + cb.size + " × " + cb.len + " through the insert's cross hole, horizontal (" + cat.doc + "). Placed " + depth + " in from the face, at the insert's foot: a placeholder until the insert drawing is read." });
          ins.bars.push(b); roomCheck(ins, b, "cross");
        }
      });
    }
    ins.flagged = ins.fails.length > 0;
  });

  // ---- chairs under the top face: 800 centres for mesh (NCC Table 3.2.3.1 via Findings 11.3), 1,000 for bars as on the floor ----
  const tf = faces[top];
  if (has(tf)) {
    const pitch = tf.mesh ? 800 : 1000, zTop = T - tf.reoDepth;
    for (let x = pitch / 2; x < PW; x += pitch) for (let y = pitch / 2; y < PH; y += pitch) {
      if (x < C + 100 || x > PW - C - 100 || y < C + 100 || y > PH - C - 100) continue;
      if (HOLES.some(h => x > h.x0 - 100 && x < h.x1 + 100 && y > h.y0 - 100 && y < h.y1 + 100)) continue;
      chairs.push({ pts: [[x, y, 0], [x, y, zTop]], size: 8, chair: true, layer: "CH", pitch: pitch });
    }
  }

  // ---- layers and fixing order on the bed: the bed face first (outer, then inner / edge), chairs, then the top face ----
  // inserts go in after the chairs: the edge anchors with their component bars tied into the cage before the top face
  // closes it (a face insert on the bed face is set on the bed first; the step says so)
  const ORDER = [bed + "1", bed + "2", "CH", "IN", top + "2", top + "1"];
  const COLORS = { FF1: "#4f8fe8", FF2: "#3fc1c9", CH: "#9aa7b4", IN: "#b48cf0", NF2: "#e8a33d", NF1: "#e5534b" };
  const L1 = f => { const fa = faces[f]; return fa.mesh ? "mesh " + fa.mesh.code + " " + fa.mesh.dir : fa.layers[0] ? "outer bars N" + fa.layers[0].size + "-" + fa.layers[0].sp + " " + fa.layers[0].dir : "no steel"; };
  const L2 = f => { const fa = faces[f], edge = has(fa) && (F.perimeter || (F.trims && HOLES.length)); return fa.layers[1] ? "inner bars N" + fa.layers[1].size + "-" + fa.layers[1].sp + " " + fa.layers[1].dir + (edge ? " + edge bars" : "") : edge ? "edge bars" : "no steel"; };
  const insCount = () => { const n = {}; INS.forEach(q => { n[q.kind] = (n[q.kind] || 0) + 1; }); return ["lifter", "brace", "ferrule"].filter(k => n[k]).map(k => n[k] + " " + INSERT_KIND[k] + (n[k] > 1 ? "s" : "")).join(", "); };
  const LNAME = { CH: "Bar chairs", IN: "Inserts · " + (INS.length ? insCount() + (INS.some(q => q.bars.length) ? " + their bars" : "") : "none") };
  ["NF", "FF"].forEach(f => { LNAME[f + "1"] = FACE_NAME[f] + " · " + L1(f); LNAME[f + "2"] = FACE_NAME[f] + " · " + L2(f); });
  const SHORT = { CH: "Chairs", IN: "Inserts" };
  ["NF", "FF"].forEach(f => { SHORT[f + "1"] = f + (faces[f].mesh ? " mesh" : " outer"); SHORT[f + "2"] = f + (faces[f].layers[1] ? " inner" : " edge"); });
  const PLAYERS = ORDER.map((id, i) => ({ id: id, name: LNAME[id] + (id[0] + id[1] === bed && id !== "CH" && id !== "IN" ? ", on the bed" : ""), short: SHORT[id], css: COLORS[id], idx: i }));
  const PLBY = {}; PLAYERS.forEach(l => { PLBY[l.id] = l; });
  const PEXPLODE = {}; ORDER.forEach((id, i) => { PEXPLODE[id] = [0, 0.25, 0, 0.45, 0.6, 0.9][i]; });
  const stepTitle = id => {
    if (id === "CH") return "Bar chairs";
    if (id === "IN") return "Inserts";
    const f = id.slice(0, 2), fa = faces[f], k = id[2];
    if (k === "1") return FACE_NAME[f] + (fa.mesh ? " mesh" : " outer bars");
    return FACE_NAME[f] + (fa.layers[1] ? " inner bars" : " edge bars");
  };
  const stepSub = id => {
    if (id === "CH") return chairs.length ? chairs[0].pitch + " both ways, under the " + top + " steel" : "none";
    if (id === "IN") { if (!INS.length) return "none"; const nb = INS.reduce((s, q) => s + q.bars.length, 0), flagged = INS.filter(q => q.flagged).length; return insCount() + (nb ? " · " + nb + " component bar" + (nb > 1 ? "s" : "") : "") + (INS.some(q => q.face === bed) ? " · " + bed + " face inserts set on the bed first" : "") + (flagged ? " · " + flagged + " flagged" : ""); }
    const f = id.slice(0, 2), list = runs.filter(r => r.layer === id);
    const bits = list.map(r => r.kind === "mesh" ? r.mesh.length + (r.mesh.length > 1 ? " sheets " : " sheet ") + faces[f].mesh.code : r.kind === "perim" ? "N16 perimeter" : r.kind === "trim" ? "opening bars" : "N" + r.size + "-" + r.sp + " " + (r.dir === "X" ? "H" : "V"));
    return (bits.length ? bits.join(" · ") : "no steel") + (f === bed ? " · on the bed" : "");
  };
  const nBox = HOLES.filter(h => !h.edge).length, nEdge = HOLES.filter(h => h.edge).length;
  const steps = [{ title: "Formwork", sub: "casting bed and side forms" + (nBox ? ", " + nBox + " opening box" + (nBox > 1 ? "es" : "") : "") + (nEdge ? ", " + nEdge + " door / notch form" + (nEdge > 1 ? "s" : "") + " in the side forms" : "") + "; " + bed + " face down", c: null }]
    .concat(ORDER.map(id => ({ title: stepTitle(id), sub: stepSub(id), c: COLORS[id] })));

  // ---- marks: bars by shape and length, mesh pieces by code and cut size; prefixed with the panel mark ----
  const sched = bars.slice();
  const groups = new Map();
  sched.forEach(b => { const k = b.type + b.size + "|" + b.code + "|" + b.len + "|" + b.dimStr; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
  const pad = i => (i < 10 ? "0" : "") + i;
  const marks = [...groups.values()].sort((A, B) => (PLBY[A[0].layer].idx - PLBY[B[0].layer].idx) || (B[0].size - A[0].size) || (B[0].len - A[0].len)).map((list, i) => {
    const m = name + "-" + pad(i + 1);
    list.forEach(b => { b.mark = m; });
    return { mark: m, type: list[0].type, size: list[0].size, shape: list[0].shape, code: list[0].code, shapeName: list[0].shapeName, dims: list[0].dims, dimStr: list[0].dimStr, flags: list[0].flags, pin: list[0].geom.dp, len: list[0].len, qty: list.length, layer: list[0].layer, kg: list.reduce((s, b) => s + b.kg, 0) };
  });
  meshMarks(pieces, marks, name + "-");
  runs.forEach(r => { r.marks = r.kind === "mesh" ? [...new Set(r.mesh.map(pc => pc.mark))] : [...new Set(r.bars.map(b => b.mark))]; });
  const kgBars = sched.reduce((s, b) => s + b.kg, 0), kgMesh = pieces.reduce((s, p) => s + p.kg, 0);
  LAPS.rows.filter(r => r.short && r.lapped).forEach(r => warnings.push("Lap N" + r.size + " panel (" + r.what.join(", ") + "): " + r.len + " (project flat lap) is shorter than AS 3600 " + r.calc.rule + " gives, " + r.calc.lap + " (" + r.calc.detail + "). Check with the engineer."));

  const SL = { x0: 0, y0: 0, x1: PW, y1: PH };
  return { kind: "panel", cfg: cfg, errors: errors, warnings: warnings, name: name, panel: panel, faces: faces, mats: {}, Z: {}, T: T, C: C, L: PW, W: PH, SL: SL, EXT: SL,
    GX: [], GY: [], gx: [0, PW], gy: [0, PH], HOLES: HOLES, outline: outline, DROPS: [], STEP: null, BALCS: [], BEAMS: [], COLS: [], COL: 400, COLB: -10, PROJ: 0,
    bars: bars, wires: wires, meshPieces: pieces, meshSummary: MSUM, runs: runs, chairs: chairs, sched: sched, marks: marks, kg: kgBars + kgMesh, kgBars: kgBars, kgMesh: kgMesh, laps: LAPS,
    inserts: INS, insertBodies: insBodies, insertFlags: insFlags, catalogue: { edition: INSERT_CAT.edition, date: INSERT_CAT.date },
    cover: cover, minReo: minReo,
    LAYERS: PLAYERS, LBY: PLBY, EXPLODE: PEXPLODE, ORDER: ORDER, steps: steps, lvl: () => 0 };
}

export { PANEL_CFG, FACE_NAME, PANEL_EDGE, panelOutline, buildPanel };
