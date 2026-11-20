// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { fmt } from "./bending.ts";

// ---------- precast panels (backlog #33a/#33b, Findings 12; mesh layout from Findings 11) ----------
// A precast wall panel modelled as it is fixed: lying on the casting bed, x along its width (left to right as seen from
// above), y up its height (bottom edge at y = 0), z through the thickness from the bed. Each face carries its own steel,
// named as on a panel shop drawing: NF = near face, FF = far face (Findings 12.1); castFace is the face on the bed.
// A face is either bars (one callout per direction, H or V, the first line is the outer layer) or one mesh (SL / RL,
// its long wires H or V). Lifting and brace inserts, mass marking and the panel sheet are later items (Findings 12.7).
//
// Mesh catalogue (Findings 11.1, InfraBuild Reinforcing Product Guide 4th ed. pp. 19–25 and the current product pages):
// dl / pl = diameter / pitch of the long wires (along the 6 m sheet), dc / pc = the cross wires, de = the two thinner
// edge (side-lap) wires each side of an SL sheet at 100 pitch; kg = catalogue mass per 6.0 × 2.4 sheet.
const MESH = {
  SL62: { fam: "SL", dl: 6.0, pl: 200, de: 4.24, dc: 6.0, pc: 200, kg: 33 },
  SL72: { fam: "SL", dl: 6.75, pl: 200, de: 4.75, dc: 6.75, pc: 200, kg: 41 },
  SL82: { fam: "SL", dl: 7.6, pl: 200, de: 5.35, dc: 7.6, pc: 200, kg: 52 },
  SL92: { fam: "SL", dl: 8.6, pl: 200, de: 6.0, dc: 8.6, pc: 200, kg: 66 },
  SL102: { fam: "SL", dl: 9.5, pl: 200, de: 6.75, dc: 9.5, pc: 200, kg: 80 },
  SL81: { fam: "SL81", dl: 7.6, pl: 100, de: 0, dc: 7.6, pc: 100, kg: 105 },
  RL718: { fam: "RL", dl: 6.75, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 67 },
  RL818: { fam: "RL", dl: 7.6, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 79 },
  RL918: { fam: "RL", dl: 8.6, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 93 },
  RL1018: { fam: "RL", dl: 9.5, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 109 },
  RL1118: { fam: "RL", dl: 10.7, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 130 },
  RL1218: { fam: "RL", dl: 11.9, pl: 100, de: 0, dc: 7.6, pc: 200, kg: 157 }
};
const wireKgm = d => Math.PI * d * d / 4 * 7.85e-3;   // nominal kg/m of a wire, 7,850 kg/m³ (Findings 11.1: 7.6 → 0.356)
// Stock sheet as ordered with the fly ends trimmed: the outermost cross wires are the sheet ends (5.8 m between them, 5.9 m
// for SL81 at 100 pitch). Long-wire offsets across the 2.4 m width: SL 100, 200 (edge), 300 … 2,100 (main), 2,200, 2,300
// (edge); RL and SL81 0 … 2,400 at 100 (Findings 11.1 geometry, derived from the wire counts, marked derived there).
function meshStock(s) {
  const L = s.fam === "SL81" ? 5900 : 5800, W = 2400, long = [], cross = [];
  if (s.fam === "SL") { [100, 200].forEach(v => long.push({ v: v, d: s.de })); for (let v = 300; v <= 2100; v += 200) long.push({ v: v, d: s.dl }); [2200, 2300].forEach(v => long.push({ v: v, d: s.de })); }
  else for (let v = 0; v <= W; v += s.pl) long.push({ v: v, d: s.dl });
  for (let u = 0; u <= L; u += s.pc) cross.push({ u: u, d: s.dc });
  return { L: L, W: W, long: long, cross: cross };
}
// Laps between stock sheets: the AS 3600 Cl 13.2.3 rule (the two outermost cross wires of each sheet overlap) as the
// Findings 11.3 geometry gives it with trimmed fly ends and a 25 placing clearance: 225 end lap; side lap 325 for SL
// (edge wires at 100, cross wires 100 past them), 225 for RL and SL81 (trade floor). Placeholders until Baji answers the
// open mesh-lap question (fly ends kept give a 425 end lap).
const MESH_LAP = fam => ({ end: 225, side: fam === "SL" ? 325 : 225 });
const MESH_MADE = { L: 9000, W: 3000 };   // InfraBuild made-to-size sheets up to 9 × 3 m (guide p. 24, Findings 11.1)
const MESH_STOCK_AREA = 6.0 * 2.4;        // m² of one stock sheet as bought, fly ends included (Findings 11.5)

