#!/usr/bin/env node
// Precast panel checks (backlog #33a/#33b/#33c/#33d): the panel builder between the MODEL markers, run headlessly.
// A panel lies on its casting bed (x along the width, y up the height, z from the bed); each face (NF near, FF far)
// is bars or one mesh; perimeter and opening bars sit just inside each face; cast-in inserts are checked against the
// catalogue and bring their component bars; the panel sheet carries the insert symbols and table, the CoG, the notes,
// approval and legend blocks and the panel tag. Exit 0 = pass.
"use strict";
const { loadModel } = require("./model-lib");
const L = loadModel();
const { buildModel, buildPanel, PANEL_CFG, MESH, meshStock, wireKgm, buildSheet, parseCallout, DEFAULT_CFG, INSERT_CAT, insertWll, panelTag, PANEL_TABLE_COLS } = L;
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
const cfgWith = o => Object.assign(JSON.parse(JSON.stringify(PANEL_CFG)), o);
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.5 : t);

// every bar and wire inside the concrete with cover, clear of the openings by cover, finite and sized
function checkSteel(M, name) {
  const C = M.C, PW = M.L, PH = M.W, T = M.T, all = M.bars.concat(M.wires);
  all.forEach(b => {
    const where = name + " " + (b.wire ? "wire " + b.id + " (" + b.mark + ")" : "bar " + b.id + " (" + b.run.label + ")");
    if (!b.pts || b.pts.length < 2 || b.pts.some(p => p.length !== 3 || p.some(v => !isFinite(v)))) { problems.push(where + ": bad points"); return; }
    b.pts.forEach(p => {
      if (p[0] < C - 0.5 || p[0] > PW - C + 0.5 || p[1] < C - 0.5 || p[1] > PH - C + 0.5) problems.push(where + ": point " + p.map(Math.round) + " outside the panel less cover");
      if (p[2] - b.size / 2 < C - 0.6 || p[2] + b.size / 2 > T - C + 0.6) problems.push(where + ": z " + p[2] + " leaves less than cover " + C + " to a face");
    });
    for (let k = 0; k <= 40; k++) {   // cover to every opening face
      const t = k / 40, x = b.pts[0][0] + (b.pts[1][0] - b.pts[0][0]) * t, y = b.pts[0][1] + (b.pts[1][1] - b.pts[0][1]) * t;
      const h = M.HOLES.find(q => x > q.x0 - C + 1 && x < q.x1 + C - 1 && y > q.y0 - C + 1 && y < q.y1 + C - 1);
      if (h) { problems.push(where + ": passes within cover of " + h.id + " at " + Math.round(x) + ", " + Math.round(y)); break; }
    }
    if (!b.wire && (!(b.len > 0) || !(b.kg > 0) || !b.mark)) problems.push(where + ": no length, mass or mark");
    if (!b.wire && b.len > 12000) problems.push(where + ": cut length " + b.len + " over 12 m stock");
    if (!M.LBY[b.layer]) problems.push(where + ": unknown layer " + b.layer);
  });
  M.runs.forEach(r => {
    if (r.label && !r.dist && !r.tagPos) problems.push(name + " run " + r.label + " has no tag anchor");
    if (!(r.mesh ? r.mesh.length : r.bars.length) && r.kind !== "insert") problems.push(name + " run " + r.label + " is empty");
  });
  // no two bars (or wires) that cross in plan share a plane: crossing steel sits one on the other (centres ≥ d1/2 + d2/2 apart)
  const segs = all.filter(b => b.pts.length === 2);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j], p = a.pts[0], r = [a.pts[1][0] - p[0], a.pts[1][1] - p[1]], q = b.pts[0], u = [b.pts[1][0] - q[0], b.pts[1][1] - q[1]];
    const den = r[0] * u[1] - r[1] * u[0]; if (Math.abs(den) < 1e-6) continue;   // parallel: laps and neighbours, not crossings
    const t = ((q[0] - p[0]) * u[1] - (q[1] - p[1]) * u[0]) / den, s = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    if (t <= 1e-6 || t >= 1 - 1e-6 || s <= 1e-6 || s >= 1 - 1e-6) continue;
    const dz = Math.abs(p[2] + t * (a.pts[1][2] - p[2]) - (q[2] + s * (b.pts[1][2] - q[2])));
    if (dz < (a.size + b.size) / 2 - 0.5) { problems.push(name + ": " + (a.wire ? "wire " + a.mark : a.run.label) + " and " + (b.wire ? "wire " + b.mark : b.run.label) + " cross in one plane (" + dz.toFixed(1) + " apart)"); i = segs.length; break; }
  }
  const qty = M.marks.reduce((s, m) => s + m.qty, 0);
  ok(qty === M.bars.length + M.meshPieces.length, name + ": schedule quantity " + qty + " is not bars + sheets " + (M.bars.length + M.meshPieces.length));
  ok(near(M.marks.reduce((s, m) => s + m.kg, 0), M.kg, 0.5), name + ": schedule mass does not add up");
  // the two faces' steel never meet: the bed face's highest steel stays 10 below the top face's lowest
  const face = f => all.filter(b => b.layer.slice(0, 2) === f);
  const bedF = M.panel.castFace, topF = M.panel.topFace, hi = Math.max(...face(bedF).map(b => Math.max(...b.pts.map(p => p[2] + b.size / 2)))), lo = Math.min(...face(topF).map(b => Math.min(...b.pts.map(p => p[2] - b.size / 2))));
  if (face(bedF).length && face(topF).length) ok(lo - hi >= 10 - 1e-6, name + ": the faces come within " + (lo - hi).toFixed(1) + " of each other");
}

