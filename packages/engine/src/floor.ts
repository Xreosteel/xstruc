// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { EXPLODE, KGM, LAYERS, LBY } from "./constants.ts";
import { FLOOR_ORDER, MAT_LAYERS, STOCK, bendGeom, classify, cutLength, fmt, pinDia } from "./bending.ts";
import { LAP_CASES, lapCalc, lapLookup, parseLapTable } from "./laps.ts";
import { gridSetout, nearestGrid } from "./setout.ts";
import { DEFAULT_CFG } from "./defaults.ts";
import { matDirectionError, parseCallout } from "./grammar.ts";
import { EDGES, NIB_MAX, STAIR_DEFAULTS, STAIR_RULES, STEP_MAX_RISE, ZBAR_MAX_DROP, balconyRows, exampleGeometry, parseGrids } from "./geometry.ts";
import { buildPanel } from "./panel.ts";
import { buildPit } from "./pit.ts";
import { buildCage } from "./cage.ts";
import { MESH, MESH_LAP, layMesh, meshMarks, meshSummary } from "./mesh.ts";

// ---------- model builder ----------
function buildModel(cfg) {
  if (cfg && cfg.kind === "panel") return buildPanel(cfg);   // a precast panel (#33) has its own builder with the same model shape
  if (cfg && cfg.kind === "pit") return buildPit(cfg);       // a pit (#43h): base, walls, a ramp, internal walls
  if (cfg && cfg.kind === "cage") return buildCage(cfg);     // a footing cage (#44): cogged bars top and bottom, ligs, ties
  cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
  cfg.features = Object.assign({}, DEFAULT_CFG.features, cfg.features || {});
  const F = cfg.features, errors = [], warnings = [];
  const T = +cfg.thickness, C = +cfg.cover, FC = +cfg.fc;
  const LAPLEN = +cfg.lap;
  // Laps (#5): the project's flat lap is the default; a lap table typed from the general notes (cfg.lapTable) is used
  // where it has a row for the case / size / f'c; the AS 3600 value is computed beside every lap in use and a shorter
  // lap is flagged (DECISIONS.md 2026-11-04: engineer's table, flag differences; computed laps round up to 50).
  const TABLE = parseLapTable(cfg.lapTable);
  TABLE.errors.forEach(e => errors.push(e));
  const LAPS = { source: TABLE.empty ? "flat" : "table", flat: LAPLEN, table: TABLE.empty ? null : TABLE, rows: [], missing: [] };
  if (!(FC >= 20 && FC <= 100)) errors.push("Concrete f'c must be 20–100 MPa.");
  // The lap a run of bars gets and the AS 3600 value beside it. o = { size, type, kase (LAP_CASES key), sp (centres of the
  // lapped bars, 0 = single line), cover (to the bar), below (concrete below the bar), fixed (a value the detail fixes,
  // used when the table has nothing for it), what (where it is used, for the report) }. Rows are shared by key.
  function lapUse(o) {
    const K = LAP_CASES[o.kase], type = o.type || "N";
    const calc = lapCalc({ size: o.size, type: type, fc: FC, cover: o.cover, spacing: o.sp, below: o.below, k1: K.k1, comp: K.comp });
    let len = LAPLEN, src = "flat";
    const t = LAPS.table ? lapLookup(LAPS.table, o.kase, o.size, FC) : null;
    if (t && t.missing) { const msg = "Lap table: " + K.word + " has no column for f'c " + FC + " MPa (grades " + t.fcs.join(", ") + "); add one or change f'c."; if (errors.indexOf(msg) < 0) errors.push(msg); }
    else if (t) { len = t.len; src = "table"; }
    else if (o.fixed != null) { len = o.fixed; src = "fixed"; }
    const key = [o.kase, type + o.size, o.sp | 0, o.cover, o.below > 300 ? 1 : 0, src, len].join("|");
    let row = LAPS.rows.find(r => r.key === key);
    if (!row) { row = { key: key, kase: o.kase, caseName: K.name, caseShort: K.short, size: o.size, type: type, fc: FC, sp: o.sp || 0, cover: o.cover, below: o.below, calc: calc, len: len, src: src, diff: len - calc.lap, short: len < calc.raw, lapped: 0, what: [] }; LAPS.rows.push(row); }   // lapped: bar ends that actually lap with this value
    if (o.what && row.what.indexOf(o.what) < 0) row.what.push(o.what);
    return row;
  }
  const lapSrcText = r => r.src === "table" ? "lap table" : r.src === "fixed" ? "fixed by the detail" : "project flat lap";

  // grids
  const G = parseGrids(cfg), gx = G.gx, gy = G.gy, OV = G.OV, SL = G.SL;
  if (gx.length < 2 || gy.length < 2) errors.push("Need at least two grid lines in each direction.");
  const GX = gx.map((v, i) => [String(i + 1), v]);
  const GY = gy.map((v, i) => [String.fromCharCode(65 + i), v]);
  const L = SL.x1 - SL.x0, Wd = SL.y1 - SL.y0;
  if (L < 2000 || Wd < 2000) errors.push("Slab is too small (" + fmt(L) + " × " + fmt(Wd) + "): widen the grids.");
  if (L > 60000 || Wd > 60000) errors.push("Slab is too large for one pour model (" + fmt(L) + " × " + fmt(Wd) + ").");
  if (!(T >= 120 && T <= 500)) errors.push("Slab thickness must be 120–500 mm.");
  if (!(C >= 15 && C <= 75)) errors.push("Cover must be 15–75 mm.");
  if (!(LAPLEN >= 300 && LAPLEN <= 2500)) errors.push("Lap must be 300–2500 mm.");

  // mats from callouts: bar mats by layer (A–D), or a mesh for a whole face (#6): "SL82 T E-W" is both top layers
  const mats = {}, parsed = [], named = {};   // named: layers a callout line names, even when that line is rejected
  const meshes = {};                           // T / B → { code, spec, dir (X / Y: the long wires), line, layers }
  const MESH_FACE = { T: ["C", "D"], B: ["A", "B"] }, faceOf = l => l < "C" ? "B" : "T", faceWord = f => f === "T" ? "top" : "bottom";
  const meshCovers = l => !!meshes[faceOf(l)];
  // A mesh callout: position T or B (a sheet is both layers of that face; T&B lays one each), long wires E-W or N-S
  // stated (DECISIONS.md layer direction: nothing is assumed), a sheet mesh from the catalogue (trench mesh is for
  // footings), one mesh per face, and not on a face that already has a bar mat.
  function meshLine(p, where) {
    const pos = p.position === "TB" ? ["T", "B"] : p.position === "T" || p.position === "B" ? [p.position] : null;
    if (pos) pos.forEach(f => MESH_FACE[f].forEach(l => { named[l] = true; }));
    if (/TM$/.test(p.type)) { errors.push(where + p.mesh + " is trench mesh, for footings; a slab mesh is SL or RL."); return; }
    if (!MESH[p.mesh]) { errors.push(where + p.mesh + " is not a sheet mesh in the catalogue here (SL62–SL102, SL81, RL718–RL1218)."); return; }
    if (p.count && p.count !== 1) { errors.push(where + "give each mesh its own line with its position, T or B."); return; }
    if (!pos) { errors.push(where + "say where the mesh goes: T (top) or B (bottom); one sheet is both layers of that face."); return; }
    const d = p.direction;
    if (d !== "X" && d !== "Y") {
      if (!d) errors.push(where + "say which way the mesh's long wires run: E-W or N-S (no direction is assumed).");
      else if (d === "EW") errors.push(where + "a sheet is already each way; say which way its long wires run, E-W or N-S.");
      else errors.push(where + ({ H: "horizontal", V: "vertical", LONG: "longitudinal", TRANS: "transverse" }[d] || d) + " is a wall or beam direction; a slab mesh's long wires run E-W or N-S.");
      return;
    }
    pos.forEach(f => {
      if (meshes[f]) { errors.push(where + "the " + faceWord(f) + " already has " + meshes[f].code + " on line " + meshes[f].line + "; one mesh per face."); return; }
      const bar = MESH_FACE[f].map(l => mats[l]).find(Boolean);
      if (bar) { errors.push(where + "layer " + bar.layer + " is a bar mat on line " + bar.line + "; the " + faceWord(f) + " is either mesh or bars."); return; }
      meshes[f] = { code: p.mesh, spec: MESH[p.mesh], dir: d, line: p.line, face: f, layers: MESH_FACE[f] };
    });
  }
  String(cfg.callouts || "").split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const p = parseCallout(line, { scheme: cfg.scheme || "ABCD" }); p.line = i + 1; parsed.push(p);
    const where = "Line " + (i + 1) + " (" + line.trim() + "): ";
    if (p.layer && MAT_LAYERS.indexOf(p.layer) >= 0) named[p.layer] = true;
    if (p.error) { errors.push(where + p.error + "."); return; }
    if (p.kind === "thickness") { warnings.push(where + "slab thickness is set in its own field; line ignored."); return; }
    if (p.kind === "mesh") { meshLine(p, where); return; }
    if (p.role) { warnings.push(where + "additional/" + p.role + " bars are not read from callouts yet; the example extras are controlled by the Extra bars toggle."); return; }
    if (!p.layer || MAT_LAYERS.indexOf(p.layer) < 0) { errors.push(where + "say which layer this mat is: A, B, C or D."); return; }
    if (!p.spacing) { errors.push(where + "no spacing found (write N12-200 or N12 @ 200)."); return; }
    if (p.type !== "N") { errors.push(where + "mats must be N (D500N) bars."); return; }
    // Direction must be stated (DECISIONS.md 2026-11-04, backlog #21): no guessed default, no "each way" for one layer.
    const dirErr = matDirectionError(p.direction);
    if (dirErr) { errors.push(where + dirErr); return; }
    if (mats[p.layer]) { errors.push(where + "layer " + p.layer + " is already defined on line " + mats[p.layer].line + "."); return; }
    if (meshCovers(p.layer)) { errors.push(where + "the " + faceWord(faceOf(p.layer)) + " is " + meshes[faceOf(p.layer)].code + " mesh on line " + meshes[faceOf(p.layer)].line + "; layer " + p.layer + " is in that sheet."); return; }
    if (p.spacing < p.size * 2 + 20) { errors.push(where + "spacing " + p.spacing + " is too tight for N" + p.size + "."); return; }
    if (p.spacing > 600) { warnings.push(where + "spacing over 600 exceeds the usual slab maximum (2D or 300 whichever is less)."); }
    mats[p.layer] = { layer: p.layer, size: p.size, sp: p.spacing, dirIn: p.direction, line: i + 1, count: p.count };
  });
  MAT_LAYERS.forEach(l => { if (!mats[l] && !named[l]) warnings.push("No mat for layer " + l + "; it is left out of this model."); });   // a rejected line already has its error
  // layer bar sizes for the stack: a mesh face puts its long wires outside (A / D) and its cross wires inside (B / C)
  const dA = mats.A ? mats.A.size : meshes.B ? meshes.B.spec.dl : 16, dB = mats.B ? mats.B.size : meshes.B ? meshes.B.spec.dc : 12;
  const dD = mats.D ? mats.D.size : meshes.T ? meshes.T.spec.dl : 12, dC = mats.C ? mats.C.size : meshes.T ? meshes.T.spec.dc : 12;
  const hasMat = l => !!mats[l] || meshCovers(l);   // a layer with steel to tie trimmers and extras to
  const Z = { A: C + dA / 2, B: C + dA + dB / 2, D: T - C - dD / 2, C: T - C - dD - dC / 2 };
  if (Z.C - dC / 2 - (Z.B + dB / 2) < 40) errors.push("Slab too thin for this mat stack: top and bottom mats would clash.");
  const COGZ = Z.B + dB / 2 + 4;            // top-bar cogs turn down to just above the bottom mat
  const zEdgeT = Z.C - dC / 2 - 6, zEdgeB = Z.B + dB / 2 + 12, zChairTop = Z.C - dC / 2;
  // where a trimmer / additional / extra bar sits in a layer: between the mat bars at the layer's level, or, on a mesh
  // face, tied just inside the mesh (under the top sheet's edge bars, over the bottom sheet's; the face's inner layer
  // first, its outer layer one bar further in) so it never shares a plane with a wire or with the other layer's bars
  const zTied = (l, size) => !meshCovers(l) ? Z[l] : l < "C" ? zEdgeB + 6 + size / 2 + (l === "A" ? 0 : size + 2) : zEdgeT - 6 - size / 2 - (l === "C" ? 0 : size + 2);
  MAT_LAYERS.forEach(l => { const m = mats[l]; if (!m) return; m.top = l === "C" || l === "D"; m.z = Z[l]; m.dir = m.dirIn; });   // dirIn is X or Y here; anything else was rejected above
  if (mats.A && mats.B && mats.A.dir === mats.B.dir) warnings.push("Layers A and B run the same way; a bottom mat normally crosses (A E-W, B N-S).");
  if (mats.C && mats.D && mats.C.dir === mats.D.dir) warnings.push("Layers C and D run the same way; a top mat normally crosses.");
  // each mat's lap (#5): slab case; the cover to the bar is the slab cover for the outer layers A and D and the cover
  // plus the outer bar for the inner layers B and C; k1 from the concrete below the bar (1.3 over 300, Cl 13.1.2.2)
  const MATLAP = {};
  MAT_LAYERS.forEach(l => { const m = mats[l]; if (!m) return; m.lap = MATLAP[l] = lapUse({ size: m.size, kase: "slab", sp: m.sp, cover: C + (l === "B" ? dA : l === "C" ? dD : 0), below: m.z - m.size / 2, what: "layer " + l }); });
  const matLaps = Object.keys(MATLAP).map(l => MATLAP[l].len), LAPMAX = matLaps.length ? Math.max(...matLaps) : LAPLEN;   // the longest mat lap sizes the Z-bar and L-bar room checks below

  // geometry features derived from the grids (clipped to the slab)
  const inside = r => r.x0 >= SL.x0 + 300 && r.x1 <= SL.x1 - 300 && r.y0 >= SL.y0 + 300 && r.y1 <= SL.y1 - 300 && r.x1 - r.x0 > 300 && r.y1 - r.y0 > 300;
  const overlaps = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
  const nX = gx.length, nY = gy.length;
  const BEAMS = [];
  if (F.beams) {
    if (nX >= 3) BEAMS.push({ id: "IB1", dir: "Y", at: gx[1], a: SL.y0, b: SL.y1, w: 400, D: 600, bot: [20, 3], top: [16, 3], lig: [12, 200, "N"], tagS: 0.22 });
    BEAMS.push({ id: "EB1", dir: "X", at: gy[0] - 50, a: SL.x0, b: SL.x1, w: 400, D: 500, bot: [16, 2], top: [16, 2], lig: [10, 300, "R"], tagS: 0.55 });
    BEAMS.push({ id: "EB1", dir: "Y", at: gx[0] - 50, a: SL.y0, b: SL.y1, w: 400, D: 500, bot: [16, 2], top: [16, 2], lig: [10, 300, "R"], tagS: 0.62 });
  }
  const inBeam = (x, y) => BEAMS.filter(bm => bm.dir === "X" ? (Math.abs(y - bm.at) <= bm.w / 2 && x >= bm.a && x <= bm.b) : (Math.abs(x - bm.at) <= bm.w / 2 && y >= bm.a && y <= bm.b));
  const beamRect = bm => bm.dir === "X" ? { x0: bm.a, x1: bm.b, y0: bm.at - bm.w / 2, y1: bm.at + bm.w / 2 } : { x0: bm.at - bm.w / 2, x1: bm.at + bm.w / 2, y0: bm.a, y1: bm.b };
  const clearOfBeams = r => !BEAMS.some(bm => overlaps(r, beamRect(bm)));
  // geometry rows (#7a, #7b): from cfg.openings / cfg.balcony / cfg.setdowns / cfg.step when given (a job: a bad row is
  // an error and that row is left out while the rest builds, as for a bad callout line), else the grid-derived
  // example (a misfit is only a warning). Order matters: the step first, set-downs are checked against it, openings
  // against both, the balcony against the step.
  const EX = exampleGeometry(cfg);
  const explicitO = Array.isArray(cfg.openings), balcRows = balconyRows(cfg), explicitB = !!balcRows;
  const explicitD = Array.isArray(cfg.setdowns), explicitS = !!cfg.step && typeof cfg.step === "object";
  const grow = (r, m) => ({ x0: r.x0 - m, x1: r.x1 + m, y0: r.y0 - m, y1: r.y1 + m });
  const numv = v => (v === "" || v == null || typeof v === "boolean") ? NaN : Number(v);   // a blank field is not 0
  const beamOn = r => { const bm = BEAMS.find(b => overlaps(r, beamRect(b))); return bm ? bm.id : null; };
  // ---- step: the slab NE of (x0, y0) raised by rise on a nib; L-bars (lap leg + vertical leg) lap each mat on both sides ----
  let STEP = null;
  if (F.step) {
    const s = explicitS ? cfg.step : EX.step;
    const say = msg => explicitS ? errors.push("Step: " + msg) : warnings.push("Example step left out: " + msg);
    const v = [s.x0, s.y0, s.rise, s.nib].map(numv);
    // the L-bars reach lap + cover + 64 from the step line on each side, so the step line keeps that (at least 1,000) from every slab edge
    const minBay = Math.max(1000, LAPMAX + 2 * C + 100), nibMin = 2 * C + 100;   // nib holds both vertical legs (at C + 40 and C + 64) with cover to its far face
    if (v.some(n => !isFinite(n))) say("from x, from y, rise and nib must all be numbers.");
    else if (!(v[2] > ZBAR_MAX_DROP)) say("a rise of " + ZBAR_MAX_DROP + " or less is a shallow set-down (Z-bars), not a step; enter it as a set-down.");
    else if (v[2] > STEP_MAX_RISE) say("rise must be at most " + STEP_MAX_RISE + "; a taller change of level is a wall, not a slab step.");
    else if (!(v[3] >= nibMin && v[3] <= NIB_MAX)) say("nib must be " + nibMin + "–" + NIB_MAX + " (2 × cover + 100 holds the L-bar legs).");
    else if (!(v[0] >= SL.x0 + minBay && v[0] <= SL.x1 - minBay && v[1] >= SL.y0 + minBay && v[1] <= SL.y1 - minBay)) say("the step line must be at least " + fmt(minBay) + " from every slab edge so the L-bars fit (x " + fmt(SL.x0 + minBay) + " to " + fmt(SL.x1 - minBay) + ", y " + fmt(SL.y0 + minBay) + " to " + fmt(SL.y1 - minBay) + ").");
    else {
      const st = { x0: v[0], y0: v[1], x1: SL.x1, y1: SL.y1, rise: v[2], nib: v[3], kind: "step" };
      const onBeam = beamOn({ x0: st.x0, x1: st.x0 + st.nib, y0: st.y0, y1: SL.y1 }) || beamOn({ x0: st.x0, x1: SL.x1, y0: st.y0, y1: st.y0 + st.nib });
      if (onBeam) say("its nib sits on beam " + onBeam + "; the model cannot step a slab along a beam yet."); else STEP = st;
    }
  }
  // ---- set-downs: shallow drops of the whole slab, Z-bar splices (crank 1:6, ≥ 300, SRIA TN5) across every edge in every mat ----
  const DROPS = [];
  const zReach = d => LAPMAX + Math.max(300, 6 * d) / 2;   // how far a Z-bar reaches from the set-down edge: the longest mat lap + half the crank
  if (F.drop) {
    (explicitD ? cfg.setdowns : EX.setdowns).forEach((o, i) => {
      const name = String(o && o.name != null ? o.name : "").trim().toUpperCase().slice(0, 24) || "SET-DOWN " + (i + 1);
      const say = msg => explicitD ? errors.push("Set-down " + (i + 1) + " (" + name + "): " + msg) : warnings.push("Example set-down " + name.toLowerCase() + " left out: " + msg);
      const v = [o.x0, o.y0, o.x1, o.y1, o.depth].map(numv);
      if (v.some(n => !isFinite(n))) return say("x0, y0, x1, y1 and depth must all be numbers, mm from grid 1 / grid A.");
      const dd = { id: name, row: i, x0: Math.min(v[0], v[2]), x1: Math.max(v[0], v[2]), y0: Math.min(v[1], v[3]), y1: Math.max(v[1], v[3]), d: v[4], kind: "drop" };
      if (!(dd.d >= 10 && dd.d <= ZBAR_MAX_DROP)) return say("depth must be 10–" + ZBAR_MAX_DROP + "; a deeper change of level is a step (L-bars on a nib), enter it as the step.");
      const reach = zReach(dd.d), minSide = 2 * reach + 100, edge = Math.max(300, Math.ceil((reach + C) / 10) * 10);
      if (dd.x1 - dd.x0 < minSide || dd.y1 - dd.y0 < minSide) return say("too small for Z-bar splices from both edges (lap " + LAPMAX + " + half a " + Math.max(300, 6 * dd.d) + " crank each); make each side at least " + fmt(minSide) + ".");
      if (!(dd.x0 >= SL.x0 + edge && dd.x1 <= SL.x1 - edge && dd.y0 >= SL.y0 + edge && dd.y1 <= SL.y1 - edge)) return say("must sit at least " + fmt(edge) + " inside the slab edges so the Z-bars fit (slab " + fmt(SL.x0) + " to " + fmt(SL.x1) + " E–W, " + fmt(SL.y0) + " to " + fmt(SL.y1) + " N–S).");
      const bm = beamOn(dd); if (bm) return say("sits on beam " + bm + ".");
      if (STEP && overlaps(dd, STEP)) return say("overlaps the step.");
      const near = DROPS.find(q => overlaps(grow(dd, reach + zReach(q.d)), q)); if (near) return say("too close to " + near.id + "; the Z-bar splices of both would overlap (keep " + fmt(reach + zReach(near.d)) + " clear).");
      DROPS.push(dd);
    });
  }
  const HOLES = [];
  if (F.openings) {
    (explicitO ? cfg.openings : EX.openings).forEach((o, i) => {
      const name = String(o && o.name != null ? o.name : "").trim().toUpperCase().slice(0, 24) || "OPENING " + (i + 1);
      const say = msg => explicitO ? errors.push("Opening " + (i + 1) + " (" + name + "): " + msg) : warnings.push("Example opening " + name.toLowerCase() + " left out: " + msg);
      const v = [o.x0, o.y0, o.x1, o.y1].map(numv);
      if (v.some(n => !isFinite(n))) return say("x0, y0, x1 and y1 must all be numbers, mm from grid 1 / grid A.");
      const h = { id: name, row: i, x0: Math.min(v[0], v[2]), x1: Math.max(v[0], v[2]), y0: Math.min(v[1], v[3]), y1: Math.max(v[1], v[3]) };
      if (h.x1 - h.x0 < 300 || h.y1 - h.y0 < 300) return say("too small to trim; make each side at least 300.");
      if (!inside(h)) return say("must sit at least 300 inside the slab edges (slab " + fmt(SL.x0) + " to " + fmt(SL.x1) + " E–W, " + fmt(SL.y0) + " to " + fmt(SL.y1) + " N–S).");
      const bm = BEAMS.find(b => overlaps(h, beamRect(b))); if (bm) return say("sits on beam " + bm.id + ".");
      if (STEP && overlaps(h, STEP)) return say("overlaps the step.");
      const dd = DROPS.find(q => overlaps(h, q)); if (dd) return say("overlaps set-down " + dd.id + ".");
      const near = HOLES.find(q => overlaps(grow(h, 300), q)); if (near) return say("too close to " + near.id + "; keep 300 between openings so the trimmers fit.");
      // small openings (under 1,000 N–S) carry their size in the note, placed just south of the hole
      h.small = h.y1 - h.y0 < 1000; h.label = h.small ? name + " " + fmt(h.x1 - h.x0) + " × " + fmt(h.y1 - h.y0) : name;
      HOLES.push(h);
    });
  }
  // ---- balconies (#7a, #7c): cantilevers off any slab edge, a list. Each carries its plan rect plus an edge frame:
  // along (the axis the edge runs on), sg (out from the slab), a0 / a1 (its extent along the edge), root (the slab
  // edge line) and tip (its free edge), so the bar code below is written once for all four edges. ----
  const BALCS = [];
  if (F.balcony) {
    (explicitB ? balcRows : EX.balconies).forEach((o, i) => {
      const name = String(o && o.name != null ? o.name : "").trim().toUpperCase().slice(0, 24) || "BALCONY " + (i + 1);
      const say = msg => explicitB ? errors.push("Balcony " + (i + 1) + " (" + name + "): " + msg) : warnings.push("Example balcony left out: " + msg);
      const edge = String(o && o.edge != null ? o.edge : "N").trim().toUpperCase().slice(0, 1), E = EDGES[edge];
      if (!E) return say("edge must be N, S, E or W.");
      const v = [o.from, o.to, o.proj, o.thk, o.down].map(numv);
      if (v.some(n => !isFinite(n))) return say("from, to, projection, thickness and set-down must all be numbers.");
      const a0 = Math.min(v[0], v[1]), a1 = Math.max(v[0], v[1]), proj = v[2], thk = v[3], down = v[4];
      const alongX = E.along === "X", e0 = alongX ? SL.x0 : SL.y0, e1 = alongX ? SL.x1 : SL.y1;
      if (a1 - a0 < 1500) return say("too narrow; a balcony needs at least 1,500 along the slab edge.");
      if (a0 < e0 || a1 > e1) return say("must sit on the slab's " + E.name + " edge, between " + fmt(e0) + " and " + fmt(e1) + (alongX ? " (x, from grid 1)." : " (y, from grid A)."));
      if (!(proj >= 500 && proj <= 4000)) return say("projection must be 500–4,000.");
      if (!(thk >= 2 * C + 40 && thk <= 500)) return say("thickness must be at least 2 × cover + 40 (" + (2 * C + 40) + ") and at most 500.");
      if (!(down >= 0 && down <= T - 100)) return say("set-down must be 0–" + (T - 100) + " (slab thickness less 100).");
      // the raised step reaches the north edge east of its corner and the east edge north of it; a balcony there would
      // have to tie into the raised slab, which the model does not do
      if (STEP && edge === "N" && a1 > STEP.x0) return say("runs along the step; keep it west of x " + fmt(STEP.x0) + " (the step line).");
      if (STEP && edge === "E" && a1 > STEP.y0) return say("runs along the step; keep it south of y " + fmt(STEP.y0) + " (the step line).");
      const root = alongX ? (edge === "N" ? SL.y1 : SL.y0) : (edge === "E" ? SL.x1 : SL.x0), tip = root + E.sg * proj;
      const r = alongX ? { x0: a0, x1: a1, y0: Math.min(root, tip), y1: Math.max(root, tip) } : { x0: Math.min(root, tip), x1: Math.max(root, tip), y0: a0, y1: a1 };
      // 300 between balconies (same edge, or meeting at a corner) so each one's side cogs and edge bars fit
      const near = BALCS.find(q => overlaps(grow(r, 299), q)); if (near) return say("too close to " + near.id + "; keep 300 between balconies so the side cogs and edge bars fit.");
      BALCS.push(Object.assign(r, { id: name, row: i, edge: edge, along: E.along, sg: E.sg, a0: a0, a1: a1, root: root, tip: tip, top: T - down, bot: T - down - thk, proj: proj, thk: thk, down: down, kind: "balc" }));
    });
    // one balcony with the default name is just "BALCONY" on tags and notes; several (or a named one) carry their names
    BALCS.forEach(b => {
      b.plain = BALCS.length === 1 && /^BALCONY( \d+)?$/.test(b.id);
      b.label = (b.plain ? "BALCONY" : b.id) + " " + b.thk + " THK" + (b.down ? " · SET DOWN " + b.down : "");
      const mid = (b.a0 + b.a1) / 2, inTip = b.tip - b.sg * 500;   // note / annotation point: centred along, 500 in from the free edge
      b.note = b.along === "X" ? [mid, inTip] : [inTip, mid];
    });
  }
  // ---- stair flight (#8): one straight flight rising from the floor below to this slab, its top riser at one edge of a
  // stair void (the slab beyond that edge is the top landing). Written in the flight's frame: s = plan distance from
  // the arrival edge measured down the flight (the flight runs through the void, then on under the slab), c = the
  // plan coordinate across it, z as everywhere. Riser k (0 = the slab edge) stands at s = k·G; the throat line
  // joins the riser feet, the soffit lies the waist below it, and the steel is set off those two lines:
  //   z_line(d, s) = T − R − s·R/G − d·L/G   (d = perpendicular offset below the throat; L = √(G² + R²), L/G = 1/cos θ)
  // The flight is the pour after the slab: its concrete fills against the slab's edge face and the wedge under the
  // slab soffit back to where its own soffit meets it. ----
  let STAIR = null;
  const stairIn = explicitStair => explicitStair ? cfg.stair : EX.stair;
  const explicitStair = !!cfg.stair && typeof cfg.stair === "object";
  if (F.stair && F.openings && (HOLES.length || explicitStair)) {
    const o = Object.assign({}, STAIR_DEFAULTS, stairIn(explicitStair)), SR = STAIR_RULES;
    const say = msg => explicitStair ? errors.push("Stair: " + msg) : warnings.push("Example stair left out: " + msg);
    const vname = String(o.void == null ? "" : o.void).trim().toUpperCase(), h = HOLES.find(q => q.id === vname);
    const arrive = String(o.arrive == null ? "" : o.arrive).trim().toUpperCase().slice(0, 1), E = EDGES[arrive];
    const v = [o.rise, o.going, o.waist].map(numv), nIn = o.risers === "" || o.risers == null ? null : numv(o.risers), wIn = o.width === "" || o.width == null ? null : numv(o.width);
    const main = parseCallout(String(o.main || ""), { scheme: "ABCD" }), dist = parseCallout(String(o.dist || ""), { scheme: "ABCD" }), top = parseCallout(String(o.top || ""), { scheme: "ABCD" });
    const barOk = p => !p.error && p.kind === "bar" && p.type === "N" && p.size && p.spacing;
    if (!h) say("no opening named " + (vname || "(blank)") + "; the flight needs a stair void to arrive in (" + HOLES.map(q => q.id).join(", ") + ").");
    else if (!E) say("arrival edge must be N, S, E or W (the void edge the top riser stands at).");
    else if (v.some(n => !isFinite(n))) say("floor-to-floor rise, going and waist must all be numbers.");
    else if (!(v[0] >= 1500 && v[0] <= 6000)) say("floor-to-floor rise must be 1,500–6,000 (top of the floor below to top of this slab).");
    else if (!(v[1] >= SR.goingMin && v[1] <= SR.goingMax)) say("going must be " + SR.goingMin + "–" + SR.goingMax + " (NCC D3D14, public stair).");
    else if (!(v[2] >= SR.waistMin && v[2] <= SR.waistMax)) say("waist must be " + SR.waistMin + "–" + SR.waistMax + ".");
    else if (nIn != null && !(Number.isInteger(nIn) && nIn >= 2 && nIn <= SR.risersMax)) say("risers must be a whole number, 2–" + SR.risersMax + " in one flight (NCC D3D14); leave it blank for the fewest risers.");
    else if (!barOk(main) || !barOk(dist) || !barOk(top)) say("main, distribution and top bars must each be an N bar with a spacing (N16-200).");
    else {
      const rise = v[0], G = v[1], waist = v[2];
      const n = nIn != null ? nIn : Math.ceil(rise / SR.riserMax), R = rise / n;
      const alongX = E.along === "Y", edge = alongX ? (arrive === "E" ? h.x1 : h.x0) : (arrive === "N" ? h.y1 : h.y0), sg = -E.sg;   // the flight descends away from the landing, back across the void
      const c0 = alongX ? h.y0 : h.x0, c1 = alongX ? h.y1 : h.x1, cc = (c0 + c1) / 2, voidLen = alongX ? h.x1 - h.x0 : h.y1 - h.y0;
      const w = wIn != null ? wIn : c1 - c0;
      const L = Math.hypot(G, R), run = (n - 1) * G, zLo = T - rise;
      const zLine = (d, s) => T - R - s * R / G - d * L / G, sAt = (d, z) => (T - R - d * L / G - z) * G / R;   // s where the line d reaches z
      const sFoot = sAt(waist, zLo);           // where the soffit meets the floor below (short of the bottom riser by waist / sin θ)
      const sWedge = sAt(waist, 0);            // where the soffit meets this slab's soffit (negative: under the slab, past the arrival edge)
      const a0 = Math.min(edge, edge + sg * run), a1 = Math.max(edge, edge + sg * run);
      const foot = alongX ? { x0: a0, x1: a1, y0: cc - w / 2, y1: cc + w / 2 } : { x0: cc - w / 2, x1: cc + w / 2, y0: a0, y1: a1 };   // plan footprint, top riser to bottom riser
      const colsHit = F.columns ? gx.map(x => gy.map(y => ({ x: x, y: y, name: GX[gx.indexOf(x)][0] + "/" + GY[gy.indexOf(y)][0] }))).flat().filter(c => overlaps(foot, { x0: c.x - 200, x1: c.x + 200, y0: c.y - 200, y1: c.y + 200 })) : [];
      const bm = beamOn(foot);
      if (!(R >= SR.riserMin - 1e-9 && R <= SR.riserMax + 1e-9)) say("riser " + Math.round(R * 10) / 10 + " (" + fmt(rise) + " over " + n + " risers) is outside " + SR.riserMin + "–" + SR.riserMax + " (NCC D3D14); change the riser count or the rise.");
      else if (!(2 * G + R >= SR.twoGRMin - 1e-9 && 2 * G + R <= SR.twoGRMax + 1e-9)) say("2 × going + riser = " + Math.round(2 * G + R) + " is outside " + SR.twoGRMin + "–" + SR.twoGRMax + " (NCC D3D14); change the going.");
      else if (!(w >= SR.widthMin && w <= c1 - c0)) say("flight width must be " + SR.widthMin + "–" + fmt(c1 - c0) + " (the void is " + fmt(c1 - c0) + " across).");
      else if (sFoot < 300) say("waist " + waist + " is too thick for a flight this short: the soffit would meet the floor below " + fmt(sFoot) + " down the flight.");
      else if (!(foot.x0 >= SL.x0 && foot.x1 <= SL.x1 && foot.y0 >= SL.y0 && foot.y1 <= SL.y1)) say("the flight runs " + fmt(run) + " from the " + E.name + " edge of " + h.id + " and leaves the slab plan (" + (alongX ? "x " : "y ") + fmt(edge + sg * run) + "); arrive at the other edge, add risers or shorten the going.");
      else if (colsHit.length) say("the flight runs into column " + colsHit.map(c => c.name).join(", ") + " under the slab.");
      else if (bm) say("the flight passes under beam " + bm + "; the model cannot detail a flight through a beam line.");
      else {
        const headroom = run > voidLen ? Math.round(voidLen * R / G - T) : null;   // under the slab at the void's far edge: the nosing line's drop less the slab thickness
        STAIR = { void: h.id, hole: h, arrive: arrive, along: E.along, alongX: alongX, sg: sg, edge: edge, cc: cc, w: w, c0: cc - w / 2, c1: cc + w / 2, n: n, R: R, G: G, L: L, rise: rise, run: run, waist: waist, zLo: zLo,
          sFoot: sFoot, sWedge: sWedge, voidLen: voidLen, headroom: headroom, foot: foot, under: run > voidLen ? (alongX ? { x0: Math.min(edge + sg * voidLen, edge + sg * run), x1: Math.max(edge + sg * voidLen, edge + sg * run), y0: foot.y0, y1: foot.y1 } : { x0: foot.x0, x1: foot.x1, y0: Math.min(edge + sg * voidLen, edge + sg * run), y1: Math.max(edge + sg * voidLen, edge + sg * run) }) : null,
          main: main, dist: dist, top: top, topLeg: Math.max(300, numv(o.topLeg) || STAIR_DEFAULTS.topLeg), zLine: zLine, sAt: sAt, kind: "stair" };
        // the plan point for an along / across pair and the section polygon (s, z) the viewer extrudes across the width
        STAIR.P = (s, c, z) => alongX ? [edge + sg * s, c, z] : [c, edge + sg * s, z];
        const poly = [[0, T - R]];
        for (let k = 1; k < n; k++) poly.push([k * G, T - k * R], [k * G, T - (k + 1) * R]);
        poly.push([sFoot, zLo]);
        if (sWedge < 0) poly.push([sWedge, 0], [0, 0]); else poly.push([0, zLine(waist, 0)]);
        STAIR.poly = poly;
        STAIR.label = "STAIR " + n + "R × " + Math.round(R) + " · " + (n - 1) + "G × " + G + " · WAIST " + waist + " · UP " + ({ E: "E", W: "W", N: "N", S: "S" })[arrive];
        STAIR.text = n + " risers × " + (Math.round(R * 10) / 10) + ", " + (n - 1) + " goings × " + G + ", waist " + waist + ", " + fmt(w) + " wide, up " + fmt(rise) + " to the " + E.name + " edge of " + h.id;
        if (headroom != null && headroom < SR.headroom) warnings.push("Stair: headroom under the slab at the " + (alongX ? (sg > 0 ? "east" : "west") : (sg > 0 ? "north" : "south")) + " edge of " + h.id + " is " + fmt(headroom) + ", less than the 2,000 the NCC asks for above the nosing line (D3D14); the flight runs " + fmt(run - voidLen) + " on under the slab. Lengthen the void or check with the engineer.");
        if (w < 1000) warnings.push("Stair: the flight is " + fmt(w) + " wide; a required exit stair is usually at least 1,000 clear (NCC Volume One exit-width rules; check for this building).");
        if (stairIn(explicitStair) === EX.stair) warnings.push("Stair: the example's floor-to-floor rise (" + fmt(rise) + "), waist, bar sizes and leg lengths are placeholders, not an engineer's detail.");
      }
    }
  }
  // plan extents of the pour: the slab plus its balconies (grids, bubbles, dimension strings and the sheet frame it)
  const EXT = { x0: Math.min(SL.x0, ...BALCS.map(b => b.x0)), x1: Math.max(SL.x1, ...BALCS.map(b => b.x1)), y0: Math.min(SL.y0, ...BALCS.map(b => b.y0)), y1: Math.max(SL.y1, ...BALCS.map(b => b.y1)) };
  const COLB = STAIR ? Math.min(-1500, STAIR.zLo - T) : -1500, COL = 400;   // with a stair the columns below reach the floor below
  // starter projection = the lap with the column bars above (#5): the example's 950 unless the lap table has a COLUMN
  // row for N24 (compression lap, Cl 13.2.4; the AS 3600 value is computed beside it either way)
  const STLAP = F.columns ? lapUse({ size: 24, kase: "column", sp: 0, cover: C, below: 0, fixed: 950, what: "column starters" }) : null, PROJ = STLAP ? STLAP.len : 950;
  const lvl = (x, y) => { if (STEP && x > STEP.x0 && y > STEP.y0) return STEP.rise; for (let i = 0; i < DROPS.length; i++) { const dd = DROPS[i]; if (x > dd.x0 && x < dd.x1 && y > dd.y0 && y < dd.y1) return -dd.d; } return 0; };
  const COLS = [];
  if (F.columns) GX.forEach(g1 => GY.forEach(g2 => COLS.push({ x: g1[1], y: g2[1], name: g1[0] + "/" + g2[0] })));
  COLS.forEach(c => { const bms = inBeam(c.x, c.y); c.top = bms.length ? Math.min(...bms.map(b => T - b.D)) : lvl(c.x - 1, c.y - 1); c.off = lvl(c.x - 1, c.y - 1); });

  // ---------- bar generation ----------
  const bars = [], runs = [], chairs = [];
  const polyLen = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]) : 0, 0);
  function addRun(r) { r.id = "R" + runs.length; r.bars = []; runs.push(r); return r; }
  let cogFlagged = 0;
  function addBar(run, o) {
    const b = Object.assign({ id: bars.length, layer: run.layer, run: run, size: run.size, type: run.type || "N", shape: "straight" }, o);
    b.geom = bendGeom(b.type, b.size, b.lig || b.tie ? "fitment" : "main");
    b.geomLen = Math.round(polyLen(b.pts));
    b.len = Math.ceil(cutLength(b.pts, b.geom, b.hookEnds || 0) / 5) * 5;   // scheduled cut length, rounded up to 5 mm
    b.kg = b.len / 1000 * (KGM[b.type + b.size] || 0);
    const c = classify(b, b.geom);
    b.code = c.code; b.shapeName = c.name; b.dims = c.dims; b.dimStr = c.dimStr; b.flags = c.flags;
    if (c.flags.length && !b.existing) cogFlagged++;
    b.grid = gridSetout(b, GX, GY, run.lap ? run.lap.len : 0);
    if (run.lap && !b.existing && (b.lapPrev || b.lapNext || run.kind === "z" || run.kind === "l" || run.kind === "start")) run.lap.lapped++;
    bars.push(b); run.bars.push(b); return b;
  }
  // r.grid for a run of parallel bar lines: first and last line from the nearest grid, plus the slab-edge distances.
  function runSetout(r, X, start, end) {
    const ref = v => X ? nearestGrid(GY, v, ["N", "S"]) : nearestGrid(GX, v, ["E", "W"]);
    r.grid = { cross: X ? "y" : "x", first: ref(start), last: ref(end), n: r.n, sp: r.sp };
  }
  // Split a bar line [a, b] into stock-length pieces with laps. exS / exE = extra steel at the start / end (a cog or hook)
  // that must also come out of the 12 m stock bar. odd = stagger (split from the far end) for alternate bars.
  function pieces(a, b, run, odd, exS, exE) {
    exS = exS || 0; exE = exE || 0;
    if (b - a + exS + exE <= STOCK) return [[a, b]];
    if (odd) return pieces(-b, -a, run, false, exE, exS).map(p => [-p[1], -p[0]]).reverse();
    const lap = run.lap ? run.lap.len : LAPLEN, out = [];
    let s = a, first = true;
    for (;;) {
      const cap = STOCK - (first ? exS : 0);
      if (b - s + (first ? exS : 0) + exE <= STOCK) { out.push([s, b]); break; }
      let e = s + cap;
      if (e > b - lap - 300) e = b - lap - 300;    // leave a sensible last piece
      out.push([s, e]); s = e - lap; first = false;
    }
    return out;
  }
  // split a bar line [a,b] at level changes. Set-down edge (Z-type): stop C short each side. Step (L-type): the low side runs into the nib.
  // Each transition remembers its source (a set-down or the step) so the splice bars go to that feature's run.
  function intervals(X, p, a, b) {
    const at = s => X ? lvl(s, p) : lvl(p, s);
    const cands = [];
    DROPS.forEach(dd => cands.push({ t: X ? dd.x0 : dd.y0, src: dd }, { t: X ? dd.x1 : dd.y1, src: dd }));
    if (STEP) cands.push({ t: X ? STEP.x0 : STEP.y0, src: STEP });
    const cand = cands.filter(c => c.t > a && c.t < b && at(c.t - 1) !== at(c.t + 1)).sort((u, v) => u.t - v.t);
    const ivs = [], trs = []; let s0 = a;
    cand.forEach(c => {
      const t = c.t, o0 = at(t - 1), o1 = at(t + 1), big = c.src.kind === "step", up = o1 > o0;
      trs.push({ t: t, o0: o0, o1: o1, big: big, up: up, src: c.src });
      ivs.push({ s: s0, e: big && up ? t + c.src.nib - C : t - C, o: o0, fs: s0 === a, fe: false });
      s0 = big && !up ? t - c.src.nib + C : t + C;
    });
    ivs.push({ s: s0, e: b, o: at(b - 1), fs: s0 === a, fe: true });
    return { ivs: ivs, trs: trs };
  }
  function minusF(a, b, fs, fe, cuts) {
    let segs = [{ s: a, e: b, fs: fs, fe: fe }];
    cuts.forEach(c => { const out = []; segs.forEach(g => { if (c.b <= g.s || c.a >= g.e) { out.push(g); return; } if (c.a > g.s) out.push({ s: g.s, e: c.a, fs: g.fs, fe: true }); if (c.b < g.e) out.push({ s: c.b, e: g.e, fs: true, fe: g.fe }); }); segs = out; });
    return segs.filter(g => g.e - g.s > 300);
  }
  const so = (X, p) => X ? fmt(Math.abs(p - gy[0])) + (p >= gy[0] ? " N" : " S") + " of grid A" : fmt(Math.abs(p - gx[0])) + (p >= gx[0] ? " E" : " W") + " of grid 1";
  // a straight bar that follows the slab levels (stops short at a set-down, runs into the nib at a step)
  function placeLine(run, X, p, a, b, z, o) {
    const P = (sv, zz) => X ? [sv, p, zz] : [p, sv, zz];
    intervals(X, p, a, b).ivs.forEach(iv => {
      if (iv.e - iv.s < 300) return;
      const zz = z + iv.o;
      const edgeS = X ? iv.s <= SL.x0 + C + 1 : iv.s <= SL.y0 + C + 1, edgeE = X ? iv.e >= SL.x1 - C - 1 : iv.e >= SL.y1 - C - 1;
      const cogS = !!(o.cog && F.edges && iv.fs && edgeS), cogE = !!(o.cog && F.edges && iv.fe && edgeE), cogX = Math.max(0, zz - (COGZ + iv.o));
      const ps = pieces(iv.s, iv.e, run, !!o.odd, cogS ? cogX : 0, cogE ? cogX : 0);
      ps.forEach((pc, k) => {
        const pts = [P(pc[0], zz), P(pc[1], zz)]; let cogs = 0;
        if (cogS && k === 0) { pts.unshift(P(pc[0], COGZ + iv.o)); cogs++; }
        if (cogE && k === ps.length - 1) { pts.push(P(pc[1], COGZ + iv.o)); cogs++; }
        addBar(run, { pts: pts, shape: cogs === 2 ? "cogged both ends" : cogs ? "cogged one end" : "straight", lapPrev: k > 0, lapNext: k < ps.length - 1, setout: o.setout, note: (o.note || "") + (cogs ? " Cogged down at the slab edge." : "") + (iv.o ? " Placed at the " + (iv.o > 0 ? "raised step level." : "set-down level.") : "") });
      });
    });
  }

  // ---- main mats ----
  const tagAlong = { A: 0.52, B: 0.47, C: 0.41, D: 0.58 }, tagFrac = { A: 0.3, B: 0.2, C: 0.82, D: 0.72 };
  MAT_LAYERS.forEach(lid => {
    const m = mats[lid]; if (!m) return;
    const d = m.size, X = m.dir === "X", Lp = m.lap.len;
    const a0 = X ? SL.x0 + C : SL.y0 + C, a1 = X ? SL.x1 - C : SL.y1 - C;
    const q0 = X ? SL.y0 : SL.x0, q1 = X ? SL.y1 : SL.x1;
    const n = Math.floor((q1 - q0 - 2 * C - d) / m.sp) + 1;
    if (n < 2) { errors.push("Layer " + lid + ": fewer than two bar lines fit; check spacing and slab size."); return; }
    const start = q0 + (q1 - q0 - (n - 1) * m.sp) / 2;
    const run = addRun({ layer: lid, size: d, dir: m.dir, sp: m.sp, n: n, kind: "main", z: m.z,
      label: n + " N" + d + "-" + m.sp + " · " + lid, callout: "N" + d + "-" + m.sp + " LAYER " + lid + (X ? " E–W" : " N–S") + (m.top && F.edges ? ", COGGED AT FREE EDGES" : ""),
      setout: { first: start - q0, last: q1 - (start + (n - 1) * m.sp), edges: X ? ["S", "N"] : ["W", "E"] }, lap: m.lap });
    const zruns = DROPS.map(dd => addRun({ layer: lid, size: d, dir: m.dir, kind: "z", z: m.z, drop: dd, lap: m.lap, label: "Z-BARS N" + d + "-" + m.sp + " · " + lid, callout: "Z-BAR SPLICES N" + d + "-" + m.sp + " LAYER " + lid + " AT " + dd.d + " SET-DOWN (" + dd.id + "), LAP " + Lp + " EACH SIDE" }));
    const lrun = STEP ? addRun({ layer: lid, size: d, dir: m.dir, kind: "l", z: m.z, lap: m.lap, label: "L-BARS N" + d + "-" + m.sp + " · " + lid, callout: "L-BARS N" + d + "-" + m.sp + " LAYER " + lid + " EACH SIDE OF " + STEP.rise + " STEP, LEG " + Lp }) : null;
    let cur = 0;
    const P = (sv, z) => X ? [sv, cur, z] : [cur, sv, z];
    for (let i = 0; i < n; i++) {
      const p = start + i * m.sp; cur = p;
      const { ivs, trs } = intervals(X, p, a0, a1);
      const cuts = HOLES.filter(h => X ? (p > h.y0 - d / 2 && p < h.y1 + d / 2) : (p > h.x0 - d / 2 && p < h.x1 + d / 2)).map(h => ({ a: (X ? h.x0 : h.y0) - C, b: (X ? h.x1 : h.y1) + C }));
      ivs.forEach(iv => {
        const z = m.z + iv.o;
        minusF(iv.s, iv.e, iv.fs, iv.fe, cuts).forEach(g => {
          const cogX = m.top && F.edges ? m.z - COGZ : 0;
          const ps = pieces(g.s, g.e, run, i % 2 === 1, g.fs ? cogX : 0, g.fe ? cogX : 0);
          ps.forEach((pc, k) => {
            const pts = [P(pc[0], z), P(pc[1], z)]; let cogs = 0;
            if (m.top && F.edges && k === 0 && g.fs) { pts.unshift(P(pc[0], COGZ + iv.o)); cogs++; }
            if (m.top && F.edges && k === ps.length - 1 && g.fe) { pts.push(P(pc[1], COGZ + iv.o)); cogs++; }
            addBar(run, { pts: pts, shape: cogs === 2 ? "cogged both ends" : cogs === 1 ? "cogged one end" : "straight", lapPrev: k > 0, lapNext: k < ps.length - 1, line: i + 1, setout: so(X, p),
              note: (cogs ? "Top bar cogged down at a free edge or void face (L-bar end). " : "") + (iv.o < 0 ? "Set-down mat bar, " + (-iv.o) + " lower than the main mat." : iv.o > 0 ? "Raised-step mat bar, " + iv.o + " above the main slab." : (!iv.fs || !iv.fe) ? "Stops at the level change; a Z-bar or L-bars splice across." : "") });
          });
        });
      });
      trs.forEach(tr => {
        const z0 = m.z + tr.o0, z1 = m.z + tr.o1, t = tr.t;
        if (!tr.big) {
          // crank at 1:6 or flatter, crank length ≥ 300 (SRIA TN5 2025); bar sits alongside the mat bar (offset one bar + 10)
          const off = Math.abs(z1 - z0), ck = Math.max(300, 6 * off); cur = p + d + 10;
          addBar(zruns[DROPS.indexOf(tr.src)], { pts: [P(t - ck / 2 - Lp, z0), P(t - ck / 2, z0), P(t + ck / 2, z1), P(t + ck / 2 + Lp, z1)], shape: "Z-bar", setout: so(X, p) + " at " + (X ? "x " : "y ") + fmt(t), note: "Z-bar splice across the " + tr.src.d + " set-down (" + tr.src.id + "): " + Lp + " lap each side of a " + ck + " crank (1:6, SRIA TN5)." });
          cur = p;
        } else {
          cur = p + 24;
          const sg = tr.up ? 1 : -1, zLo = tr.up ? z0 : z1, zHi = tr.up ? z1 : z0;
          addBar(lrun, { pts: [P(t - sg * Lp, zLo), P(t + sg * (C + 40), zLo), P(t + sg * (C + 40), zHi)], shape: "L-bar", setout: so(X, p) + " at " + (X ? "x " : "y ") + fmt(t) + ", low side", note: "L-bar from the low slab: " + Lp + " leg lapping the low mat, vertical leg up the step nib." });
          addBar(lrun, { pts: [P(t + sg * (C + 64 + Lp), zHi), P(t + sg * (C + 64), zHi), P(t + sg * (C + 64), zLo)], shape: "L-bar", setout: so(X, p) + " at " + (X ? "x " : "y ") + fmt(t) + ", high side", note: "L-bar from the raised slab: " + Lp + " leg lapping the raised mat, vertical leg down the step nib. L-bars sit alongside the mat bars." });
          cur = p;
        }
      });
    }
    const along0 = X ? SL.x0 : SL.y0, alongL = X ? L : Wd;
    run.dist = { dir: m.dir, at: along0 + alongL * tagAlong[lid], p0: start, p1: start + (n - 1) * m.sp, z: m.z + 22, frac: tagFrac[lid] };
    runSetout(run, X, start, start + (n - 1) * m.sp);
    zruns.forEach(zrun => { const dd = zrun.drop; if (zrun.bars.length) zrun.tagPos = X ? [lid < "C" ? dd.x1 + 380 : dd.x0 - 420, (dd.y0 + dd.y1) / 2, m.z] : [(dd.x0 + dd.x1) / 2, lid < "C" ? dd.y0 - 380 : dd.y1 + 380, m.z]; else runs.splice(runs.indexOf(zrun), 1); });
    if (lrun) { if (lrun.bars.length) lrun.tagPos = X ? [STEP.x0 + 150, STEP.y0 + (lid < "C" ? 2100 : 3800), m.z + 100] : [STEP.x0 + (lid < "C" ? 2100 : 3700), STEP.y0 + 150, m.z + 100]; else runs.splice(runs.indexOf(lrun), 1); }
  });

  // ---- mesh mats (#6): a face's sheets laid over the slab inside cover (Findings 11.4), long wires outside ----
  // The bottom mesh is placed first of all (layer A's step), the top mesh right after the chairs (layer C's step); the
  // other layer of that face holds only the trimmers and extras tied to the sheet. Sheets stop cover short of every
  // opening (wires cut on site, as the bars do) and of every change of level: the main slab, each set-down and the
  // raised step are laid as separate zones at their own levels. Nothing splices the mesh across a level change (the
  // Z-bar and L-bar details are bar details); that is flagged and asked (planning doc, Questions for Baji, 2026-11-16).
  const wires = [], meshPieces = [], MSUM = [];
  const uvOf = (X, r) => X ? { u0: r.x0, u1: r.x1, v0: r.y0, v1: r.y1 } : { u0: r.y0, u1: r.y1, v0: r.x0, v1: r.x1 };
  ["B", "T"].forEach(f => {
    const ms = meshes[f]; if (!ms) return;
    const s = ms.spec, X = ms.dir === "X", top = f === "T", lid = top ? "C" : "A";
    const zL = top ? Z.D : Z.A, zC = top ? Z.C : Z.B;   // long wires at the outer layer's level, cross wires at the inner
    const dirS = X ? "E–W" : "N–S";
    const run = addRun({ layer: lid, kind: "mesh", face: f, size: s.dl, code: ms.code, dir: ms.dir, mesh: [], z: zL, label: ms.code + " " + f + " " + dirS, callout: "" });
    ms.run = run;
    const xy = (u, v) => X ? [u, v] : [v, u];
    const grown = (r, id) => Object.assign(uvOf(X, { x0: r.x0 - C, x1: r.x1 + C, y0: r.y0 - C, y1: r.y1 + C }), { id: id });
    const inset = r => ({ x0: r.x0 + C, x1: r.x1 - C, y0: r.y0 + C, y1: r.y1 - C });
    const openings = HOLES.map(h => grown(h, h.id));
    const zones = [];
    const mainHoles = openings.concat(DROPS.map(dd => grown(dd, dd.id)));
    // the low slab runs into the step nib as the bars do (to nib − cover past the step line); the raised slab starts cover past it
    if (STEP) mainHoles.push(grown({ x0: STEP.x0 + STEP.nib, x1: SL.x1 + 5000, y0: STEP.y0 + STEP.nib, y1: SL.y1 + 5000 }, "STEP"));
    zones.push({ rect: inset(SL), holes: mainHoles, dz: 0, name: "" });
    DROPS.forEach(dd => zones.push({ rect: inset(dd), holes: openings, dz: -dd.d, name: dd.id + " set-down" }));
    if (STEP) zones.push({ rect: inset({ x0: STEP.x0, y0: STEP.y0, x1: SL.x1, y1: SL.y1 }), holes: openings, dz: STEP.rise, name: "raised step" });
    let lapped = false, area = 0;
    zones.forEach(zn => {
      const uv = uvOf(X, zn.rect);
      const res = layMesh({ U0: uv.u0, U1: uv.u1, V0: uv.v0, V1: uv.v1, holes: zn.holes, spec: s, code: ms.code, layer: lid, run: run, xy: xy, zL: zL + zn.dz, zC: zC + zn.dz, made: false, C: C,
        dirShort: dirS, dirWord: X ? "east–west" : "north–south", extra: { face: f, level: zn.dz, zone: zn.name } }, { pieces: meshPieces, wires: wires });
      lapped = lapped || res.lapped; area += res.area;
      res.list.forEach(pc => {
        pc.pos = "SW corner " + nearestGrid(GX, pc.x0, ["E", "W"]).text + ", " + nearestGrid(GY, pc.y0, ["N", "S"]).text + (zn.dz ? " · at the " + zn.name + " level" : "");
        if (zn.dz) pc.note += " Laid at the " + zn.name + " level (" + (zn.dz > 0 ? "+" : "−") + Math.abs(zn.dz) + "); no splice to the main slab's sheets.";
      });
    });
    run.n = run.mesh.length;
    if (!run.n) { errors.push("Line " + ms.line + " (" + ms.code + " " + f + "): no sheet fits the slab inside cover."); runs.splice(runs.indexOf(run), 1); delete meshes[f]; return; }
    const LAP = MESH_LAP(s.fam);
    run.label = ms.code + " " + f + " " + dirS + " · " + run.n + " SHEET" + (run.n > 1 ? "S" : "");
    run.callout = ms.code + " " + (top ? "TOP" : "BOTTOM") + " MESH, LONG WIRES " + dirS + ", " + run.n + " SHEET" + (run.n > 1 ? "S" : "") + " FROM 6.0 × 2.4 STOCK, LAPS " + LAP.end + " END / " + LAP.side + " SIDE, CUT " + C + " CLEAR OF OPENINGS";
    const p0 = run.mesh[0];
    run.tagPos = [p0.x0 + (p0.x1 - p0.x0) * (top ? 0.62 : 0.35), p0.y0 + (p0.y1 - p0.y0) * (top ? 0.7 : 0.45), zL + 20];
    if (lapped) warnings.push(ms.code + " " + f + ": mesh laps " + LAP.end + " end / " + LAP.side + " side are placeholders (AS 3600 Cl 13.2.3 geometry with the fly ends trimmed, Findings 11.3); confirm the mesh lap rule.");
    if (DROPS.length || STEP) warnings.push(ms.code + " " + f + " stops " + C + " short of each side of " + DROPS.map(dd => "the " + dd.d + " set-down " + dd.id).concat(STEP ? ["the " + STEP.rise + " step"] : []).join(" and ") + "; the splice across a change of level is not detailed for mesh (Z-bars and L-bars are bar details). Check with the engineer.");
    MSUM.push(meshSummary(run, area));
  });
  const CHAIR_PITCH = meshes.T ? 800 : 1000;   // chairs at 800 under a top mesh (NCC 2019 Vol 2 Table 3.2.3.1, fabric, via Findings 11.3), 1,000 under bars

  // ---- N12 edge bars top and bottom around the free slab edges (inside the cogs) ----
  if (F.edges) {
    const off = C + 12;
    const et = addRun({ layer: "D", size: 12, dir: "X", kind: "edge", z: zEdgeT, label: "N12 EDGE BAR T", callout: "N12 EDGE BAR TOP, ALL FREE SLAB EDGES", lap: lapUse({ size: 12, kase: "slab", sp: 0, cover: C, below: zEdgeT - 6, what: "edge bars top" }) });
    const eb = addRun({ layer: "A", size: 12, dir: "X", kind: "edge", z: zEdgeB, label: "N12 EDGE BAR B", callout: "N12 EDGE BAR BOTTOM, ALL FREE SLAB EDGES", lap: lapUse({ size: 12, kase: "slab", sp: 0, cover: C, below: zEdgeB - 6, what: "edge bars bottom" }) });
    [[true, SL.y0 + off], [true, SL.y1 - off], [false, SL.x0 + off], [false, SL.x1 - off]].forEach(e => {
      const a = e[0] ? SL.x0 + off : SL.y0 + off, b = e[0] ? SL.x1 - off : SL.y1 - off;
      [[et, zEdgeT], [eb, zEdgeB]].forEach(rz => placeLine(rz[0], e[0], e[1], a, b, rz[1], { setout: "slab edge", note: "Edge bar along the free slab edge, tied inside the top-bar cogs; laps " + rz[0].lap.len + " where split." }));
    });
    et.tagPos = [SL.x0 + Math.min(2850, L * 0.2), SL.y0 + off, zEdgeT + 20]; eb.tagPos = [SL.x0 + off, SL.y0 + Math.min(1550, Wd * 0.17), zEdgeB + 20];
  }

  // ---- additional top bars over flat-plate columns (columns not on a beam line) ----
  if (COLS.length && (hasMat("C") || hasMat("D"))) {
    const zAX = zTied("D", 16), zAY = zTied("C", 16);
    const rx = hasMat("D") ? addRun({ layer: "D", size: 16, dir: "X", kind: "add", z: zAX, label: "ADD N16-200 · D × 3000", callout: "ADD N16-200 LAYER D × 3000 OVER COLUMNS", lap: lapUse({ size: 16, kase: "slab", sp: 200, cover: C, below: Z.D - 8, what: "additional top bars (D)" }) }) : null;
    const ry = hasMat("C") ? addRun({ layer: "C", size: 16, dir: "Y", kind: "add", z: zAY, label: "ADD N16-200 · C × 3000", callout: "ADD N16-200 LAYER C × 3000 OVER COLUMNS", lap: lapUse({ size: 16, kase: "slab", sp: 200, cover: C + dD, below: Z.C - 8, what: "additional top bars (C)" }) }) : null;
    let last = null;
    COLS.filter(c => !inBeam(c.x, c.y).length).forEach(c => {
      last = c;
      for (let o = -400; o <= 400; o += 200) {
        if (rx) placeLine(rx, true, c.y + o + 75, Math.max(c.x - 1500, SL.x0 + C), Math.min(c.x + 1500, SL.x1 - C), zAX, { cog: true, setout: "over column " + c.name, note: "Additional top bar over column " + c.name + ", 1500 each side of the column centre." });
        if (ry) placeLine(ry, false, c.x + o + 75, Math.max(c.y - 1500, SL.y0 + C), Math.min(c.y + 1500, SL.y1 - C), zAY, { cog: true, setout: "over column " + c.name, note: "Additional top bar over column " + c.name + ", 1500 each side of the column centre." });
      }
    });
    [rx, ry].forEach(r => { if (!r) return; if (!r.bars.length) runs.splice(runs.indexOf(r), 1); else r.tagPos = [last.x - 900, last.y - (r === rx ? 650 : 700), zAX + 26 + lvl(last.x - 1, last.y - 1)]; });
  }

  // ---- extra bars ----
  if (F.extras && nX >= 3 && nY >= 2) {
    const midX = (gx[1] + gx[2]) / 2, bay = { x0: gx[1] + 200, x1: gx[2] - 200, y0: gy[0] + 200, y1: gy[1] - 200 };
    if (hasMat("A") && clearOfBeams({ x0: midX - 1500, x1: midX + 1500, y0: bay.y0, y1: bay.y1 })) {
      const zE1 = zTied("A", 16);
      const ex1 = addRun({ layer: "A", size: 16, dir: "X", kind: "extra", z: zE1, label: "EXTRA N16-200 · A × 3000", callout: "EXTRA N16-200 LAYER A × 3000 MID-SPAN, BAY 2–3 / A–B", lap: lapUse({ size: 16, kase: "slab", sp: 200, cover: C, below: Z.A - 8, what: "extra bottom bars (A)" }) });
      for (let y = bay.y0 + 900; y <= bay.y1 - 800; y += 200) placeLine(ex1, true, y, midX - 1500, midX + 1500, zE1, { setout: so(true, y), note: "Extra bottom bar at mid-span, placed between the layer A mat bars." });
      if (ex1.bars.length) ex1.tagPos = [midX, bay.y0 + 1200, zE1 + 22]; else runs.splice(runs.indexOf(ex1), 1);
    }
    const ib = BEAMS.find(b => b.id === "IB1");
    if (ib && hasMat("D")) {
      const zE2 = zTied("D", 16);
      const ex2 = addRun({ layer: "D", size: 16, dir: "X", kind: "extra", z: zE2, label: "EXTRA N16-300 · D × 3000 OVER IB1", callout: "EXTRA N16-300 LAYER D × 3000 OVER BEAM IB1", lap: lapUse({ size: 16, kase: "slab", sp: 300, cover: C, below: Z.D - 8, what: "extra top bars over IB1 (D)" }) });
      for (let y = SL.y0 + 175; y <= SL.y1 - 50; y += 300) placeLine(ex2, true, y, ib.at - 1500, ib.at + 1500, zE2, { setout: so(true, y), note: "Extra top bar across beam IB1, 1500 each side of the beam centreline, between the layer D mat bars." });
      ex2.tagPos = [ib.at + 900, SL.y0 + Wd * 0.3, zE2 + 26];
    }
    if (HOLES.length && hasMat("C")) {
      const ex3 = addRun({ layer: "C", size: 12, dir: "X", kind: "extra", z: zEdgeT, label: "EXTRA 2-N12 × 1200 DIAG", callout: "EXTRA 2-N12 × 1200 DIAGONAL AT EACH RE-ENTRANT CORNER OF OPENINGS, UNDER LAYER C" });
      HOLES.forEach(h => [[h.x0, h.y0, -1, -1], [h.x1, h.y0, 1, -1], [h.x1, h.y1, 1, 1], [h.x0, h.y1, -1, 1]].forEach(cr => {
        [60, 160].forEach(k => {
          const cx = cr[0] + cr[2] * k / Math.SQRT2, cy = cr[1] + cr[3] * k / Math.SQRT2, dx = cr[2] * 600 / Math.SQRT2, dy = -cr[3] * 600 / Math.SQRT2;
          addBar(ex3, { pts: [[cx - dx, cy - dy, zEdgeT], [cx + dx, cy + dy, zEdgeT]], shape: "straight", setout: h.id.toLowerCase() + " corner", note: "Diagonal crack-control bar across the re-entrant corner, tied under the top mat." });
        });
      }));
      ex3.tagPos = [HOLES[0].x1 + 420, HOLES[0].y1 + 420, zEdgeT + 20];
    }
  }

  // ---- trimmers top and bottom at openings ----
  function addTrims(h, name, sizeB, sizeT, ext) {
    const yL = [h.y0 - 60, h.y0 - 135, h.y1 + 60, h.y1 + 135], xL = [h.x0 - 60, h.x0 - 135, h.x1 + 60, h.x1 + 135];
    const cx = v => Math.max(SL.x0 + C, Math.min(SL.x1 - C, v)), cy = v => Math.max(SL.y0 + C, Math.min(SL.y1 - C, v));
    [{ layer: "A", size: sizeB, X: true, z: zTied("A", sizeB) }, { layer: "B", size: sizeB, X: false, z: zTied("B", sizeB) }, { layer: "C", size: sizeT, X: false, z: zTied("C", sizeT) }, { layer: "D", size: sizeT, X: true, z: zTied("D", sizeT) }].forEach(t => {
      if (!hasMat(t.layer)) return;
      const run = addRun({ layer: t.layer, size: t.size, dir: t.X ? "X" : "Y", kind: "trim", z: t.z, label: "2-N" + t.size + " TRIM · " + t.layer, callout: "2-N" + t.size + " TRIMMERS EACH SIDE OF " + name + " (LAYER " + t.layer + ")",
        lap: lapUse({ size: t.size, kase: "slab", sp: 75, cover: C + (t.layer === "B" ? dA : t.layer === "C" ? dD : 0), below: t.z - t.size / 2, what: "trimmers (" + t.layer + ")" }) });   // the two trimmers sit 75 apart, so half the clear spacing governs cd
      (t.X ? yL : xL).forEach(p => placeLine(run, t.X, p, t.X ? cx(h.x0 - ext) : cy(h.y0 - ext), t.X ? cx(h.x1 + ext) : cy(h.y1 + ext), t.z, { cog: t.layer === "C" || t.layer === "D", setout: name.toLowerCase() + " edge", note: "Trimmer: replaces the bars stopped at the opening and extends " + ext + " past each corner." }));
      run.tagPos = t.X ? [(h.x0 + h.x1) / 2, t.layer === "A" ? h.y1 + 300 : h.y0 - 300, t.z + 22] : [t.layer === "B" ? h.x0 - 360 : h.x1 + 360, (h.y0 + h.y1) / 2, t.z + 22];
    });
  }
  // Trimmer size follows the opening size (the Level 1 example's values, not a standard: 2-N16 extended 600 past each
  // corner at openings 1,500 or more across, 2-N12 extended 500 at smaller ones). Asked Baji whether this is his
  // office's rule or should be a per-opening input (planning doc, Questions for Baji, 2026-11-10).
  HOLES.forEach(h => { const big = Math.max(h.x1 - h.x0, h.y1 - h.y0) >= 1500; addTrims(h, h.id, big ? 16 : 12, 12, big ? 600 : 500); });

  // ---- balconies: cantilevers off a slab edge, set down b.down (#7c: any edge, several). Written in the balcony's edge
  // frame: an along-coordinate (position along the edge) and an out-coordinate (plan value across it), both real plan
  // values, so a north-edge balcony builds exactly as before and the other edges are the same bars turned. ----
  BALCS.forEach(B => {
    const alongX = B.along === "X", sg = B.sg;
    const P = (al, ou, z) => alongX ? [al, ou, z] : [ou, al, z];   // plan point from an along- and an out-coordinate
    const O = t => B.root + sg * t;                               // out-coordinate t mm out from the slab edge (negative = back into the slab)
    const spread = (lo, hi, sp, d) => { const n = Math.floor((hi - lo - 2 * C - d) / sp) + 1, st = lo + (hi - lo - (n - 1) * sp) / 2; return Array.from({ length: n }, (_, i) => st + i * sp); };
    const als = (sp, d) => spread(B.a0, B.a1, sp, d);                                          // bar lines across the balcony's width (positions along the edge)
    const ous = (sp, d) => spread(Math.min(B.root, B.tip), Math.max(B.root, B.tip), sp, d);    // bar lines across its projection
    const zb1 = B.bot + C + 6, zb2 = zb1 + 12, zt1 = B.top - C - 6, zt2 = zt1 - 12;
    const zCog = zb2 + 14, zEdgeTop = zt2 - 12, zEdgeBot = zb2 + 20;   // cogs stop just above the balcony's bottom mat; edge bars sit inside the mats
    const stepTxt = B.down ? "Z AT " + B.down + " STEP, " : "";
    const lbl = B.plain ? "BALC" : B.id, co = B.plain ? "BALCONY" : B.id;
    const alDir = alongX ? "X" : "Y", ouDir = alongX ? "Y" : "X", alTxt = alongX ? "E–W" : "N–S", ouTxt = alongX ? "N–S" : "E–W";
    const edgeG = alongX ? (B.edge === "N" ? GY[nY - 1] : GY[0]) : (B.edge === "E" ? GX[nX - 1] : GX[0]);   // the grid line along the edge
    const soOut = p => fmt(Math.abs(p - edgeG[1])) + " " + B.edge + " of grid " + edgeG[0];   // a bar line across the projection, from that grid
    const soAl = p => so(!alongX, p);                                                         // a bar line along the edge, from grid 1 / grid A
    const lines = (r, arr, sp) => { r.n = arr.length; r.sp = sp; runSetout(r, r.dir === "X", arr[0], arr[arr.length - 1]); };
    const b1 = addRun({ layer: "A", size: 12, dir: alDir, kind: "balc", balc: B, z: zb1, label: lbl + " N12-300 · A", callout: co + " N12-300 LAYER A " + alTxt });
    const yb = ous(300, 12); lines(b1, yb, 300); yb.forEach((p, i) => addBar(b1, { pts: [P(B.a0 + C, p, zb1), P(B.a1 - C, p, zb1)], line: i + 1, setout: soOut(p) }));
    b1.dist = { dir: alDir, at: B.a0 + (B.a1 - B.a0) * 0.42, p0: yb[0], p1: yb[yb.length - 1], z: zb1 + 22, frac: 0.5 };
    const b2 = addRun({ layer: "B", size: 12, dir: ouDir, kind: "balc", balc: B, z: zb2, label: lbl + " N12-300 · B", callout: co + " N12-300 LAYER B " + ouTxt });
    const xb = als(300, 12); lines(b2, xb, 300); xb.forEach((p, i) => addBar(b2, { pts: [P(p, O(C), zb2), P(p, O(B.proj - C), zb2)], line: i + 1, setout: soAl(p) }));
    b2.dist = { dir: ouDir, at: O(B.proj - 400), p0: xb[0], p1: xb[xb.length - 1], z: zb2 + 22, frac: 0.12 };
    const t2 = addRun({ layer: "C", size: 12, dir: ouDir, kind: "balc", balc: B, z: zt2, label: lbl + " N12-200 T · CANTILEVER", callout: co + " N12-200 TOP: COG AT EDGE, " + stepTxt + "1500 INTO SLAB" });
    const xt = als(200, 12); lines(t2, xt, 200);
    const dzB = Math.abs(Z.C - zt2), ckB = Math.max(300, 6 * dzB);   // crank 1:6 or flatter, 300 minimum (SRIA TN5, DECISIONS.md); no crank when the balcony top mat lines up with layer C
    const back = p => dzB < 2 ? [P(p, O(-1800), zt2)] : [P(p, O(ckB / 2), zt2), P(p, O(-ckB / 2), Z.C), P(p, O(-1800), Z.C)];
    xt.forEach((p, i) => addBar(t2, { pts: [P(p, O(B.proj - C), zCog), P(p, O(B.proj - C), zt2)].concat(back(p)), shape: dzB < 2 ? "cog" : "cog + Z", line: i + 1, setout: soAl(p), note: "Cantilever top bar: cog down at the balcony edge, " + (dzB < 2 ? "straight on," : ckB + " crank (1:6) " + (Z.C > zt2 ? "up " : "down ") + dzB + " at the slab edge,") + " anchored 1500 back into the floor slab." }));
    t2.dist = { dir: ouDir, at: O(650), p0: xt[0], p1: xt[xt.length - 1], z: zt2 + 22, frac: 0.8 };
    const t1 = addRun({ layer: "D", size: 12, dir: alDir, kind: "balc", balc: B, z: zt1, label: lbl + " N12-300 · D", callout: co + " N12-300 LAYER D " + alTxt + ", COGGED BOTH ENDS" });
    const yt = ous(300, 12); lines(t1, yt, 300); yt.forEach((p, i) => addBar(t1, { pts: [P(B.a0 + C, p, zCog), P(B.a0 + C, p, zt1), P(B.a1 - C, p, zt1), P(B.a1 - C, p, zCog)], shape: "cogged both ends", line: i + 1, setout: soOut(p), note: "Balcony top distribution bar, cogged down at both free side edges." }));
    t1.dist = { dir: alDir, at: B.a0 + (B.a1 - B.a0) * 0.64, p0: yt[0], p1: yt[yt.length - 1], z: zt1 + 22, frac: 0.5 };
    const be = addRun({ layer: "D", size: 12, dir: alDir, kind: "edge", balc: B, z: zEdgeTop, label: lbl + " N12 EDGE BARS T&B", callout: co + " N12 EDGE BARS TOP AND BOTTOM, 3 FREE EDGES" });
    const o2 = C + 12, sides = alongX ? ["west", "east"] : ["south", "north"];
    [zEdgeTop, zEdgeBot].forEach(z => {
      addBar(be, { pts: [P(B.a0 + o2, O(B.proj - o2), z), P(B.a1 - o2, O(B.proj - o2), z)], setout: "balcony outer edge", note: "Edge bar along the balcony's free edge, inside the cogs." });
      addBar(be, { pts: [P(B.a0 + o2, O(o2), z), P(B.a0 + o2, O(B.proj - o2), z)], setout: "balcony " + sides[0] + " edge", note: "Edge bar along the balcony's free edge, inside the cogs." });
      addBar(be, { pts: [P(B.a1 - o2, O(o2), z), P(B.a1 - o2, O(B.proj - o2), z)], setout: "balcony " + sides[1] + " edge", note: "Edge bar along the balcony's free edge, inside the cogs." });
    });
    be.tagPos = P(B.a0 + 1500, O(B.proj - o2), zt1 - 4);
  });

  // ---- beams ----
  BEAMS.forEach(bm => {
    const X = bm.dir === "X", ld = bm.lig[0], soff = T - bm.D;
    const P = (sv, tv, z) => X ? [sv, bm.at + tv, z] : [bm.at + tv, sv, z];
    const spread = (n, d) => { const e = bm.w / 2 - C - ld - d / 2; return n === 1 ? [0] : Array.from({ length: n }, (_, i) => -e + i * 2 * e / (n - 1)); };
    const zB = soff + C + ld + bm.bot[0] / 2, zT = zChairTop - 20;
    // beam laps (#5): narrow-element contact laps; cover to the bar = cover + the lig; the bar centres from spread(); k1 1.3 for the top bars (more than 300 of concrete below)
    const beamLap = (n, d, z, what) => { const e = bm.w / 2 - C - ld - d / 2, below = z - soff - d / 2; return lapUse({ size: d, kase: below > 300 ? "beamGt300" : "beamLt300", sp: n > 1 ? 2 * e / (n - 1) : 0, cover: C + ld, below: below, what: bm.id + " " + what }); };
    const bot = addRun({ layer: "BM", size: bm.bot[0], dir: bm.dir, kind: "beam", z: zB, label: bm.id + " · " + bm.bot[1] + "N" + bm.bot[0] + " B", callout: bm.id + " " + bm.bot[1] + "N" + bm.bot[0] + " BOTTOM, COGGED ENDS", lap: beamLap(bm.bot[1], bm.bot[0], zB, "bottom bars") });
    // longitudinal bars: split at the 12 m stock length with staggered laps, cogs on the true ends only
    const beamLine = (run, tv, i, z, cogDz, size, what) => {
      const ps = pieces(bm.a + C, bm.b - C, run, i % 2 === 1, 300, 300);
      ps.forEach((pc, k) => {
        const pts = [P(pc[0], tv, z), P(pc[1], tv, z)], first = k === 0, last = k === ps.length - 1;
        if (first) pts.unshift(P(pc[0], tv, z + cogDz)); if (last) pts.push(P(pc[1], tv, z + cogDz));
        addBar(run, { pts: pts, beam: true, shape: first && last ? "cogged both ends" : first || last ? "cogged one end" : "straight", lapPrev: !first, lapNext: !last,
          setout: tv === 0 ? "on beam centreline" : fmt(Math.abs(tv)) + " off beam centreline", note: "Beam " + what + " bar; standard cogs (300 nominal) at the beam ends" + (ps.length > 1 ? ", split at 12 m with " + run.lap.len + " staggered laps." : ".") });
      });
    };
    spread(bm.bot[1], bm.bot[0]).forEach((tv, i) => beamLine(bot, tv, i, zB, 300, bm.bot[0], "bottom"));
    bot.tagPos = X ? [bm.a + (bm.b - bm.a) * bm.tagS, bm.at, zB] : [bm.at, bm.a + (bm.b - bm.a) * bm.tagS, zB];
    const top = addRun({ layer: "BM", size: bm.top[0], dir: bm.dir, kind: "beam", z: zT, label: bm.id + " · " + bm.top[1] + "N" + bm.top[0] + " T", callout: bm.id + " " + bm.top[1] + "N" + bm.top[0] + " TOP, COGGED ENDS", lap: beamLap(bm.top[1], bm.top[0], zT, "top bars") });
    spread(bm.top[1], bm.top[0]).forEach((tv, i) => beamLine(top, tv, i, zT, -300, bm.top[0], "top"));
    top.tagPos = X ? [bm.a + (bm.b - bm.a) * (bm.tagS + 0.3), bm.at, zT + 40] : [bm.at, bm.a + (bm.b - bm.a) * (bm.tagS + 0.3), zT + 40];
    const lg = addRun({ layer: "BM", size: ld, type: bm.lig[2], dir: bm.dir, kind: "lig", z: soff + 100, label: bm.id + " · " + bm.lig[2] + ld + " LIGS @" + bm.lig[1], callout: bm.id + " " + bm.lig[2] + ld + " CLOSED LIGS @ " + bm.lig[1] });
    const w = bm.w - 2 * C - ld, zb = soff + C + ld / 2, h = zEdgeT - zb;
    for (let sv = bm.a + 50; sv <= bm.b - 50; sv += bm.lig[1])
      addBar(lg, { pts: [P(sv, -w / 2, zb), P(sv, w / 2, zb), P(sv, w / 2, zb + h), P(sv, -w / 2, zb + h), P(sv, -w / 2, zb)], hookEnds: 2, shape: "closed lig", lig: true, setout: X ? so(false, sv) : so(true, sv), note: "Closed tie bent on a " + pinDia(bm.lig[2], ld, "fitment") + " pin (" + (bm.lig[2] === "R" ? "3" : "4") + "db, AS 3600 Cl 17.2.3.2) with two 135° hooks of " + Math.round(bendGeom(bm.lig[2], ld, "fitment").hook135) + " each (Cl 13.1.2.7)." });
    lg.tagPos = X ? [bm.a + (bm.b - bm.a) * (bm.tagS + 0.15), bm.at + 260, soff + 150] : [bm.at + 260, bm.a + (bm.b - bm.a) * (bm.tagS + 0.15), soff + 150];
  });

  // ---- columns below (existing) + starters for columns above ----
  if (COLS.length) (function () {
    const o = COL / 2 - 40 - 10 - 12;
    const offs = [[-o, -o], [0, -o], [o, -o], [-o, 0], [o, 0], [-o, o], [0, o], [o, o]];
    const cv = addRun({ layer: "CL", size: 24, dir: "Z", kind: "col", z: -800, label: "COL 400 × 400 · 8N24 · R10-200", callout: "COLUMN BELOW: 8N24 VERTICALS, R10 TIES @ 200", existing: true });
    const ct = addRun({ layer: "CL", size: 10, type: "R", dir: "Z", kind: "col", z: -800, label: "", callout: "COLUMN BELOW: R10 TIES @ 200", existing: true });
    const st = addRun({ layer: "ST", size: 24, dir: "Z", kind: "start", z: T + 400, label: "8N24 STARTERS · PROJ " + PROJ, callout: "8N24 STARTERS PER COLUMN, PROJECT " + PROJ + " ABOVE SLAB", lap: STLAP });
    COLS.forEach(c => {
      const bmNames = [...new Set(inBeam(c.x, c.y).map(b => b.id))];
      offs.forEach(([dx, dy]) => {
        const ix = dx === 0 ? 0 : -Math.sign(dx) * 300, iy = dx === 0 ? -Math.sign(dy) * 300 : 0;
        addBar(cv, { pts: [[c.x + dx, c.y + dy, COLB + 50], [c.x + dx, c.y + dy, c.top + 128], [c.x + dx + ix, c.y + dy + iy, c.top + 128]], shape: "cogged top", col: c, existing: true, setout: "column " + c.name, note: "Existing column below, already poured; verticals cogged into the slab/beam. Shown for context; not in this pour's schedule." });
        addBar(st, { pts: [[c.x + dx + ix, c.y + dy + iy, 70 + c.off], [c.x + dx, c.y + dy, 70 + c.off], [c.x + dx, c.y + dy, T + c.off + PROJ]], shape: "L starter", col: c, setout: "column " + c.name, note: "Starter for the column above: cogged foot in the slab, projects " + PROJ + " above the slab to lap with the column bars." + (bmNames.length ? " Framed by beam " + bmNames.join(" and ") + " at this column." : " Flat-plate column: additional top bars over the column instead of a beam.") });
      });
      const r = COL / 2 - 40 - 5;
      for (let z = COLB + 100; z <= c.top - 100; z += 200)
        addBar(ct, { pts: [[c.x - r, c.y - r, z], [c.x + r, c.y - r, z], [c.x + r, c.y + r, z], [c.x - r, c.y + r, z], [c.x - r, c.y - r, z]], hookEnds: 2, tie: true, shape: "closed tie", col: c, existing: true, setout: "column " + c.name, note: "Existing column tie, already poured." });
    });
    const cl = COLS[COLS.length - 1];
    cv.tagPos = [cl.x + 300, cl.y - 450, -900];
    const mid = COLS[Math.floor(COLS.length / 2)];
    st.tagPos = [mid.x, mid.y, T + PROJ + 60];
  })();

  // ---- stair flight bars (#8). Detailing as the CIA Reinforcement Detailing Handbook (Z6) shows a flight: main bars in
  // the bottom of the waist along the slope, distribution bars across them, top bars over the landing support bent down
  // the flight over the convex top corner. At the top junction the soffit corner is re-entrant, so the bottom bars are
  // not bent round it: they run straight into the wedge under the slab and stop; how they anchor into the landing
  // (and the starters for them) is the engineer's detail — asked (planning doc, Questions for Baji, 2026-11-17). The
  // top bars are cast into this slab (layer ST, placed with the column starters); the flight's bars are a later pour. ----
  if (STAIR) (function () {
    const S = STAIR, alongX = S.alongX, P = S.P, G = S.G, L = S.L, w = S.w, cc = S.cc;
    const dm = S.main.size, spm = S.main.spacing, dd = S.dist.size, spd = S.dist.spacing, dt = S.top.size, spt = S.top.spacing;
    const alDir = alongX ? "X" : "Y", crDir = alongX ? "Y" : "X";
    const soC = c => so(alongX, c);                       // a bar line along the flight: its position across, from grid A / 1
    const soS = s => so(!alongX, S.edge + S.sg * s);      // a bar across the flight: its position along, from grid 1 / A
    const spread = (sp, d) => { const k = Math.floor((w - 2 * C - d) / sp) + 1, st = S.c0 + (w - (k - 1) * sp) / 2; return Array.from({ length: k }, (_, i) => st + i * sp); };
    const sLen = ds => ds * L / G, sPlan = ls => ls * G / L;   // plan run ↔ sloped length
    const crossPts = (s, d, size) => [P(s, S.c0 + C + size / 2, S.zLine(d, s)), P(s, S.c1 - C - size / 2, S.zLine(d, s))];
    // steel lines as offsets below the throat: bottom main bars at cover above the soffit, bottom distribution bars on
    // them; top bars at cover under the throat (the treads' inner corners), top distribution bars under those
    const dMain = S.waist - C - dm / 2, dDist = dMain - dm / 2 - dd / 2, dTop = C + dt / 2, dTopD = dTop + dt / 2 + dd / 2;
    if (dDist < dTopD + dd / 2 + dt / 2 + 10) { errors.push("Stair: waist " + S.waist + " is too thin for N" + dm + " main, N" + dd + " distribution and N" + dt + " top bars at " + C + " cover each face."); return; }
    // bottom main bars: from cover above the floor below (where the starters cast there lap them) up into the wedge
    // under this slab's soffit, stopping cover under it
    const sMainLo = S.sAt(dMain, S.zLo + C + dm / 2), sMainHi = Math.max(S.sWedge + C, S.sAt(dMain, -(C + dm / 2)));
    const lapM = lapUse({ size: dm, kase: "slab", sp: spm, cover: C, below: 0, what: "stair main bars" });
    const mainRun = addRun({ layer: "SR", size: dm, dir: alDir, kind: "stairMain", stair: S, z: S.zLine(dMain, S.run / 2), lap: lapM,
      label: "STAIR N" + dm + "-" + spm + " MAIN · B", callout: "STAIR FLIGHT N" + dm + "-" + spm + " MAIN BARS IN THE BOTTOM OF THE " + S.waist + " WAIST, LAP " + lapM.len + " WITH THE STARTERS FROM THE FLOOR BELOW" });
    const cm = spread(spm, dm); mainRun.n = cm.length; mainRun.sp = spm; runSetout(mainRun, alongX, cm[0], cm[cm.length - 1]);
    cm.forEach((c, i) => addBar(mainRun, { pts: [P(sMainHi, c, S.zLine(dMain, sMainHi)), P(sMainLo, c, S.zLine(dMain, sMainLo))], shape: "straight", line: i + 1, stair: true, setout: soC(c),
      note: "Stair main bar in the bottom of the waist, along the slope: laps the starter from the floor below at its lower end, stops " + C + " under this slab's soffit at the top. How the bottom bars anchor into the landing is the engineer's detail." }));
    const sTag = Math.min(S.run * 0.45, S.voidLen * 0.6);
    mainRun.dist = { dir: alDir, at: S.edge + S.sg * sTag, p0: cm[0], p1: cm[cm.length - 1], z: S.zLine(dMain, sTag) + 22, frac: 0.5 };
    // starters cast in the floor below (existing, context only): a leg in that slab's top, bent up the slope under the
    // main bars and lapping them (the soffit corner at the foot is convex, so the bend is allowed)
    const lapS = lapM.len, zLowTop = S.zLo - C - 6 - dm / 2;   // the floor below is taken as the same cover
    const sStHi = sMainLo - sPlan(lapS + 50), sStLo = S.sAt(dMain, zLowTop);
    const stRun = addRun({ layer: "SR", size: dm, dir: alDir, kind: "stairStart", stair: S, z: S.zLo, existing: true, label: "N" + dm + "-" + spm + " STARTERS · FLOOR BELOW", callout: "STAIR STARTERS N" + dm + "-" + spm + " CAST IN THE FLOOR BELOW (EXISTING), SLOPED LEG LAPS " + lapS + " WITH THE MAIN BARS" });
    cm.forEach((c, i) => addBar(stRun, { pts: [P(sStHi, c, S.zLine(dMain, sStHi)), P(sStLo, c, zLowTop), P(sStLo + lapS, c, zLowTop)], shape: "stair L", existing: true, stair: true, line: i + 1, setout: soC(c),
      note: "Starter cast in the floor below (existing): a leg in that slab's top, bent up the slope under the flight's main bars and lapping them " + lapS + ". Shown for context; not in this pour's schedule." }));
    stRun.tagPos = P(S.run + 150, cc, S.zLo + 40);
    // bottom distribution bars across the flight, on the main bars, at their spacing along the slope
    const lapD = lapUse({ size: dd, kase: "slab", sp: 0, cover: C + dm, below: 0, what: "stair distribution bars" });
    const distRun = addRun({ layer: "SR", size: dd, dir: crDir, kind: "stairDist", stair: S, z: S.zLine(dDist, S.run / 2), lap: lapD, label: "STAIR N" + dd + "-" + spd + " DIST · B", callout: "STAIR FLIGHT N" + dd + "-" + spd + " DISTRIBUTION BARS ACROSS THE FLIGHT, ON THE MAIN BARS" });
    const slopeB = sLen(sMainLo - sMainHi), nD = Math.floor(slopeB / spd) + 1, sD0 = sMainHi + sPlan((slopeB - (nD - 1) * spd) / 2);
    distRun.n = nD; distRun.sp = Math.round(sPlan(spd) * 10) / 10;   // the run's pitch is the plan pitch: the bars sit spd apart along the slope
    distRun.callout += " AT " + spd + " ALONG THE SLOPE (" + Math.round(sPlan(spd)) + " IN PLAN)";
    const lineNo = (i, k) => S.sg > 0 ? i + 1 : k - i;   // bar lines count up the plan axis, so a flight descending west or south counts from its foot
    for (let i = 0; i < nD; i++) { const s = sD0 + sPlan(i * spd); addBar(distRun, { pts: crossPts(s, dDist, dd), shape: "straight", line: lineNo(i, nD), stair: true, setout: soS(s) + " (" + fmt(sLen(Math.max(0, s))) + " down the slope)", note: "Distribution bar across the flight, tied on the main bars at " + spd + " along the slope." }); }
    runSetout(distRun, !alongX, Math.min(S.edge + S.sg * sD0, S.edge + S.sg * (sD0 + sPlan((nD - 1) * spd))), Math.max(S.edge + S.sg * sD0, S.edge + S.sg * (sD0 + sPlan((nD - 1) * spd))));
    const sDT = Math.min(S.run * 0.3, S.voidLen * 0.4);
    distRun.dist = { dir: crDir, at: S.c1 - C - 250, p0: Math.min(S.edge + S.sg * sD0, S.edge + S.sg * (sD0 + sPlan((nD - 1) * spd))), p1: Math.max(S.edge + S.sg * sD0, S.edge + S.sg * (sD0 + sPlan((nD - 1) * spd))), z: S.zLine(dDist, sDT) + 22, frac: 0.3 };
    // top bars over the landing support, cast into this slab: a leg under layer C in the flight's direction, bent at
    // the slab's edge corner (convex) down the flight's top, where the top distribution bars tie to it. The slab leg
    // is the lap; it is shortened (and flagged) where the landing is narrower than that.
    const zTopLeg = Z.C - dC / 2 - dt / 2 - 2;
    const lapT = lapUse({ size: dt, kase: "slab", sp: spt, cover: C + dD + dC, below: zTopLeg - dt / 2, what: "stair top bars" });
    const sCorner = S.sAt(dTop, zTopLeg), sLegEnd = sCorner + sPlan(S.topLeg);
    const posCorner = S.edge + S.sg * sCorner, back = -S.sg;   // the slab leg runs back from the corner into the landing
    let limit = alongX ? (back > 0 ? SL.x1 - C : SL.x0 + C) : (back > 0 ? SL.y1 - C : SL.y0 + C);
    HOLES.filter(q => q !== S.hole && (alongX ? q.y1 > S.c0 && q.y0 < S.c1 : q.x1 > S.c0 && q.x0 < S.c1)).forEach(q => {   // another opening across the leg's path
      const near = alongX ? (back > 0 ? q.x0 : q.x1) : (back > 0 ? q.y0 : q.y1);
      if ((near - posCorner) * back > 0 && Math.abs(near - posCorner) < Math.abs(limit - posCorner)) limit = near - back * C;
    });
    const room = Math.max(0, (limit - posCorner) * back), slabLeg = Math.min(lapT.len, Math.floor(room / 10) * 10);
    if (slabLeg < 300) { errors.push("Stair: no room in the landing for the top bars' slab leg beyond the " + ({ E: "east", W: "west", N: "north", S: "south" })[S.arrive] + " edge of " + S.void + " (" + fmt(room) + " to the slab edge or the next opening); arrive at another edge."); return; }
    if (slabLeg < lapT.len) warnings.push("Stair: the top bars' slab leg is " + slabLeg + ", shorter than the " + lapT.len + " lap, because the landing beyond " + S.void + " is only " + fmt(room + C) + " wide there. Check the anchorage with the engineer.");
    const topRun = addRun({ layer: "ST", size: dt, dir: alDir, kind: "stairTop", stair: S, z: zTopLeg, lap: lapT, label: "STAIR N" + dt + "-" + spt + " TOP · INTO SLAB", callout: "STAIR TOP BARS N" + dt + "-" + spt + " CAST INTO THE SLAB: " + slabLeg + " LEG UNDER LAYER C, BENT DOWN THE FLIGHT " + S.topLeg });
    const ct = spread(spt, dt); topRun.n = ct.length; topRun.sp = spt; runSetout(topRun, alongX, ct[0], ct[ct.length - 1]);
    ct.forEach((c, i) => addBar(topRun, { pts: [P(sCorner - slabLeg, c, zTopLeg), P(sCorner, c, zTopLeg), P(sLegEnd, c, S.zLine(dTop, sLegEnd))], shape: "stair L", line: i + 1, stair: true, setout: soC(c),
      note: "Stair top bar cast into the slab with the column starters: " + slabLeg + " leg under layer C into the landing, bent at the void edge down the flight's top for " + S.topLeg + " along the slope (placeholder length: the engineer sets it)." }));
    topRun.dist = { dir: alDir, at: posCorner + back * Math.max(60, slabLeg * 0.5), p0: ct[0], p1: ct[ct.length - 1], z: zTopLeg + 22, frac: 0.5 };
    // top distribution bars along the sloped leg, in the flight
    const sT0 = Math.max(100, sCorner + 100), nTD = Math.floor(sLen(Math.max(0, sLegEnd - sT0)) / spd) + 1;
    if (sLegEnd > sT0) {
      const tdRun = addRun({ layer: "SR", size: dd, dir: crDir, kind: "stairDistT", stair: S, z: S.zLine(dTopD, sT0), lap: lapD, label: "STAIR N" + dd + "-" + spd + " DIST · T", callout: "STAIR FLIGHT N" + dd + "-" + spd + " DISTRIBUTION BARS UNDER THE TOP BARS" });
      tdRun.n = nTD; tdRun.sp = Math.round(sPlan(spd) * 10) / 10;
      for (let i = 0; i < nTD; i++) { const s = sT0 + sPlan(i * spd); addBar(tdRun, { pts: crossPts(s, dTopD, dd), shape: "straight", line: lineNo(i, nTD), stair: true, setout: soS(s) + " (" + fmt(sLen(s)) + " down the slope)", note: "Distribution bar across the flight under the top bars' sloped legs." }); }
      tdRun.tagPos = P(sT0 + sPlan((nTD - 1) * spd) / 2, S.c0 + C + 300, S.zLine(dTopD, sT0 + sPlan((nTD - 1) * spd) / 2) + 30);
    }
    S.steel = { main: "N" + dm + "-" + spm, dist: "N" + dd + "-" + spd, top: "N" + dt + "-" + spt, mainLines: cm.length, topLines: ct.length, distBars: nD, topDist: sLegEnd > sT0 ? nTD : 0, slabLeg: slabLeg, lapMain: lapM.len };
  })();

  // ---- bar chairs at 1000 both ways (800 under a top mesh) ----
  // the grid starts half a pitch in from the slab's SW corner and extends over any balcony on the south / west edges
  const CP = CHAIR_PITCH, x00 = SL.x0 + CP / 2 - CP * Math.ceil((SL.x0 - EXT.x0) / CP), y00 = SL.y0 + CP / 2 - CP * Math.ceil((SL.y0 - EXT.y0) / CP);
  for (let x = x00; x < EXT.x1; x += CP) for (let y = y00; y < EXT.y1; y += CP) {
    const inMain = x > SL.x0 && x < SL.x1 && y > SL.y0 && y < SL.y1;
    const inBalc = BALCS.find(b => x > b.x0 + 100 && x < b.x1 - 100 && y > b.y0 + 100 && y < b.y1 - 100);
    if (!inMain && !inBalc) continue;
    if (HOLES.some(h => x > h.x0 - 100 && x < h.x1 + 100 && y > h.y0 - 100 && y < h.y1 + 100)) continue;
    if (inBeam(x, y).length) continue;
    const o = lvl(x, y); let s = o, t = zChairTop + o;
    if (inBalc) { s = inBalc.bot; t = inBalc.top - C - 24; }
    chairs.push({ pts: [[x, y, s], [x, y, t]], size: 8, chair: true, layer: "CH", pitch: CP });
  }

  // ---- bar marks (this pour only), then the mesh marks (#6) ----
  const sched = bars.filter(b => !b.existing);
  const groups = new Map();
  sched.forEach(b => { const k = b.type + b.size + "|" + b.code + "|" + b.len + "|" + b.dimStr; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
  const marks = [...groups.values()].sort((A, B) => {
    const a = A[0], b = B[0];
    return (LBY[a.layer].idx - LBY[b.layer].idx) || (b.size - a.size) || (b.len - a.len);
  }).map((list, i) => {
    const m = "A" + (i + 1);
    list.forEach(b => { b.mark = m; });
    return { mark: m, type: list[0].type, size: list[0].size, shape: list[0].shape, code: list[0].code, shapeName: list[0].shapeName, dims: list[0].dims, dimStr: list[0].dimStr, flags: list[0].flags, pin: list[0].geom.dp, len: list[0].len, qty: list.length, layer: list[0].layer, kg: list.reduce((s, b) => s + b.kg, 0) };
  });
  // lap flags (#5): any lap in use that is shorter than the AS 3600 value, and table gaps the flat lap filled
  LAPS.rows.filter(r => r.short && r.lapped).forEach(r => warnings.push("Lap " + r.type + r.size + " " + r.caseShort + " (" + r.what.join(", ") + "): " + r.len + " (" + lapSrcText(r) + ") is shorter than AS 3600 " + r.calc.rule + " gives, " + r.calc.lap + " (" + r.calc.detail + "). Check with the engineer."));
  if (LAPS.table) {   // one line for the table's gaps among the laps actually in use (and the mats): the flat lap or the detail's value filled them
    const by = {};
    LAPS.rows.filter(r => r.src !== "table" && (r.lapped || r.what.some(w => /^layer /.test(w)))).forEach(r => { const k = LAP_CASES[r.kase].word + " " + r.type + r.size; const m = by[k] = by[k] || { key: k, kase: r.kase, size: r.size, type: r.type, len: r.len, src: r.src, what: [] }; r.what.forEach(w => { if (m.what.indexOf(w) < 0) m.what.push(w); }); });
    LAPS.missing = Object.keys(by).map(k => by[k]);
    if (LAPS.missing.length) warnings.push("Lap table has no row for " + LAPS.missing.map(m => m.key + " (" + m.what.join(", ") + (m.src === "fixed" ? ": the detail's " + m.len + " stays" : "") + ")").join(", ") + "; the flat lap " + LAPLEN + " is used where no detail fixes it.");
  }
  LAPS.text = LAPS.source === "flat" ? LAPLEN + " all bars" : "per lap table" + (LAPS.missing.length ? " (flat " + LAPLEN + " where it has no row)" : "");
  if (cogFlagged) warnings.push(cogFlagged + " top-bar cogs are shorter than the AS 3600 standard cog because the slab is only " + T + " thick; scheduled as drawn. Confirm the cog length with the engineer.");
  bars.filter(b => b.existing).forEach(b => { b.mark = "EX"; });
  meshMarks(meshPieces, marks, "");
  runs.forEach(r => { r.marks = r.kind === "mesh" ? [...new Set(r.mesh.map(pc => pc.mark))] : [...new Set(r.bars.map(b => b.mark))]; });
  const kgBars = sched.reduce((s, b) => s + b.kg, 0), kgMesh = meshPieces.reduce((s, p) => s + p.kg, 0), kg = kgBars + kgMesh;
  // what each layer holds, in placing-drawing words (the viewer's step list, inspector and sheet titles read this)
  const dirWord = d => d === "X" ? "E–W" : "N–S";
  const matText = {};
  MAT_LAYERS.forEach(l => {
    const m = mats[l], ms = meshes[faceOf(l)];
    matText[l] = m ? "N" + m.size + "-" + m.sp + " " + dirWord(m.dir) : ms ? (ms.run.layer === l ? ms.code + " mesh, long wires " + dirWord(ms.dir) : "in the " + ms.code + " mesh (placed with " + ms.run.layer + ")") : "no mat";
  });
  // layer names follow the mesh: the sheet's layer is named for it, the face's other layer says it is in the sheet
  let VLAYERS = LAYERS, VLBY = LBY;
  if (meshes.T || meshes.B) {
    VLAYERS = LAYERS.map(l => {
      const ms = MAT_LAYERS.indexOf(l.id) >= 0 ? meshes[faceOf(l.id)] : null;
      if (!ms) return l;
      const mine = ms.run.layer === l.id;
      return mine ? Object.assign({}, l, { name: (ms.face === "T" ? "Top" : "Bottom") + " mesh " + ms.code + " · layers " + ms.layers.join("+"), short: ms.layers.join("+") + " · " + (ms.face === "T" ? "top" : "bot") + " mesh" }) : l;
    });
    VLBY = {}; VLAYERS.forEach(l => { VLBY[l.id] = l; });
  }
  // the stair layer (#8) exists only on a floor with a flight; its step is the last in the fixing order (a later pour)
  if (!STAIR) { VLAYERS = VLAYERS.filter(l => l.id !== "SR"); VLBY = {}; VLAYERS.forEach(l => { VLBY[l.id] = l; }); }
  const ORDER = STAIR ? FLOOR_ORDER.concat(["SR"]) : FLOOR_ORDER.slice();

  return { cfg: cfg, errors: errors, warnings: warnings, parsed: parsed, mats: mats, meshes: meshes, matText: matText, Z: Z, T: T, C: C, L: L, W: Wd, SL: SL, GX: GX, GY: GY, gx: gx, gy: gy,
    HOLES: HOLES, DROPS: DROPS, STEP: STEP, BALCS: BALCS, STAIR: STAIR, EXT: EXT, BEAMS: BEAMS, COLS: COLS, COL: COL, COLB: COLB, PROJ: PROJ, chairPitch: CHAIR_PITCH,
    bars: bars, wires: wires, meshPieces: meshPieces, meshSummary: MSUM, runs: runs, chairs: chairs, sched: sched, marks: marks, kg: kg, kgBars: kgBars, kgMesh: kgMesh, laps: LAPS, LAYERS: VLAYERS, LBY: VLBY, EXPLODE: EXPLODE, ORDER: ORDER, lvl: lvl };
}

export { buildModel };