// ---------- mesh layout (backlog #6, Findings 11.4; shared by floors and panels #33) ----------
// Lays one mesh over a rectangular zone in a u-v frame: u along the long wires, v across them; o.xy(u, v) gives the
// plan point. The zone is already inside cover; holes (openings, and for a floor the set-downs and the raised step)
// are already grown by cover, and the wires stop at them (Findings 11.4 step 3, cut on site). One made-to-size sheet
// (o.made) or lapped 6.0 × 2.4 stock sheets with the fly ends trimmed: rows across the zone, alternate rows staggered
// half a sheet so no point has four sheets (step 2, ACOR B23 R13 ≤ 3), a last piece pulled back to keep two wires each
// way past its lap (step 4). No offcut pool yet (step 5): every piece is cut from its own stock sheet.
//   o = { U0, U1, V0, V1, holes: [{u0, u1, v0, v1, id}], spec (MESH entry), code, layer, run, xy, zL (long-wire z),
//         zC (cross-wire z), made, extra (fields copied to each piece), C (cover, for the note), dirShort, dirWord }
//   out = { pieces, wires } — the model's arrays; new pieces are "S" + n, wires "w" + n, in placing order.
// Returns { list (the new pieces), lapped (more than one stock sheet: the placeholder laps are in use), LAP, area (m²
// of zone less holes, what the mesh has to cover) }.
function layMesh(o, out) {
  const s = o.spec, U0 = o.U0, U1 = o.U1, V0 = o.V0, V1 = o.V1, U = U1 - U0, V = V1 - V0, LAP = MESH_LAP(s.fam), holes = o.holes || [], C = o.C;
  const xy = o.xy, list = [];
  const polyLen = pts => pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0, 0);
  const minus = (a, b, cuts) => { let segs = [{ s: a, e: b }]; cuts.forEach(c => { const res = []; segs.forEach(g => { if (c.b <= g.s || c.a >= g.e) { res.push(g); return; } if (c.a > g.s) res.push({ s: g.s, e: c.a }); if (c.b < g.e) res.push({ s: c.b, e: g.e }); }); segs = res; }); return segs; };
  const holeArea = holes.reduce((a, q) => a + Math.max(0, Math.min(q.u1, U1) - Math.max(q.u0, U0)) * Math.max(0, Math.min(q.v1, V1) - Math.max(q.v0, V0)), 0);
  const area = Math.max(0, U * V - holeArea) / 1e6;
  if (U < 100 || V < 100) return { list: list, lapped: false, LAP: LAP, area: 0 };
  const sheets = [];
  if (o.made) {
    // one sheet cut to the zone; wires at the catalogue pitch, centred, no side-lap edge wires
    const nl = Math.floor((V - 50) / s.pl) + 1, nc = Math.floor((U - 80) / s.pc) + 1;
    const v0 = V0 + (V - (nl - 1) * s.pl) / 2, u0 = U0 + (U - (nc - 1) * s.pc) / 2;
    sheets.push({ su0: U0, sv0: V0, sL: U, sW: V, made: true,
      long: Array.from({ length: nl }, (_, k) => ({ v: v0 - V0 + k * s.pl, d: s.dl })), cross: Array.from({ length: nc }, (_, k) => ({ u: u0 - U0 + k * s.pc, d: s.dc })) });
  } else {
    const st = meshStock(s), pu = st.L - LAP.end, pv = st.W - LAP.side;
    const rows = V <= st.W ? 1 : Math.ceil((V - st.W) / pv) + 1;
    const minU = LAP.end + 2 * s.pc + 100, minV = LAP.side + 2 * s.pl + 100;
    for (let j = 0; j < rows; j++) {
      let sv0 = V0 + j * pv;
      if (j && V1 - sv0 < minV) sv0 = V1 - minV;
      const off = j % 2 && U > st.L ? Math.round(pu / 2) : 0;   // alternate rows staggered half a sheet: no point has four sheets
      let su0 = U0 - off;
      for (let guard = 0; guard < 400; guard++) {
        let a = su0;
        if (a > U0 && U1 - a < minU) a = U1 - minU;
        sheets.push({ su0: a, sv0: sv0, sL: st.L, sW: st.W, made: false, long: st.long, cross: st.cross, row: j });
        if (a + st.L >= U1) break;
        su0 = a + pu;
      }
    }
  }
  const cutHoles = (fixed, a, b, isLong) => {   // a wire at `fixed` across, spanning [a, b] along; holes cut it
    const cuts = holes.filter(q => isLong ? fixed > q.v0 && fixed < q.v1 : fixed > q.u0 && fixed < q.u1).map(q => isLong ? { a: q.u0, b: q.u1 } : { a: q.v0, b: q.v1 });
    return minus(a, b, cuts).filter(g => g.e - g.s >= 50);
  };
  sheets.forEach(sh => {
    const p0u = Math.max(U0, sh.su0), p1u = Math.min(U1, sh.su0 + sh.sL), p0v = Math.max(V0, sh.sv0), p1v = Math.min(V1, sh.sv0 + sh.sW);
    if (p1u - p0u < 100 || p1v - p0v < 100) return;
    const pc = Object.assign({ id: null, layer: o.layer, code: o.code, dir: o.dirShort, dirWord: o.dirWord, made: sh.made, u0: p0u, u1: p1u, v0: p0v, v1: p1v, cutL: Math.round(p1u - p0u), cutW: Math.round(p1v - p0v), wires: [], kg: 0, holes: [], run: o.run, spec: s }, o.extra || {});
    const a = xy(p0u, p0v), b = xy(p1u, p1v);
    pc.x0 = Math.min(a[0], b[0]); pc.x1 = Math.max(a[0], b[0]); pc.y0 = Math.min(a[1], b[1]); pc.y1 = Math.max(a[1], b[1]);
    pc.holes = holes.filter(q => !(q.u1 <= p0u || q.u0 >= p1u || q.v1 <= p0v || q.v0 >= p1v)).map(q => q.id);
    let nLong = 0, nCross = 0;
    const addWire = (u0, v0, u1, v1, d, z, isLong) => {
      const P = xy(u0, v0), Q = xy(u1, v1);
      const w = { id: null, wire: true, layer: o.layer, size: d, type: "W", pts: [[Math.round(P[0] * 10) / 10, Math.round(P[1] * 10) / 10, z], [Math.round(Q[0] * 10) / 10, Math.round(Q[1] * 10) / 10, z]], sheet: pc, run: o.run, long: isLong };
      w.len = Math.round(polyLen(w.pts)); w.kg = w.len / 1000 * wireKgm(d);
      pc.wires.push(w); pc.kg += w.kg;
    };
    sh.long.forEach(wl => { const v = sh.sv0 + wl.v; if (v < p0v - 0.5 || v > p1v + 0.5) return; nLong++; cutHoles(v, p0u, p1u, true).forEach(g => addWire(g.s, v, g.e, v, wl.d, o.zL, true)); });
    sh.cross.forEach(wc => { const u = sh.su0 + wc.u; if (u < p0u - 0.5 || u > p1u + 0.5) return; nCross++; cutHoles(u, p0v, p1v, false).forEach(g => addWire(u, g.s, u, g.e, wc.d, o.zC, false)); });
    if (!pc.wires.length) return;   // a piece that lies wholly in a hole (a set-down the size of a sheet) is not cut
    pc.id = "S" + (out.pieces.length + 1);
    pc.wires.forEach(w => { w.id = "w" + out.wires.length; out.wires.push(w); });
    pc.nLong = nLong; pc.nCross = nCross; pc.kg = Math.round(pc.kg * 10) / 10;
    pc.laps = sh.made ? null : { end: LAP.end, side: LAP.side };
    pc.note = sh.made ? "Made-to-size sheet " + fmt(pc.cutL) + " × " + fmt(pc.cutW) + ", " + o.code + " wires at the catalogue pitch (InfraBuild made-to-size, up to 9 × 3 m)."
      : "Cut from a 6.0 × 2.4 " + o.code + " sheet (fly ends trimmed) to " + fmt(pc.cutL) + " × " + fmt(pc.cutW) + "; laps " + LAP.end + " end / " + LAP.side + " side (placeholders).";
    if (pc.holes.length) pc.note += " Wires cut " + C + " clear of " + pc.holes.join(", ") + ".";
    out.pieces.push(pc); list.push(pc); if (o.run) o.run.mesh.push(pc);
  });
  return { list: list, lapped: sheets.length > 1, LAP: LAP, area: area };
}
// Marks for mesh pieces: one mark per distinct (code, made / stock, cut size, direction, holes cut, mass), appended
// to the bar marks (Findings 11.4 step 6). prefix: "" on a floor (M1, M2 …), the panel mark + "-" on a panel.
function meshMarks(pieces, marks, prefix) {
  const mgroups = new Map();
  pieces.forEach(pc => { const k = [pc.code, pc.made ? 1 : 0, pc.cutL, pc.cutW, pc.dir, pc.holes.join("+"), Math.round(pc.kg)].join("|"); if (!mgroups.has(k)) mgroups.set(k, []); mgroups.get(k).push(pc); });
  [...mgroups.values()].forEach((list, i) => {
    const m = prefix + "M" + (i + 1), p = list[0];
    list.forEach(pc => { pc.mark = m; pc.wires.forEach(w => { w.mark = m; }); });
    marks.push({ mark: m, mesh: true, type: p.code, size: "", shape: "mesh sheet", code: p.made ? "MTS" : "SHT", shapeName: p.made ? "mesh sheet, made to size" : "mesh sheet, cut from stock", dims: [["L", p.cutL], ["W", p.cutW]],
      dimStr: "cut " + fmt(p.cutL) + " × " + fmt(p.cutW) + " · long wires " + p.dir + (p.holes.length ? " · cut round " + p.holes.join(", ") : ""), flags: [], pin: "—", len: p.cutL, qty: list.length, layer: p.layer, kg: list.reduce((s, q) => s + q.kg, 0), laps: p.laps, kgEach: p.kg });
  });
}
// Cutting-list summary per mesh run (Findings 11.5): stock sheets to buy (one per piece; no offcut pool yet), the area
// the mesh covers (zone less holes, what measured work pays: MRS71 Cl 2.3 makes no allowance for laps), the gross
// area bought, and laps + waste as a share of the net. Mass is wire length at nominal mass (Findings 11.2 basis).
// Stock sheets to buy: the pieces nested on whole trimmed sheets by a first-fit guillotine cut in area order, each
// piece in its wire orientation (no rotation: the long wires stay the long way) with up to one pitch spare each way
// for its wire pattern. Each piece learns its sheet number (pc.from); the cut positions are the shop's.
function nestStock(pieces, s) {
  const st = meshStock(s), sheets = [];
  pieces.filter(p => !p.made).slice().sort((a, b) => b.cutL * b.cutW - a.cutL * a.cutW).forEach(p => {
    const L = Math.min(st.L, p.cutL + s.pc), W = Math.min(st.W, p.cutW + s.pl);
    let sh = sheets.find(q => q.free.some(f => f.L >= L && f.W >= W));
    if (!sh) { sh = { no: sheets.length + 1, free: [{ L: st.L, W: st.W }], pieces: [] }; sheets.push(sh); }
    const k = sh.free.findIndex(f => f.L >= L && f.W >= W), f = sh.free.splice(k, 1)[0];
    sh.free.push({ L: f.L - L, W: W }, { L: f.L, W: f.W - W });
    sh.pieces.push(p.id); p.from = sh.no;
  });
  pieces.forEach(p => { if (p.from) p.with = sheets[p.from - 1].pieces.filter(id => id !== p.id); });
  return sheets.length;
}
function meshSummary(run, area) {
  const pieces = run.mesh, stock = pieces.some(p => !p.made) ? nestStock(pieces, pieces[0].spec) : 0, made = pieces.filter(p => p.made).length;
  const gross = stock * MESH_STOCK_AREA + pieces.filter(p => p.made).reduce((s, p) => s + p.cutL * p.cutW / 1e6, 0);
  return { run: run.id, label: run.label, code: run.code, layer: run.layer, pieces: pieces.length, stock: stock, made: made, netArea: Math.round(area * 10) / 10, grossArea: Math.round(gross * 10) / 10,
    wastePct: area > 0 ? Math.round((gross / area - 1) * 100) : 0, kg: Math.round(pieces.reduce((s, p) => s + p.kg, 0) * 10) / 10, laps: pieces.find(p => p.laps) ? pieces.find(p => p.laps).laps : null };
}

export { MESH, wireKgm, meshStock, MESH_LAP, MESH_MADE, MESH_STOCK_AREA, layMesh, meshMarks, nestStock, meshSummary };