// ---- the example panel ----
const M = buildModel(PANEL_CFG);
ok(M.kind === "panel" && !M.errors.length && !M.warnings.length, "example panel: errors/warnings " + JSON.stringify(M.errors.concat(M.warnings)));
ok(M.ORDER.join() === "FF1,FF2,CH,IN,NF2,NF1", "example order " + M.ORDER.join());
ok(M.steps.length === 7 && M.steps[0].title === "Formwork" && M.steps[1].title === "Far face mesh" && M.steps[4].title === "Inserts" && M.steps[6].title === "Near face outer bars", "example steps " + M.steps.map(s => s.title).join(" | "));
checkSteel(M, "example");
// NF bars: 15 horizontal outer @ 200 and 30 vertical inner @ 200, both cut round the window
const runOf = (M, id, kind) => M.runs.find(r => r.layer === id && r.kind === (kind || "main"));
const nfH = runOf(M, "NF1"), nfV = runOf(M, "NF2");
ok(nfH && nfH.n === 15 && nfH.dir === "X" && nfH.grid.first.text === "100 from the bottom edge", "NF outer H run " + (nfH && [nfH.n, nfH.dir, nfH.grid.first.text]));
ok(nfV && nfV.n === 30 && nfV.dir === "Y", "NF inner V run " + (nfV && [nfV.n, nfV.dir]));
ok(nfH.z > nfV.z && nfH.z === 200 - 30 - 6 && nfV.z === 200 - 30 - 12 - 6, "NF outer above inner with FF on the bed: " + nfH.z + " / " + nfV.z);
const cutH = nfH.bars.filter(b => /opening/.test(b.note)).length, cutV = nfV.bars.filter(b => /opening/.test(b.note)).length;
ok(cutH === 14 && cutV === 14, "bars stopped at the window: H " + cutH + ", V " + cutV);
const b0 = nfH.bars[0];
ok(b0.grid && b0.grid.dirWord === "horizontal" && b0.grid.from.text === "30 from the left edge" && b0.grid.to.text === "30 from the right edge" && b0.grid.line.text === "100 from the bottom edge", "bar setout from the panel edges " + JSON.stringify(b0.grid));
// FF mesh: one made-to-size SL82 sheet inside cover, long wires horizontal, cut round the window
ok(M.meshPieces.length === 1, "example mesh pieces " + M.meshPieces.length);
const pc = M.meshPieces[0];
ok(pc.code === "SL82" && pc.made && pc.cutL === 5940 && pc.cutW === 2940 && pc.mark === "P1-M1" && pc.holes.join() === "WINDOW", "example sheet " + JSON.stringify([pc.code, pc.made, pc.cutL, pc.cutW, pc.mark, pc.holes]));
ok(pc.nLong === 15 && pc.nCross === 30, "SL82 at 200 both ways over 5,940 × 2,940: " + pc.nLong + " long, " + pc.nCross + " cross");
ok(pc.wires.every(w => w.size === 7.6) && pc.wires.filter(w => w.long).every(w => w.pts[0][1] === w.pts[1][1]), "SL82 wires 7.6, long wires horizontal");
const zl = pc.wires.find(w => w.long).pts[0][2], zc = pc.wires.find(w => !w.long).pts[0][2];
ok(near(zl, 30 + 3.8) && near(zc, 30 + 7.6 + 3.8), "mesh on the bed: long wires at " + zl + ", cross at " + zc);
ok(near(pc.kg, pc.wires.reduce((s, w) => s + w.len / 1000 * wireKgm(w.size), 0), 0.1), "sheet mass is the wire mass");
const mm = M.marks.find(m => m.mark === "P1-M1");
ok(mm && mm.mesh && mm.type === "SL82" && mm.qty === 1 && /cut 5,940 × 2,940/.test(mm.dimStr), "mesh mark row " + JSON.stringify(mm));
// edge steel: N16 perimeter in each face (4 bars), opening bars + 4 diagonals of 1,200 in each face
["NF", "FF"].forEach(f => {
  const pr = runOf(M, f + "2", "perim"), tr = runOf(M, f + "2", "trim");
  ok(pr && pr.bars.length === 4 && pr.bars.every(b => b.size === 16), f + " perimeter " + (pr && pr.bars.length));
  ok(tr && tr.bars.length === 8, f + " opening bars " + (tr && tr.bars.length));
  const diags = tr.bars.filter(b => /diagonal/.test(b.note));
  ok(diags.length === 4 && diags.every(b => b.size === 12 && b.len === 1200), f + " diagonals " + diags.map(b => b.len));
  const sides = tr.bars.filter(b => !/diagonal/.test(b.note));
  ok(sides.every(b => b.size === 12) && sides.filter(b => b.grid.dir === "X").every(b => b.len === 1400 + 1200) && sides.filter(b => b.grid.dir === "Y").every(b => b.len === 1200 + 1200), f + " opening side bars 600 past each corner: " + sides.map(b => b.len));
});
// concrete: net area, mass at 2,400, CoG pulled away from the window
ok(near(M.panel.area, 18 - 1.68, 1e-6) && near(M.panel.mass, (18 - 1.68) * 0.2 * 2400, 0.5), "panel mass " + M.panel.mass);
ok(M.panel.cog.x < 3000 && M.panel.cog.y < 1500, "CoG should move away from the window: " + JSON.stringify(M.panel.cog));
const M0 = buildModel(cfgWith({ openings: [] }));
ok(near(M0.panel.mass, 18 * 0.2 * 2400) && M0.panel.cog.x === 3000 && M0.panel.cog.y === 1500, "plain panel mass / CoG " + M0.panel.mass + " " + JSON.stringify(M0.panel.cog));

// ---- the other face on the bed: NF down flips the stack ----
const Mn = buildModel(cfgWith({ castFace: "NF" }));
ok(!Mn.errors.length && Mn.ORDER.join() === "NF1,NF2,CH,IN,FF2,FF1", "NF on the bed order " + Mn.ORDER.join() + " " + Mn.errors);
ok(runOf(Mn, "NF1").z === 30 + 6 && runOf(Mn, "NF2").z === 30 + 12 + 6, "NF on the bed: outer at " + runOf(Mn, "NF1").z);
ok(near(Mn.meshPieces[0].wires.find(w => w.long).pts[0][2], 200 - 30 - 3.8), "FF mesh on top when NF is on the bed");
checkSteel(Mn, "NF on the bed");

// ---- both faces bars, both faces mesh ----
const Mb = buildModel(cfgWith({ T: 220, inserts: [], openings: [{ name: "W", x0: 3510, y0: 1120, x1: 5000, y1: 2310 }], faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "bar", callouts: "N16-200 V\nN12-250 H" } } }));
ok(!Mb.errors.length && !Mb.wires.length && runOf(Mb, "FF1").dir === "Y" && runOf(Mb, "FF2").sp === 250, "bars both faces " + Mb.errors);
ok(runOf(Mb, "NF1").bars.filter(b => b.line === 6).length === 2, "a bar line 20 below an opening (y 1,100 vs 1,120) stops short of it too");
checkSteel(Mb, "bars both faces");
// RL918 with its long wires vertical: 5,940 across is wider than a 3.0 m made-to-size sheet, so stock sheets stand side by side
const Mm = buildModel(cfgWith({ faces: { NF: { kind: "mesh", callouts: "RL918 V" }, FF: { kind: "mesh", callouts: "SL82 H FF" } } }));
const rls = Mm.meshPieces.filter(p => p.face === "NF"), sls = Mm.meshPieces.filter(p => p.face === "FF");
ok(!Mm.errors.length && sls.length === 1 && sls[0].made && rls.length === 3 && rls.every(p => !p.made && p.code === "RL918" && p.cutL === 2940) && Mm.warnings.some(w => /^Near face mesh: 2,940 × 5,940 inside cover is larger than a made-to-size sheet/.test(w)), "mesh both faces " + JSON.stringify([Mm.errors, rls.map(p => [p.cutL, p.cutW]), Mm.warnings]));
ok(rls.every(p => p.wires.filter(w => w.long).every(w => w.pts[0][0] === w.pts[1][0] && w.size === 8.6)), "RL918 V: long wires vertical, 8.6");
checkStock(Mm, "RL918 V"); checkSteel(Mm, "mesh both faces");

