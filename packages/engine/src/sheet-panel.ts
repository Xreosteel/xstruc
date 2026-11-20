// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { fmt } from "./bending.ts";
import { boxAt, boxHit, noteBoxes, txtW } from "./sheet-annotate.ts";

// ---------- panel elevation sheet (backlog #33d, Findings 12.6) ----------
// A precast panel's sheet carries what the shop drawing and the COP ask for beyond the bars: every cast-in insert as a
// symbol with its WLL and its x / y from the bottom-left corner, the centre of gravity, a notes block (mark, size,
// mass, f'c in service and at lift, cast face, casting and lift-date fields), an approval block, a legend of the
// symbols, and an insert table. The symbols are X Struc's own until the AS 3850.2 symbols are checked (paywalled):
// lifter = circle, brace insert = square, ferrule = circled cross, CoG = quartered circle. Everything is paper text
// and plan geometry like the rest of the sheet, so it prints at scale and a DXF / PDF export can write it.
const PANEL_SHEET = { lifter: 200, brace: 160, ferrule: 150, cog: 170, label: 150, note: 150, notePitch: 215, tableTxt: 130, tablePitch: 200, colW: 4100, colGap: 900 };
const PANEL_TABLE_COLS = [["id", "ID", 480], ["kind", "KIND", 1250], ["type", "TYPE", 2400], ["wll", "WLL AT f'c LIFT", 2100], ["x", "X", 650], ["y", "Y", 650], ["where", "WHERE", 850], ["bars", "COMPONENT BARS", 1700], ["checks", "CHECKS", 1600]];
function sheetPanelSymbols(M, S, want) {
  S.inserts = []; S.cog = null;
  noteBoxes(S);
  const holes = S.concrete.holes, obstacles = S.notes.map(n => n.box).concat(holes), B = S.bounds;
  const clear = r => r.x0 >= B.x0 && r.x1 <= B.x1 && r.y0 >= B.y0 && r.y1 <= B.y1 && !obstacles.some(q => boxHit(r, q, 30));
  const union = (p, q) => ({ x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1), y0: Math.min(p.y0, q.y0), y1: Math.max(p.y1, q.y1) });
  const P = M.panel, H = PANEL_SHEET.label;
  // one symbol per insert, on the Inserts sheet and the finished panel in ink, faint where the inserts are already in
  if ("IN" in want) (M.inserts || []).forEach(ins => {
    const sym = ins.kind === "lifter" ? "lifter" : ins.kind === "brace" ? "brace" : "ferrule", rs = PANEL_SHEET[sym];
    const label = ins.kind === "lifter" ? "WLL " + (ins.wll.wll != null ? ins.wll.wll + " t" : "n/a") : ins.kind === "brace" ? "BRACE" : "FERRULE";
    const coord = "x " + fmt(ins.x) + " · y " + fmt(ins.y);
    const line1 = ins.id + " · " + label, lw = Math.max(txtW(line1, H), txtW(coord, H)), lh = 2 * H * 1.35;
    // labels sit outside the panel for an edge anchor (above the top edge, below the bottom, beside a side) and under a face insert
    const out = ins.edge ? { top: [0, 1], bottom: [0, -1], left: [-1, 0], right: [1, 0] }[ins.edge] : [0, -1];
    const lx = ins.x + out[0] * (rs + 70 + lw / 2), ly = ins.y + out[1] * (rs + 70 + lh / 2);
    const symBox = boxAt(ins.x, ins.y, 2 * rs, 2 * rs), labBox = boxAt(lx, ly, lw, lh);
    const q = { id: ins.id, kind: ins.kind, sym: sym, x: ins.x, y: ins.y, r: rs, label: label, line1: line1, coord: coord, lx: lx, ly: ly, lw: lw, lh: lh, h: H, flagged: ins.flagged, ghost: want.IN, edge: ins.edge, face: ins.face, box: union(symBox, labBox), boxes: [symBox, labBox] };
    obstacles.push(symBox, labBox); S.inserts.push(q);
  });
  // the centre of gravity, marked on every panel sheet: the cross at the CoG, its text where it finds room (left, below, right, above)
  // clear of the notes, the openings and the insert symbols
  const cg = P.cog, r = PANEL_SHEET.cog;
  const cogText = "CoG " + fmt(cg.x) + " / " + fmt(cg.y), cw = txtW(cogText, H), ch = H * 1.4;
  const cogBox = boxAt(cg.x, cg.y, 2 * r, 2 * r);
  const tries = [];   // left, below, right, above, then the diagonals, each ring a text height further out
  for (let k = 0; k < 4; k++) [180, 270, 0, 90, 225, 315, 135, 45].forEach(a => {
    const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180), d = r + 60 + Math.abs(ca) * cw / 2 + Math.abs(sa) * ch / 2 + k * ch * 1.5;
    tries.push([Math.round(cg.x + ca * d), Math.round(cg.y + sa * d)]);
  });
  let at = tries.find(xy => clear(boxAt(xy[0], xy[1], cw, ch))) || tries[0];
  S.cog = { x: cg.x, y: cg.y, r: r, text: cogText, tx: at[0], ty: at[1], h: H, box: union(cogBox, boxAt(at[0], at[1], cw, ch)) };
}
// The cover and minimum-reinforcement lines of the notes block (#33e): what the record says the panel was checked to.
function coverNotes(M) {
  const cv = M.cover, head = "COVER " + M.C + " EACH FACE";
  if (!cv) return [head];
  if (!cv.exposure) return [head + " · EXPOSURE NOT STATED", "  NOT CHECKED AGAINST AS 3600 T4.10.3"];
  const tab = "  AS 3600 T" + cv.tableNo + " " + (cv.table === "rigid" ? "RIGID" : "STANDARD");
  if (cv.tabulated == null) return [head + " · " + cv.exposure + " AT " + cv.fc + " MPa: NONE TABULATED", tab + " · CHECK"];
  const out = [head + " · " + cv.exposure + " AT " + cv.fc + " MPa: " + cv.required + " REQ'D" + (cv.pass ? "" : " · FAILS"), tab + (cv.other != null ? " · " + cv.other + " IF " + cv.otherTable.toUpperCase() : "")];
  if (cv.concession) out.push("  CL 4.3.2 CONCESSION VALUE · CHECK");
  if (cv.govern === "bar") out.push("  N" + cv.maxBar + " BAR GOVERNS (COVER ≥ db)");
  return out;
}
function reoNotes(M) {
  const mr = M.minReo; if (!mr) return [];
  const d = k => { const q = mr.dirs[k]; return "REO " + k + " ρ " + q.rhoText + " · MIN " + q.min + (q.pass ? "" : " · FAILS"); };
  return [d("H") + " · AS 3600 CL 11.7.1", d("V")];
}
function sheetPanelBlocks(M, S, want) {
  const P = M.panel, INS = M.inserts || [], PW = M.L, PH = M.W, K = PANEL_SHEET, H = K.note, pitch = K.notePitch;
  const texts = [], rects = [], lines = [], glyphs = [];
  const pad = 120;
  // notes and approval stack down the right of the panel from its top edge; the legend sits under the panel on the
  // left; the insert table runs under both. Each block is a box with a title line and body lines.
  let x0 = PW + K.colGap, x1 = x0 + K.colW, y = PH;
  const block = (title, body, extra) => {
      const top = y;
      texts.push({ x: x0 + pad, y: y - pad - 100, h: 200, text: title, align: "left", weight: 700 });
      y -= pad + 200 + 60;
      body.forEach(t => { texts.push({ x: x0 + pad, y: y - H * 0.7, h: H, text: t, align: "left", weight: 500, maxW: x1 - x0 - 2 * pad }); y -= pitch; });
      if (extra) extra();
      y -= pad - (pitch - H);
      const r = { x0: x0, x1: x1, y0: y, y1: top }; rects.push(r); y -= 250; return r;
  };
  // notes block (12.6 / 12.4: what the COP wants on the drawing)
  const lifters = INS.filter(q => q.kind === "lifter"), braces = INS.filter(q => q.kind === "brace"), ferrules = INS.filter(q => q.kind === "ferrule");
  const byType = list => { const g = {}; list.forEach(q => { (g[q.short] = g[q.short] || []).push(q); }); return Object.keys(g).map(k => g[k].map(q => q.id).join(", ") + " " + k.toUpperCase() + (g[k][0].kind === "lifter" ? " · WLL " + (g[k][0].wll.wll != null ? g[k][0].wll.wll + " t AT " + P.fcLift + " MPa" : "NOT PUBLISHED AT " + P.fcLift + " MPa") : "")); };
  const notes = [
    fmt(PW) + " × " + fmt(PH) + " × " + M.T + " THK · " + P.area.toFixed(2) + " m² NET",
    "MASS " + fmt(P.mass) + " kg AT " + fmt(P.density) + " kg/m³ · " + P.volume.toFixed(2) + " m³",
    "CoG " + fmt(P.cog.x) + " FROM LEFT · " + fmt(P.cog.y) + " FROM BOTTOM",
    "f'c " + M.cfg.fc + " MPa IN SERVICE · " + P.fcLift + " MPa AT LIFT",
    ...coverNotes(M), ...reoNotes(M),
    P.castFace + " ON THE BED (CAST FACE) · " + P.topFace + " UP",
    "STEEL " + fmt(M.kg) + " kg · " + fmt(M.sched.length) + " BARS, " + M.marks.filter(m => !m.mesh).length + " MARKS" + (M.meshPieces.length ? " + " + M.meshPieces.length + " MESH SHEET" + (M.meshPieces.length > 1 ? "S" : "") : "")
  ].concat(byType(lifters), byType(braces), byType(ferrules), INS.length ? [] : ["NO INSERTS"], [
    "CAST DATE  ____ / ____ / ________",
    "LIFT NOT BEFORE  ____ / ____ / ________"
  ]);
  block("PANEL " + M.name.toUpperCase(), notes);
  // approval block (QLD COP s3.1: engineer review; fields carried from the inputs, blank lines where empty)
  const A = M.cfg.approval || {}, field = v => (v == null ? "" : String(v)).trim();
  const appr = { drawn: field(A.drawn), checked: field(A.checked), approved: field(A.approved), rev: field(A.rev) };
  const rowH = 300, cols = [x0, x0 + 1750, x0 + 3050, x1];
  block("APPROVAL · REV " + (appr.rev || "__"), [], () => {
    const rows = [["", "NAME", "DATE"], ["DRAWN", appr.drawn, ""], ["CHECKED", appr.checked, ""], ["ENGINEER APPROVED", appr.approved, ""]];
    rows.forEach((cells, i) => {
      const ry1 = y, ry0 = y - rowH;
      cells.forEach((t, j) => { texts.push({ x: cols[j] + 90, y: (ry0 + ry1) / 2, h: H, text: t, align: "left", weight: i ? 500 : 700, maxW: cols[j + 1] - cols[j] - 150 }); if (j) lines.push({ x0: cols[j], y0: ry0, x1: cols[j], y1: ry1 }); });
      lines.push({ x0: x0, y0: ry0, x1: x1, y1: ry0 });
      y -= rowH;
    });
  });
  const column = { x0: x0, x1: x1, y0: y + 250, y1: PH };
  // legend of the symbols, under the panel on the left (the overall dimension string sits at -700)
  const legend = [["lifter", "LIFTER · WLL AT f'c LIFT, x / y FROM THE BOTTOM-LEFT CORNER"], ["brace", "BRACE INSERT"], ["ferrule", "FIXING FERRULE"], ["cog", "CENTRE OF GRAVITY"]];
  x0 = 0; x1 = Math.max(PW, 5200); y = -1150;
  block("SYMBOLS", [], () => {
    legend.forEach(([sym, t]) => { glyphs.push({ sym: sym, x: x0 + pad + 170, y: y - pitch / 2 + 20, r: 120 }); texts.push({ x: x0 + pad + 420, y: y - pitch / 2 + 20, h: H, text: t, align: "left", weight: 500 }); y -= pitch; });
    texts.push({ x: x0 + pad, y: y - H * 0.7, h: 120, text: "X STRUC SYMBOLS · AS 3850.2 SYMBOLS NOT YET VERIFIED", align: "left", weight: 500, muted: true }); y -= pitch;
  });
  // insert table under the panel (Inserts sheet and the finished panel): id, kind, type, WLL at f'c lift, x, y, where, bars, checks
  const legendBox = { x0: x0, x1: x1, y0: y + 250, y1: -1150 };
  let table = null;
  if (want.IN === false) {
    const T = K.tableTxt, tp = K.tablePitch, tx0 = 0, top = Math.min(column.y0, legendBox.y0) - 300;
    const colsT = []; let cx = tx0; PANEL_TABLE_COLS.forEach(c => { colsT.push({ key: c[0], head: c[1], x: cx, w: c[2] }); cx += c[2]; });
    const rows = INS.map(q => ({
      ins: q.id, flagged: q.flagged, cells: {
        id: q.id, kind: q.kindName.toUpperCase(), type: q.short.toUpperCase(),
        wll: q.kind === "lifter" ? (q.wll.wll != null ? q.wll.wll + " t AT " + P.fcLift + " MPa" : "NOT PUBLISHED") : q.cat.wllText ? q.cat.wllText.replace(/^brace WLL /, "").replace(/,[^,]*shear/, "").replace(/ at /, " AT ") : "SEE CATALOGUE",
        x: fmt(q.x), y: fmt(q.y), where: q.edge ? q.edge.toUpperCase() + " EDGE" : "ON " + q.face,
        bars: q.bars.length ? q.cat.bars.map(cb => (cb.role === "floating" ? 2 : 1) + " N" + cb.size + " " + (cb.shape === "TB" ? "TB" : cb.shape === "U" ? "U" : "× " + cb.len)).join(" + ") + " (" + [...new Set(q.bars.map(b => b.mark))].sort().join(", ") + ")" : "NONE",
        checks: q.fails.length ? "FAILS " + q.fails.map(f => f.replace(/^room-/, "").replace(/-/g, " ").toUpperCase()).join(", ") : q.advis.length ? "PASS · NOTE " + q.advis.map(f => f.replace(/-/g, " ").toUpperCase()).join(", ") : "ALL PASS"
      } }));
    let ty = top;
    const title = "INSERTS · " + (INS.length ? INS.length + (INS.length > 1 ? " CAST-IN INSERTS" : " CAST-IN INSERT") : "NO CAST-IN INSERTS") + " · WLL AT f'c LIFT " + P.fcLift + " MPa · " + (M.catalogue.edition + " (" + M.catalogue.date + ")").toUpperCase() + (M.insertFlags.length ? " · NOTE: " + M.insertFlags.map(f => f.rule.replace(/-/g, " ").toUpperCase()).join(", ") : "");
    texts.push({ x: tx0, y: ty - 100, h: 170, text: title, align: "left", weight: 700 }); ty -= 260;
    const headY = ty;
    colsT.forEach(c => texts.push({ x: c.x + 60, y: ty - tp / 2, h: T, text: c.head, align: "left", weight: 700 })); ty -= tp;
    rows.forEach(rw => { rw.y1 = ty; rw.y0 = ty - tp; colsT.forEach(c => texts.push({ x: c.x + 60, y: ty - tp / 2, h: T, text: rw.cells[c.key], align: "left", weight: 500, maxW: c.w - 100, bad: rw.flagged && c.key === "checks" })); ty -= tp; });
    if (!rows.length) { texts.push({ x: tx0 + 60, y: ty - tp / 2, h: T, text: "NONE", align: "left", weight: 500 }); ty -= tp; }
    table = { x0: tx0, x1: cx, y0: ty, y1: headY, cols: colsT, rows: rows, title: title, pitch: tp };
    rects.push({ x0: tx0, x1: cx, y0: ty, y1: headY });
    lines.push({ x0: tx0, y0: headY - tp, x1: cx, y1: headY - tp });
    colsT.slice(1).forEach(c => lines.push({ x0: c.x, y0: ty, x1: c.x, y1: headY }));
  }
  // opening setout from the bottom-left corner: a chain below (x) and beside (y) the panel, one row per opening
  S.openDims = [];
  M.HOLES.slice().sort((a, b) => a.x0 - b.x0).forEach((h, i) => {
    const atY = -300 - i * 260, atX = -300 - i * 260;
    // a door or notch on an edge has no setout to that edge (#33f): a zero-length dimension is left out
    [{ measure: "x", a: 0, b: h.x0, at: atY, text: fmt(h.x0) }, { measure: "x", a: h.x0, b: h.x1, at: atY, text: fmt(h.x1 - h.x0) },
      { measure: "y", a: 0, b: h.y0, at: atX, text: fmt(h.y0) }, { measure: "y", a: h.y0, b: h.y1, at: atX, text: fmt(h.y1 - h.y0) }].forEach(d => { if (d.b > d.a) S.openDims.push(d); });
  });
  S.panel = { texts: texts, rects: rects, lines: lines, glyphs: glyphs, notes: notes, approval: appr, legend: legend.map(l => ({ sym: l[0], text: l[1] })), table: table, column: column, legendBox: legendBox, tag: panelTag(M) };
  // the sheet grows to hold the blocks (right and below) and the table
  const B = S.bounds;
  B.x1 = Math.max(B.x1, column.x1 + 400, legendBox.x1 + 400, table ? table.x1 + 400 : 0);
  B.y0 = Math.min(B.y0, column.y0 - 400, legendBox.y0 - 400, table ? table.y0 - 400 : 0);
}
// The panel tag (Findings 10 bundle tag, Findings 12.4): what is marked on the element before it is lifted — mark,
// size, mass, cast face, f'c at lift, lifters, and the casting and earliest-lift dates to be written in by hand.
function panelTag(M) {
  const P = M.panel, INS = M.inserts || [], lifters = INS.filter(q => q.kind === "lifter");
  const wll = lifters.length ? [...new Set(lifters.map(q => q.wll.wll != null ? q.wll.wll + " t" : "n/a"))].join(" / ") : null;
  return {
    mark: M.name, size: fmt(P.W) + " × " + fmt(P.H) + " × " + M.T, mass: Math.round(P.mass), massText: fmt(P.mass) + " kg", density: P.density,
    fc: M.cfg.fc, fcLift: P.fcLift, castFace: P.castFace, cog: fmt(P.cog.x) + " / " + fmt(P.cog.y),
    lifters: lifters.map(q => q.id), lifterText: lifters.length ? lifters.length + " × " + [...new Set(lifters.map(q => q.short))].join(" / ") + (wll ? " · WLL " + wll : "") : "no lifters",
    castDate: "", liftDate: "",
    lines: [M.name, fmt(P.W) + " × " + fmt(P.H) + " × " + M.T + " · " + fmt(P.mass) + " kg", "f'c " + M.cfg.fc + " · LIFT AT " + P.fcLift + " MPa · " + P.castFace + " DOWN", "CoG " + fmt(P.cog.x) + " / " + fmt(P.cog.y) + (lifters.length ? " · " + lifters.map(q => q.id).join(" ") + (wll ? " WLL " + wll : "") : ""), "CAST ____/____/________ · LIFT NOT BEFORE ____/____/________"]
  };
}

export { PANEL_SHEET, PANEL_TABLE_COLS, sheetPanelSymbols, coverNotes, reoNotes, sheetPanelBlocks, panelTag };