// ---- stock sheets: covered, laps at least the rule, never four sheets at a point ----
function checkStock(M, name) {
  ["NF", "FF"].forEach(f => {
    const ps = M.meshPieces.filter(p => p.face === f && !p.made); if (!ps.length) return;   // stock-sheet faces only
    const fam = MESH[ps[0].code].fam, lapE = 225, lapS = fam === "SL" ? 325 : 225, X = ps[0].dir === "H";
    let worst = 0;
    for (let x = M.C + 1; x < M.L - M.C; x += 47) for (let y = M.C + 1; y < M.W - M.C; y += 47) {
      const n = ps.filter(p => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1).length;
      if (!n) { problems.push(name + " " + f + ": point " + x + ", " + y + " not covered by a sheet"); return; }
      worst = Math.max(worst, n);
    }
    ok(worst <= 3, name + " " + f + ": " + worst + " sheets stack at one point");
    ps.forEach((a, i) => ps.slice(i + 1).forEach(b => {
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox <= 0 || oy <= 0) return;
      const along = X ? ox : oy, across = X ? oy : ox;   // overlap along the long wires (end lap) and across them (side lap)
      const endLap = across >= Math.min(a.cutW, b.cutW) - 1, sideLap = along >= Math.min(a.cutL, b.cutL) - 1;
      if (endLap && along < lapE - 0.5) problems.push(name + " " + f + ": end lap " + along + " < " + lapE + " between " + a.id + " and " + b.id);
      if (sideLap && across < lapS - 0.5) problems.push(name + " " + f + ": side lap " + across + " < " + lapS + " between " + a.id + " and " + b.id);
    }));
    ps.forEach(p => {
      ok(p.cutL <= 5900 && p.cutW <= 2400 && !p.made, name + " " + f + ": piece " + p.id + " " + p.cutL + " × " + p.cutW + " larger than stock");
      p.wires.forEach(w => w.pts.forEach(q => { if (q[0] < p.x0 - 0.5 || q[0] > p.x1 + 0.5 || q[1] < p.y0 - 0.5 || q[1] > p.y1 + 0.5) problems.push(name + " " + p.id + ": wire outside its piece"); }));
      ok(p.nLong >= 2 && p.nCross >= 2, name + " " + p.id + ": fewer than two wires each way");
    });
  });
}
const Ms = buildModel(cfgWith({ meshSheets: "stock" }));
ok(!Ms.errors.length && Ms.meshPieces.length === 4 && Ms.warnings.length === 1 && /placeholders/.test(Ms.warnings[0]), "stock 6 × 3 panel: " + Ms.meshPieces.length + " pieces, warnings " + JSON.stringify(Ms.warnings));
checkStock(Ms, "stock 6 × 3"); checkSteel(Ms, "stock 6 × 3");
const Mbig = buildModel(cfgWith({ W: 10000, H: 3500, meshSheets: "stock", inserts: [], openings: [{ name: "W1", x0: 1000, y0: 1000, x1: 2500, y1: 2500 }, { name: "W2", x0: 6000, y0: 800, x1: 7200, y1: 2900 }], faces: { NF: { kind: "mesh", callouts: "SL82 V" }, FF: { kind: "mesh", callouts: "RL918 H" } } }));
ok(!Mbig.errors.length, "big stock panel errors " + Mbig.errors);
checkStock(Mbig, "10 × 3.5 stock"); checkSteel(Mbig, "10 × 3.5 stock");
ok(Mbig.meshPieces.filter(p => p.face === "NF").length >= 5 && Mbig.meshPieces.some(p => p.holes.length), "big panel pieces and cut-outs");
ok(runOf(Mbig, "NF2", "trim").bars.filter(b => b.size === 16).length === 8 && runOf(Mbig, "NF2", "trim").bars.filter(b => b.size === 12).length === 8, "W1 (1,500 square) and W2 (2,100 high) get N16 side bars, N12 diagonals");
const Mmade = buildModel(cfgWith({ W: 10000, H: 3500, inserts: [], faces: { NF: { kind: "mesh", callouts: "SL82 V" }, FF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" } } }));
ok(Mmade.warnings.some(w => /larger than a made-to-size sheet/.test(w)) && Mmade.meshPieces.every(p => !p.made), "a mesh face over 9 × 3 falls back to stock sheets: " + JSON.stringify(Mmade.warnings));
// a long panel laps its bars inside 12 m stock
const Mlong = buildModel(cfgWith({ W: 14000, openings: [], inserts: [], faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" } } }));
const hl = runOf(Mlong, "NF1");
ok(!Mlong.errors.length && hl.bars.some(b => b.lapNext) && hl.bars.every(b => b.len <= 12000), "14 m panel laps its horizontal bars");
const lz = hl.bars.find(b => b.lapNext).grid.laps[0];
ok(lz && lz.len === 600 && /^600 lap at the right end, lap zone [\d,]+ from the (left|right) edge to [\d,]+ from the (left|right) edge$/.test(lz.text), "lap zone wording " + (lz && lz.text));
ok(Mlong.laps.rows.some(r => r.lapped && r.kase === "panel"), "lap rows record the panel laps");
checkSteel(Mlong, "14 m");

// ---- errors: every bad line by face and line, the rest still builds ----
const Me = buildModel(cfgWith({ faces: { NF: { kind: "bar", callouts: "N12-200\nN12-200 E-W\nSL82 H\nN12-200 FF H\nN12-200 T V\nN12-200 H\nN12-150 H\nN12-30 V\nR10-200 V" }, FF: { kind: "mesh", callouts: "N12-200 H\nSL82\nL8TM H\nSL82 H\nSL72 V\nEXTRA N16 H" } } }));
const want = [/^Near face line 1 \(N12-200\): say which way it runs: H \(horizontal\) or V \(vertical\)/, /^Near face line 2 .*E-W and N-S are plan directions/, /^Near face line 3 .*this face is set to bars/, /^Near face line 4 .*this box is the near face \(NF\); that line says FF/,
  /^Near face line 5 .*a panel face is NF or FF, not top or bottom/, /^Near face line 7 .*already has horizontal bars on line 6/, /^Near face line 8 .*spacing 30 is too tight/, /^Near face line 9 .*must be N \(D500N\)/,
  /^Far face line 1 .*this face is set to mesh/, /^Far face line 2 .*its long wires run: H/, /^Far face line 3 .*L8TM is not a sheet mesh/, /^Far face line 5 .*already has SL82 on line 4/, /^Far face line 6 .*not read from the face boxes/];
ok(Me.errors.length === want.length && want.every((re, i) => re.test(Me.errors[i] || "")), "face line errors:\n  " + Me.errors.join("\n  "));
const Mo = buildModel(cfgWith({ openings: [{ name: "A", x0: 100, y0: 500, x1: 900, y1: 1500 }, { name: "B", x0: 1000, y0: 1000, x1: 1200, y1: 2000 }, { name: "C", x0: 2000, y0: 600, x1: 3600, y1: 2400 }, { name: "D", x0: 3700, y0: 600, x1: 4500, y1: 2400 }, { name: "E", x0: "", y0: 1, x1: 2, y1: 3 }] }));
ok(Mo.errors.length === 4 && /^Opening 1 \(A\): must sit at least 300 inside/.test(Mo.errors[0]) && /^Opening 2 \(B\): each side must be at least 300/.test(Mo.errors[1]) && /^Opening 4 \(D\): keep 300 clear of C/.test(Mo.errors[2]) && /^Opening 5 \(E\): give all four numbers/.test(Mo.errors[3]), "opening errors " + JSON.stringify(Mo.errors));
const Mt = buildModel(cfgWith({ T: 120, faces: { NF: { kind: "bar", callouts: "N16-200 H\nN16-200 V" }, FF: { kind: "bar", callouts: "N16-200 H\nN16-200 V" } } }));
ok(Mt.errors.length === 1 && /^Panel too thin for this steel: .* take 212 of the 120/.test(Mt.errors[0]), "thin panel error " + JSON.stringify(Mt.errors));
ok(buildModel(cfgWith({ W: 500 })).errors.some(e => /^Panel size/.test(e)) && buildModel(cfgWith({ T: 90 })).errors.some(e => /^Panel thickness/.test(e)), "size / thickness range errors");
const M1 = buildModel(cfgWith({ faces: { NF: { kind: "bar", callouts: "N12-200 V" }, FF: { kind: "bar", callouts: "" } } }));
ok(!M1.errors.length && M1.warnings.some(w => /^Near face has bars one way only \(vertical\)/.test(w)) && M1.warnings.some(w => /^Far face has no reinforcement/.test(w)) && !M1.runs.some(r => r.face === "FF"), "one-way face and empty face warnings " + JSON.stringify(M1.warnings));
ok(M1.chairs.length && M1.ORDER.join() === "FF1,FF2,CH,IN,NF2,NF1", "an empty bed face still leaves the steps");
ok(buildModel(cfgWith({ features: { perimeter: false, trims: false } })).runs.every(r => r.kind === "main" || r.kind === "mesh" || r.kind === "insert"), "switches turn the edge bars off");

// ---- cast-in inserts (#33c): catalogue, checks, component bars ----
const insOf = (M, id) => M.inserts.find(q => q.id === id);
const chk = (ins, rule) => ins.checks.find(c => c.rule === rule);
const noFlags = (M, name) => ok(M.inserts.every(q => !q.fails.length && !q.advis.length) && !M.insertFlags.length, name + ": unexpected flags " + JSON.stringify(M.inserts.map(q => [q.id, q.fails, q.advis]).concat(M.insertFlags)));
// the example: two 3Dx 10 t lifters in the top edge and two QwikFoot braces on NF, every check passing
ok(M.inserts.length === 4 && M.inserts.map(q => q.id).join() === "L1,L2,B1,B2" && M.inserts.map(q => q.kind).join() === "lifter,lifter,brace,brace", "example inserts " + JSON.stringify(M.inserts.map(q => [q.id, q.kind])));
noFlags(M, "example");
const L1 = insOf(M, "L1"), B1 = insOf(M, "B1");
ok(L1.x === 450 && L1.y === 3000 && L1.z === 100 && L1.edge === "top" && L1.pos === "450 from the left edge, in the top edge", "L1 position " + JSON.stringify([L1.x, L1.y, L1.z, L1.pos]));
ok(L1.wll.wll === 10 && L1.wll.at === 25 && /^10 t at 25 MPa/.test(L1.wll.text) && M.panel.fcLift === 25, "L1 WLL at f'c lift 25: " + JSON.stringify(L1.wll));
ok(L1.checks.map(c => c.rule).join() === "thickness,centred,edge,opening,spacing,assumes,room-tension" && L1.checks.every(c => c.pass), "L1 checks " + JSON.stringify(L1.checks.map(c => c.rule + ":" + c.pass)));
ok(chk(L1, "edge").value === 450 && chk(L1, "edge").min === 420 && chk(L1, "spacing").value === 4914 && chk(L1, "spacing").min === 840, "L1 edge / spacing values " + JSON.stringify([chk(L1, "edge"), chk(L1, "spacing")]));
ok(B1.z === 200 && B1.face === "NF" && B1.checks.map(c => c.rule).join() === "edge,opening,spacing,lifter-line" && chk(B1, "edge").min === 300 && chk(B1, "lifter-line").value === 550 && chk(B1, "spacing").min === 305, "B1 on the top face, its checks " + JSON.stringify(B1.checks));
// every lifter brings exactly its catalogue bars: one N16 TB each, legs 500 at 45°, on a 4 db pin, at mid-thickness, in the IN layer, tagged to the insert
const tb = M.bars.filter(b => b.layer === "IN");
ok(tb.length === 2 && tb.every(b => b.insert && b.insert.kind === "lifter" && b.code === "TB" && b.size === 16 && b.dimStr === "A 500 · B 500 · angle 45°" && b.geom.dp === 64 && b.pts.length === 3 && b.pts.every(p => p[2] === 100) && b.run.kind === "insert"), "3Dx tension bars " + JSON.stringify(tb.map(b => [b.code, b.dimStr, b.geom.dp, b.pts])));
ok(L1.bars.length === 1 && L1.bars[0].pts[1][0] === 450 && L1.bars[0].pts[1][1] === 2700 && Math.round(L1.bars[0].pts[0][1]) === 2245 && Math.round(L1.bars[0].pts[0][0] - L1.bars[0].pts[2][0]) === 377, "L1 tension bar through the hole 300 below the edge, legs splayed 45°: " + JSON.stringify(L1.bars[0].pts));
ok(B1.bars.length === 0 && insOf(M, "B2").bars.length === 0, "QwikFoot braces need no component bars");
const tbMark = M.marks.find(m => m.layer === "IN");
ok(tbMark && tbMark.qty === 2 && tbMark.code === "TB" && tbMark.len === 890 && M.marks.filter(m => m.layer === "IN").length === 1, "one TB mark for the two lifters " + JSON.stringify(tbMark));
ok(M.insertBodies.length === 4 && M.insertBodies.every(b => b.insert && b.layer === "IN" && b.kind === "body") && M.insertBodies[0].pts[1][1] === 2700 && M.insertBodies[2].pts[0][2] === 200 && M.insertBodies[2].pts[1][2] === 104, "insert bodies: edge anchors 300 into the panel, braces 96 into the face " + JSON.stringify(M.insertBodies.map(b => b.pts)));
ok(M.runs.filter(r => r.kind === "insert").length === 4 && M.runs.filter(r => r.kind === "insert").every(r => r.tagPos && r.layer === "IN") && L1.run.label === "L1 · 3Dx 10 t" && /^LIFTER L1: REID SWIFTLIFT 3DX 10 T EDGE LIFT, 450 FROM THE LEFT EDGE, IN THE TOP EDGE, WLL 10 T AT 25 MPA/.test(L1.run.callout), "insert runs and tags " + JSON.stringify([L1.run.label, L1.run.callout]));
ok(M.LBY.IN && /^Inserts · 2 lifters, 2 brace inserts \+ their bars$/.test(M.LBY.IN.name) && M.steps[4].sub === "2 lifters, 2 brace inserts · 2 component bars", "inserts layer name / step " + JSON.stringify([M.LBY.IN.name, M.steps[4].sub]));
ok(M.catalogue.edition === "Findings 12.2 seed" && M.catalogue.date === "2026-11-16" && Object.keys(INSERT_CAT.items).length === 12 && Object.values(INSERT_CAT.items).every(c => c.doc && c.std && c.kind && c.place), "catalogue carries its edition, date and a source on every entry");
// Findings 12.7 cases: 3Dx at 400 flags the edge distance; two 3Dx 800 apart flag spacing; a brace 250 from an edge flags; three lifters flag the count
const Mx = buildModel(cfgWith({ inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 400 }, { id: "L2", type: "3DX10", edge: "top", x: 1200 }, { id: "L3", type: "3DX10", edge: "top", x: 5200 }, { id: "B1", type: "QF20B", edge: "NF", x: 250, y: 1500 }, { id: "B2", type: "QF20B", edge: "NF", x: 5600, y: 1500 }] }));
ok(!Mx.errors.length, "flag cases build: " + Mx.errors);
const xL1 = insOf(Mx, "L1"), xL2 = insOf(Mx, "L2"), xB1 = insOf(Mx, "B1");
ok(xL1.fails.join() === "edge,spacing" && chk(xL1, "edge").value === 400 && !chk(xL1, "edge").pass && xL1.flagged, "3Dx at 400 from the corner fails the edge check: " + JSON.stringify(xL1.fails));
ok(xL2.fails.join() === "spacing" && chk(xL2, "spacing").value === 800 && chk(xL2, "spacing").min === 840, "two 3Dx 800 apart fail the spacing check: " + JSON.stringify(chk(xL2, "spacing")));
ok(xB1.fails.indexOf("edge") >= 0 && chk(xB1, "edge").value === 250 && chk(xB1, "edge").min === 300, "a brace 250 from the edge fails: " + JSON.stringify(chk(xB1, "edge")));
ok(Mx.insertFlags.some(f => f.rule === "lifter-count") && Mx.insertFlags.some(f => f.rule === "lifter-symmetry"), "three lifters flag the count (and these are off the CoG): " + JSON.stringify(Mx.insertFlags));
ok(Mx.warnings.filter(w => /^Insert \d \(/.test(w)).length === 5 && Mx.warnings.some(w => /^Insert 1 \(L1, Reid 3Dx 10 t\) fails the edge check: 400 to the panel corner; catalogue edge distance 420\.$/.test(w)) && Mx.warnings.some(w => /^Lifters: 3 lifters; the any-two-of-four rule/.test(w)), "flag warnings " + JSON.stringify(Mx.warnings));
ok(Mx.bars.filter(b => b.layer === "IN").length === 3 && Mx.marks.find(m => m.layer === "IN").qty === 3, "three lifters, three tension bars scheduled");
// a lifter over the window: its tension bar runs into the corner diagonals (room check), the schedule still carries it
const Mr = buildModel(cfgWith({ inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 450 }, { id: "L2", type: "3DX10", edge: "top", x: 4900 }] }));
ok(!Mr.errors.length && insOf(Mr, "L2").fails.join() === "room-tension" && /crosses OPENING BARS · NF in one plane/.test(chk(insOf(Mr, "L2"), "room-tension").text) && Mr.bars.filter(b => b.layer === "IN").length === 2, "tension bar into the diagonals is flagged: " + JSON.stringify(insOf(Mr, "L2").checks));
const Mr2 = buildModel(cfgWith({ inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 3900 }] }));
ok(/the tension bar runs into WINDOW/.test(chk(insOf(Mr2, "L1"), "room-tension").text) && insOf(Mr2, "L1").fails.indexOf("room-tension") >= 0 && chk(insOf(Mr2, "L1"), "opening").pass, "a lifter over the window: the anchor clears it, its bar does not");
// JAWS SJL in a 150 panel at 15 MPa: WLL 2.4 t, a straight N12 × 300 tension bar and an N10 shear U, both at mid-thickness
const Mj = buildModel(cfgWith({ T: 150, fcLift: 15, faces: { NF: { kind: "bar", callouts: "" }, FF: { kind: "mesh", callouts: "SL82 H" } }, openings: [], inserts: [{ id: "L1", type: "SJL", edge: "top", x: 1500 }, { id: "L2", type: "SJL", edge: "top", x: 4500 }] }));
ok(!Mj.errors.length, "SJL panel errors " + Mj.errors); noFlags(Mj, "SJL panel"); checkSteel(Mj, "SJL panel");
const jL = insOf(Mj, "L1"), jT = jL.bars.find(b => b.code === "S"), jU = jL.bars.find(b => b.code === "U");
ok(jL.wll.wll === 2.4 && jL.wll.at === 15 && jL.bars.length === 2 && jT && jU, "SJL WLL and bars " + JSON.stringify([jL.wll, jL.bars.map(b => b.code)]));
ok(jT.size === 12 && jT.len === 300 && jT.pts[0][1] === 3000 - 150 && jT.pts[0][2] === 75 && jT.pts[0][0] === 1350 && jT.pts[1][0] === 1650, "SJL tension bar N12 × 300 along the edge through the hole: " + JSON.stringify(jT.pts));
ok(jU.size === 10 && jU.dimStr === "A 200 · B 70 · C 200" && jU.pts.length === 4 && jU.pts[1][1] === 3000 - 40 && jU.pts[1][2] === 45 && jU.pts[2][2] === 105 && jU.geom.dp === 40, "SJL shear U N10 legs 200, 60 wide over the notch: " + JSON.stringify([jU.dimStr, jU.pts, jU.geom.dp]));
const Mj2 = buildModel(cfgWith({ T: 200, inserts: [{ id: "L1", type: "SJL", edge: "top", x: 1500 }, { id: "L2", type: "SJL", edge: "top", x: 4300 }] }));
ok(insOf(Mj2, "L1").fails.join() === "thickness" && /published for 100–150/.test(chk(insOf(Mj2, "L1"), "thickness").text), "SJL in a 200 panel fails the thickness check: " + JSON.stringify(insOf(Mj2, "L1").checks));
// WLL table steps and the lifting strength
ok(insertWll(INSERT_CAT.items["3DX10"], 20).wll === 9.5 && insertWll(INSERT_CAT.items["3DX10"], 32).wll === 10 && insertWll(INSERT_CAT.items["3DX10"], 12).below === 15 && insertWll(INSERT_CAT.items.QF20B, 25).text === "brace WLL 27.4 kN at 20 MPa", "insertWll steps");
const Mf = buildModel(cfgWith({ fcLift: 12 }));
ok(!Mf.errors.length && insOf(Mf, "L1").fails.join() === "fc-lift" && insOf(Mf, "L2").fails.join() === "fc-lift" && Mf.warnings.some(w => /fails the fc lift check: no WLL published below 15 MPa; f'c at lift is 12/.test(w)), "f'c at lift 12 has no WLL: " + JSON.stringify(Mf.warnings));
ok(buildModel(cfgWith({ fcLift: 50 })).errors.some(e => /^Concrete f'c at lift must be 10 MPa or more and not above the service f'c \(40\)/.test(e)) && buildModel(cfgWith({ fcLift: "" })).panel.fcLift === 40, "f'c at lift above f'c is an error; blank = f'c");
// face lifters: two floating bars each; off-centre lifters are an advisory, braces alone / high are advisories
const Mface = buildModel(cfgWith({ openings: [], inserts: [{ id: "F1", type: "RFL5", edge: "NF", x: 1500, y: 1500 }, { id: "F2", type: "RFL5", edge: "NF", x: 4500, y: 1500 }, { id: "B1", type: "QF20B", edge: "NF", x: 3000, y: 2500 }] }));
ok(!Mface.errors.length && insOf(Mface, "F1").bars.length === 2 && insOf(Mface, "F1").bars.every(b => b.size === 12 && b.len === 300 && b.pts[0][2] === 100) && Math.abs(insOf(Mface, "F1").bars[0].pts[0][1] - insOf(Mface, "F1").bars[1].pts[0][1]) === 60, "face lifter floating bars " + JSON.stringify(insOf(Mface, "F1").bars.map(b => b.pts)));
ok(Mface.insertFlags.map(f => f.rule).sort().join() === "brace-count,brace-height" && !Mface.inserts.some(q => q.fails.length), "one brace, high up: advisories only " + JSON.stringify(Mface.insertFlags));
checkSteel(Mface, "face lifters");
const Msy = buildModel(cfgWith({ openings: [], inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 1000 }, { id: "L2", type: "3DX10", edge: "top", x: 4000 }] }));
ok(Msy.insertFlags.map(f => f.rule).join() === "lifter-symmetry" && /centre \(2,500 from the left edge\) is 500 off the centre of gravity \(3,000\)/.test(Msy.insertFlags[0].text), "lifters off the CoG: " + JSON.stringify(Msy.insertFlags));
ok(!buildModel(cfgWith({ openings: [], inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 1000 }, { id: "L2", type: "3DX10", edge: "top", x: 5000 }] })).insertFlags.length, "symmetric lifters raise nothing");
ok(buildModel(cfgWith({ inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 2900 }] })).insertFlags.map(f => f.rule).join() === "lifter-count", "one lifter is advised against");
// a lifter in a side edge: y along it; a lifter whose mesh assumption is not met is advised
const Mside = buildModel(cfgWith({ openings: [], inserts: [{ id: "L1", type: "3DX10", edge: "left", y: 1500 }, { id: "L2", type: "3DX10", edge: "right", y: 1500 }] }));
ok(!Mside.errors.length && insOf(Mside, "L1").x === 0 && insOf(Mside, "L1").pos === "1,500 from the bottom edge, in the left edge" && insOf(Mside, "L1").bars[0].pts[1][0] === 300 && insOf(Mside, "L1").bars[0].pts[1][1] === 1500 && !Mside.insertFlags.length, "side-edge lifters " + JSON.stringify([insOf(Mside, "L1").pos, insOf(Mside, "L1").bars[0].pts, Mside.insertFlags]));
checkSteel(Mside, "side lifters");
const Mbars = buildModel(cfgWith({ openings: [], faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" } }, inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 1000 }, { id: "L2", type: "3DX10", edge: "top", x: 5000 }] }));
ok(insOf(Mbars, "L1").advis.join() === "assumes" && /this panel has bars, no mesh/.test(chk(insOf(Mbars, "L1"), "assumes").text) && !insOf(Mbars, "L1").fails.length, "3Dx in an all-bar panel: the mesh assumption is an advisory " + JSON.stringify(insOf(Mbars, "L1").checks));
// ferrules: c1 / s1 from the catalogue, the QwikFix cross bar at the insert's foot on the far (bed) face
const Mfe = buildModel(cfgWith({ openings: [], inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 1000 }, { id: "L2", type: "3DX10", edge: "top", x: 5000 }, { id: "F1", type: "QX20", edge: "FF", x: 2000, y: 1500 }, { id: "F2", type: "QX20", edge: "FF", x: 2200, y: 1500 }, { id: "F3", type: "QF12", edge: "FF", x: 80, y: 1500 }] }));
ok(!Mfe.errors.length, "ferrule panel errors " + Mfe.errors);
const F1 = insOf(Mfe, "F1"), F3 = insOf(Mfe, "F3");
ok(F1.z === 0 && F1.bars.length === 1 && F1.bars[0].size === 12 && F1.bars[0].len === 300 && F1.bars[0].pts[0][2] === 84 && F1.bars[0].pts[0][1] === 1500, "QwikFix cross bar N12 × 300 at the foot, 84 in from the bed face: " + JSON.stringify(F1.bars[0].pts));
ok(F1.fails.join() === "spacing" && chk(F1, "spacing").value === 200 && chk(F1, "spacing").min === 270 && F3.fails.join() === "edge" && chk(F3, "edge").min === 85 && chk(F3, "edge").value === 80, "ferrule s1 / c1 fails " + JSON.stringify([F1.checks, F3.checks]));
ok(Mfe.insertBodies.find(b => b.insert === F1).pts[1][2] === 96, "a ferrule body reaches its length into the panel");
// row errors: every bad row by number, the rest builds
const Mie = buildModel(cfgWith({ inserts: [{ id: "L1", type: "3DX10", edge: "top", x: 450 }, { id: "X1", type: "NOPE", edge: "top", x: 1000 }, { id: "X2", type: "3DX10", edge: "NF", x: 1000, y: 1000 }, { id: "X3", type: "QF20B", edge: "top", x: 1000 }, { id: "X4", type: "3DX10", edge: "top" }, { id: "X5", type: "QF20B", edge: "NF", x: 1000 }, { id: "X6", type: "3DX10", edge: "top", x: 7000 }, { id: "L1", type: "3DX10", edge: "top", x: 5364 }, { id: "X8", type: "QF20B", edge: "NF", x: 4000, y: 2000 }] }));
const wantI = [/^Insert 2 \(X1\): unknown insert type "NOPE"/, /^Insert 3 \(X2\): SwiftLift 3Dx 10 t edge lift is an edge anchor; place it in the top, bottom, left or right edge/, /^Insert 4 \(X3\): QwikFoot brace insert 96 long \(M20\) sits in a face; place it on NF or FF/,
  /^Insert 5 \(X4\): give its position along the top edge \(x from the left edge\)/, /^Insert 6 \(X5\): give x \(from the left edge\) and y \(from the bottom edge\)/, /^Insert 7 \(X6\): is off the panel/, /^Insert 8 \(L1\): another insert already has this id/, /^Insert 9 \(X8\): sits in an opening/];
ok(Mie.errors.length === wantI.length && wantI.every((re, i) => re.test(Mie.errors[i] || "")) && Mie.inserts.length === 1, "insert row errors:\n  " + Mie.errors.join("\n  "));
// the inserts step on its sheet: the component bars drawn, one tag per insert
const S4 = buildSheet(M, ["IN"], ["FF1", "FF2", "CH"]);
ok(S4.bars.filter(b => !b.ghost).length === 2 && S4.tags.length === 2 && S4.tags.map(t => t.text).sort().join() === "L1 · 3Dx 10 t,L2 · 3Dx 10 t" && /PANEL SHEET · INSERTS/.test(S4.title[0]), "inserts sheet " + JSON.stringify([S4.bars.length, S4.tags.map(t => t.text), S4.title]));

// no inserts at all: the step stays, empty
const Mno = buildModel(cfgWith({ inserts: [] }));
ok(!Mno.errors.length && Mno.ORDER.indexOf("IN") === 3 && Mno.steps[4].sub === "none" && Mno.LBY.IN.name === "Inserts · none" && Mno.bars.length === 83, "no inserts: " + JSON.stringify([Mno.steps[4], Mno.LBY.IN.name, Mno.bars.length]));

// ---- the panel elevation sheet (#33d, Findings 12.6): symbols, CoG, notes, approval, legend, insert table, tag ----
const hit = (p, q, m) => p.x0 < q.x1 + m && q.x0 < p.x1 + m && p.y0 < q.y1 + m && q.y0 < p.y1 + m;
const txtW = (t, h) => t.length * 0.6 * h + 120;   // the sheet's monospace width rule (SHEET_TXT)
// every insert is a symbol on the Inserts sheet, in ink, at the insert, with its WLL / kind and x / y from the bottom-left corner
const sy4 = S4.inserts.slice().sort((a, b) => a.id.localeCompare(b.id));
ok(sy4.map(q => [q.id, q.sym, q.x, q.y, q.label, q.coord, q.ghost, q.flagged].join("|")).join(";") === "B1|brace|1000|1600|BRACE|x 1,000 · y 1,600|false|false;B2|brace|5600|1600|BRACE|x 5,600 · y 1,600|false|false;L1|lifter|450|3000|WLL 10 t|x 450 · y 3,000|false|false;L2|lifter|5364|3000|WLL 10 t|x 5,364 · y 3,000|false|false",
  "insert symbols on the Inserts sheet: " + JSON.stringify(sy4.map(q => [q.id, q.sym, q.x, q.y, q.label, q.coord, q.ghost, q.flagged])));
ok(sy4.every(q => q.r > 0 && q.box && q.box.x0 < q.x && q.box.x1 > q.x && q.line1 === q.id + " · " + q.label) && sy4.filter(q => q.edge === "top").every(q => q.ly > q.y + q.r) && sy4.filter(q => q.face).every(q => q.ly < q.y - q.r), "symbol boxes and label sides (edge anchors labelled outside the panel, face inserts below)");
const symBoxes = [].concat(...sy4.map(q => q.boxes));
ok(!symBoxes.some((b, i) => symBoxes.some((o, j) => j > i && hit(b, o, 0))) && !S4.tags.some(t => symBoxes.some(b => hit(t.box, b, 0))) && !S4.notes.some(n => symBoxes.some(b => hit(n.box, b, 0))) && !S4.tags.some(t => t.overlap), "symbols, run tags and notes keep clear of each other");
// the CoG cross at the computed centre of gravity, its text clear of the window, the symbols and the notes
ok(S4.cog && S4.cog.x === M.panel.cog.x && S4.cog.y === M.panel.cog.y && S4.cog.text === "CoG 2,907 / 1,479" && S4.cog.r > 0, "CoG cross " + JSON.stringify(S4.cog));
{ const tb = { x0: S4.cog.tx - txtW(S4.cog.text, S4.cog.h) / 2, x1: S4.cog.tx + txtW(S4.cog.text, S4.cog.h) / 2, y0: S4.cog.ty - S4.cog.h * 0.7, y1: S4.cog.ty + S4.cog.h * 0.7 };
  ok(!S4.concrete.holes.some(h => hit(tb, h, 0)) && !symBoxes.some(b => hit(tb, b, 0)) && !S4.notes.some(n => hit(tb, n.box, 0)) && tb.x0 > 0 && tb.x1 < M.L && tb.y0 > 0 && tb.y1 < M.W, "CoG text finds room inside the panel clear of the window and the symbols: " + JSON.stringify(tb)); }
// the notes block: size, mass, CoG, f'c in service and at lift, cover, cast face, steel, the inserts by type, date fields
const PNS = S4.panel;
ok(PNS && PNS.notes.join("\n") === ["6,000 × 3,000 × 200 THK · 16.32 m² NET", "MASS 7,834 kg AT 2,400 kg/m³ · 3.26 m³", "CoG 2,907 FROM LEFT · 1,479 FROM BOTTOM", "f'c 40 MPa IN SERVICE · 25 MPa AT LIFT", "COVER 30 EACH FACE", "FF ON THE BED (CAST FACE) · NF UP",
  "STEEL 282 kg · 85 BARS, 12 MARKS + 1 MESH SHEET", "L1, L2 REID 3DX 10 T · WLL 10 t AT 25 MPa", "B1, B2 ANCON QWIKFOOT 96 LONG (M20)", "CAST DATE  ____ / ____ / ________", "LIFT NOT BEFORE  ____ / ____ / ________"].join("\n"), "panel notes block:\n  " + (PNS ? PNS.notes.join("\n  ") : "none"));
ok(Math.round(M.panel.mass) === 7834 && near(M.panel.mass, 16.32 * 0.2 * 2400, 20), "the notes' mass is the model's mass at 2,400 kg/m³");
// approval block blank on the example (name and date lines to be filled by hand), the fields from cfg.approval when given
ok(JSON.stringify(PNS.approval) === JSON.stringify({ drawn: "", checked: "", approved: "", rev: "" }) && PNS.texts.some(t => t.text === "APPROVAL · REV __") && ["DRAWN", "CHECKED", "ENGINEER APPROVED", "NAME", "DATE"].every(w => PNS.texts.some(t => t.text === w)), "blank approval block on the example");
const Mapp = buildModel(cfgWith({ approval: { drawn: "J. Fixer", checked: " A. Scheduler ", approved: "I. Engineer RPEQ 1234", rev: "B" } }));
const Sapp = buildSheet(Mapp, ["IN"], ["FF1", "FF2", "CH"]);
ok(Sapp.panel.approval.drawn === "J. Fixer" && Sapp.panel.approval.checked === "A. Scheduler" && Sapp.panel.approval.approved === "I. Engineer RPEQ 1234" && Sapp.panel.approval.rev === "B" && Sapp.panel.texts.some(t => t.text === "APPROVAL · REV B") && Sapp.panel.texts.some(t => t.text === "I. Engineer RPEQ 1234"), "approval fields printed from the inputs: " + JSON.stringify(Sapp.panel.approval));
// legend: the four symbols, each drawn once as a glyph beside its words
ok(PNS.legend.map(l => l.sym).join() === "lifter,brace,ferrule,cog" && PNS.glyphs.map(g => g.sym).join() === "lifter,brace,ferrule,cog" && PNS.texts.some(t => /AS 3850.2 SYMBOLS NOT YET VERIFIED/.test(t.text)), "symbol legend " + JSON.stringify(PNS.legend));
// the insert table: one row per insert with the Findings 12.6 columns, the text fitting its column at the table's text size
const tbl = PNS.table;
ok(tbl && tbl.cols.map(c => c.key).join() === PANEL_TABLE_COLS.map(c => c[0]).join() && tbl.cols.map(c => c.head).join("|") === "ID|KIND|TYPE|WLL AT f'c LIFT|X|Y|WHERE|COMPONENT BARS|CHECKS", "insert table columns " + JSON.stringify(tbl && tbl.cols.map(c => c.head)));
ok(tbl && tbl.rows.map(r => Object.values(r.cells).join("|")).join(";") === "L1|LIFTER|REID 3DX 10 T|10 t AT 25 MPa|450|3,000|TOP EDGE|1 N16 TB (P1-01)|ALL PASS;L2|LIFTER|REID 3DX 10 T|10 t AT 25 MPa|5,364|3,000|TOP EDGE|1 N16 TB (P1-01)|ALL PASS;B1|BRACE INSERT|ANCON QWIKFOOT 96 LONG (M20)|27.4 kN AT 20 MPa|1,000|1,600|ON NF|NONE|ALL PASS;B2|BRACE INSERT|ANCON QWIKFOOT 96 LONG (M20)|27.4 kN AT 20 MPa|5,600|1,600|ON NF|NONE|ALL PASS",
  "insert table rows:\n  " + (tbl ? tbl.rows.map(r => Object.values(r.cells).join(" | ")).join("\n  ") : "none"));
ok(tbl && /^INSERTS · 4 CAST-IN INSERTS · WLL AT f'c LIFT 25 MPa · FINDINGS 12.2 SEED \(2026-11-16\)$/.test(tbl.title) && tbl.rows.every(r => r.y1 > r.y0 && r.y1 <= tbl.y1 && r.y0 >= tbl.y0) && tbl.y1 < -700, "insert table title and row geometry under the panel: " + JSON.stringify([tbl && tbl.title, tbl && [tbl.x0, tbl.x1, tbl.y0, tbl.y1]]));
ok(tbl && tbl.rows.every(r => tbl.cols.every(c => txtW(r.cells[c.key], 130) <= c.w)) && tbl.cols.every(c => txtW(c.head, 130) <= c.w), "every table cell fits its column at 130 mm text: " + JSON.stringify(tbl && tbl.rows.map(r => tbl.cols.filter(c => txtW(r.cells[c.key], 130) > c.w).map(c => c.key))));
// the blocks sit outside the panel and the sheet bounds hold them all
const inPanel = r => r.x1 > 0 && r.x0 < M.L && r.y1 > 0 && r.y0 < M.W;
ok(!PNS.rects.some(inPanel) && PNS.column.x0 >= M.L + 500 && PNS.column.y1 === M.W && PNS.legendBox.y1 < -700 && tbl.y1 < Math.min(PNS.column.y0, PNS.legendBox.y0), "blocks outside the panel: column right, legend and table below " + JSON.stringify([PNS.column, PNS.legendBox, [tbl.x0, tbl.x1, tbl.y0, tbl.y1]]));
ok(PNS.rects.concat([tbl, PNS.column, PNS.legendBox]).every(r => r.x0 >= S4.bounds.x0 && r.x1 <= S4.bounds.x1 && r.y0 >= S4.bounds.y0 && r.y1 <= S4.bounds.y1) && PNS.texts.every(t => t.x >= S4.bounds.x0 && t.x <= S4.bounds.x1 && t.y >= S4.bounds.y0 && t.y <= S4.bounds.y1), "sheet bounds hold every block and text");
// opening setout chains from the bottom-left corner (x to the opening and its width; y likewise)
ok(S4.openDims.map(d => d.measure + ":" + d.a + "-" + d.b + "=" + d.text).join() === "x:0-3200=3,200,x:3200-4600=1,400,y:0-1100=1,100,y:1100-2300=1,200" && S4.openDims.every(d => d.at < 0 && d.at > -700), "opening setout dims " + JSON.stringify(S4.openDims));
// a face sheet carries the CoG, the notes and the legend but no insert symbols or table; with the inserts already in they are faint
const S6 = buildSheet(M, ["FF1"], []);
ok(S6.inserts.length === 0 && S6.cog && S6.panel && !S6.panel.table && S6.panel.notes.length === PNS.notes.length && S6.panel.legend.length === 4 && S6.bounds.y0 > S4.bounds.y0, "a face sheet: CoG and notes, no symbols or table " + JSON.stringify([S6.inserts.length, !!S6.panel.table, S6.bounds]));
const S7 = buildSheet(M, ["NF2"], ["FF1", "FF2", "CH", "IN"]);
ok(S7.inserts.length === 4 && S7.inserts.every(q => q.ghost) && !S7.panel.table, "inserts already in: symbols faint, no table");
const S8 = buildSheet(M, M.ORDER.slice(), []);
ok(S8.inserts.length === 4 && S8.inserts.every(q => !q.ghost) && S8.panel.table && S8.panel.table.rows.length === 4 && /PANEL SHEET · ALL LAYERS/.test(S8.title[0]) && /VIEWED FROM NF/.test(S8.notes[0].text), "the finished panel is the full elevation " + JSON.stringify([S8.inserts.length, S8.title, S8.notes[0].text]));
// a flagged lifter: red symbol, its table row says which check fails; the panel-level advisories head the table
const Sx = buildSheet(Mx, ["IN"], ["FF1", "FF2", "CH"]);
ok(Sx.inserts.find(q => q.id === "L1").flagged && Sx.panel.table.rows.find(r => r.ins === "L1").cells.checks === "FAILS EDGE, SPACING" && Sx.panel.table.rows.find(r => r.ins === "B1").cells.checks === "FAILS EDGE, LIFTER LINE" && Sx.panel.table.rows.find(r => r.ins === "B2").cells.checks === "ALL PASS" && / · NOTE: LIFTER COUNT, LIFTER SYMMETRY$/.test(Sx.panel.table.title) && Sx.panel.table.rows.find(r => r.ins === "L1").flagged, "flagged inserts in the table " + JSON.stringify([Sx.panel.table.title, Sx.panel.table.rows.map(r => r.cells.checks)]));
// no inserts: no symbols, an empty table that says so, the notes say so
const Sno = buildSheet(Mno, ["IN"], ["FF1", "FF2", "CH"]);
ok(Sno.inserts.length === 0 && Sno.panel.table && Sno.panel.table.rows.length === 0 && /^INSERTS · NO CAST-IN INSERTS/.test(Sno.panel.table.title) && Sno.panel.notes.indexOf("NO INSERTS") >= 0 && Sno.panel.texts.some(t => t.text === "NONE"), "no inserts on the sheet " + JSON.stringify([Sno.panel.table && Sno.panel.table.title, Sno.panel.notes]));
// a ferrule and a side-edge lifter: their symbols, labels and table rows
const Msf = buildModel(cfgWith({ inserts: [{ id: "L1", type: "SJU", edge: "left", y: 1500 }, { id: "F1", type: "QX20", edge: "NF", x: 3000, y: 500 }] }));
const Ssf = buildSheet(Msf, ["IN"], ["FF1", "FF2", "CH"]);
ok(!Msf.errors.length && Ssf.inserts.map(q => [q.id, q.sym, q.x, q.y, q.label, q.coord].join("|")).join(";") === "L1|lifter|0|1500|WLL 10 t|x 0 · y 1,500;F1|ferrule|3000|500|FERRULE|x 3,000 · y 500" && Ssf.inserts[0].lx < 0 && Ssf.panel.table.rows.map(r => r.cells.where + "/" + r.cells.bars + "/" + r.cells.wll).join(";") === "LEFT EDGE/1 N16 × 500 + 1 N16 U (P1-01, P1-02)/10 t AT 25 MPa;ON NF/1 N12 × 300 (P1-03)/46.3 kN tension AT 50 MPa",
  "side-edge lifter and ferrule symbols " + JSON.stringify([Msf.errors, Ssf.inserts.map(q => [q.id, q.sym, q.x, q.y, q.label, q.coord, q.lx]), Ssf.panel.table.rows.map(r => r.cells)]));
// the CoG of a panel with one off-centre opening moves away from it (Findings 12.7)
const Mcg = buildModel(cfgWith({ openings: [{ name: "WINDOW", x0: 4500, y0: 300, x1: 5500, y1: 2500 }], inserts: [] }));
ok(!Mcg.errors.length && Mcg.panel.cog.x < 3000 - 100 && Mcg.panel.cog.y > 1500 && buildSheet(Mcg, ["IN"], []).cog.x === Mcg.panel.cog.x, "CoG moves away from an off-centre window: " + JSON.stringify([Mcg.errors, Mcg.panel.cog]));
// the panel tag: what is marked on the element (mark, size, mass, f'c at lift, cast face, CoG, lifters, date fields)
const tg = panelTag(M);
ok(tg.mark === "P1" && tg.size === "6,000 × 3,000 × 200" && tg.mass === 7834 && tg.massText === "7,834 kg" && tg.fc === 40 && tg.fcLift === 25 && tg.castFace === "FF" && tg.cog === "2,907 / 1,479" && tg.lifters.join() === "L1,L2" && tg.lifterText === "2 × Reid 3Dx 10 t · WLL 10 t" && tg.castDate === "" && tg.liftDate === "",
  "panel tag fields " + JSON.stringify(tg));
ok(tg.lines.join("\n") === "P1\n6,000 × 3,000 × 200 · 7,834 kg\nf'c 40 · LIFT AT 25 MPa · FF DOWN\nCoG 2,907 / 1,479 · L1 L2 WLL 10 t\nCAST ____/____/________ · LIFT NOT BEFORE ____/____/________" && PNS.tag.lines.join() === tg.lines.join(), "panel tag lines:\n  " + tg.lines.join("\n  "));
ok(panelTag(Mno).lifterText === "no lifters" && /^CoG [\d,]+ \/ [\d,]+$/.test(panelTag(Mno).lines[3]), "panel tag without lifters");

// ---- grammar on panel lines ----
const pg = s => parseCallout(s, { scheme: "TB" });
ok(pg("SL82 H").kind === "mesh" && pg("SL82 H").direction === "H" && pg("RL918 NF V").position === "NF" && pg("N12-200 VERT FF").direction === "V" && pg("N16 @ 200 HORIZONTAL").spacing === 200, "panel callouts parse");

// ---- the placing sheet of a panel face ----
const S1 = buildSheet(M, ["FF1"], []);
ok(S1.grids.x.length === 0 && S1.gridDims.length === 2 && S1.concrete.slab.id === "PANEL" && S1.concrete.holes.length === 1, "panel sheet frame");
ok(S1.bars.length === pc.wires.length && S1.strip.sheets === 1 && S1.strip.bars === 0 && S1.strip.callouts.some(c => /^SL82 FF, LONG WIRES HORIZONTAL, ONE SHEET MADE TO SIZE/.test(c)) && /FAR FACE · MESH SL82 H/.test(S1.title[0]) && /0 BARS THIS LAYER \+ 1 MESH SHEET/.test(S1.title[1]), "mesh face sheet " + JSON.stringify([S1.bars.length, S1.strip, S1.title]));
ok(S1.tags.length === 1 && S1.tags[0].text === "SL82 H · FF" && (S1.runMarks[runOf(M, "FF1", "mesh").id] || []).length === 1, "mesh tag and one mark label per sheet");
const S5 = buildSheet(M, ["NF2"], ["FF1", "FF2", "CH"]);
ok(S5.tags.map(t => t.text).sort().join() === "30 N12-200 V · NF,N16 PERIMETER · NF,OPENING BARS · NF" && S5.dims.length === 2 && S5.dims.every(d => /edge/.test(d.grid)), "NF inner sheet tags / setout dims " + JSON.stringify([S5.tags.map(t => t.text), S5.dims]));
ok(S5.strip.bars === nfV.bars.length + 8 + 4 && !S5.tags.some(t => t.overlap), "NF inner sheet count / overlaps");

// ---- the floor is untouched ----
const F = buildModel(DEFAULT_CFG);
ok(F.kind === undefined && F.bars.filter(b => !b.existing).length === 1458 && F.marks.length === 78 && Math.round(F.kg) === 5300, "the Level 1 floor changed: " + [F.bars.filter(b => !b.existing).length, F.marks.length, Math.round(F.kg)]);

if (problems.length) { console.error("panel: FAIL\n" + problems.slice(0, 30).join("\n") + (problems.length > 30 ? "\n…and " + (problems.length - 30) + " more" : "")); process.exit(1); }
console.log("panel: OK (" + M.bars.length + " bars + " + M.meshPieces.length + " mesh sheet on the example; " + [Ms, Mbig].reduce((s, m) => s + m.meshPieces.length, 0) + " stock pieces checked; elevation sheet: " + S4.inserts.length + " symbols, " + tbl.rows.length + " table rows)");
