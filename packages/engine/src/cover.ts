// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module

// ---------- cover table and minimum reinforcement (backlog #33e) ----------
// Cover for corrosion protection, AS 3600 Table 4.10.3.2 (standard formwork and compaction) and Table 4.10.3.3 (rigid
// formwork and intense compaction: factory precast), by exposure classification (Table 4.3) and the f'c column the
// concrete reaches (20 / 25 / 32 / 40 / ≥ 50 MPa). SECONDARY SOURCE: the 2009 edition as reproduced in Loo & Chowdhury
// (Findings 12.3, research/12-precast-panel-reinforcement.md); the 2018 tables are understood to be unchanged but must be
// checked against the standard before shipping. A bracketed value in the standard (here `c: true`) applies only with the
// Cl 4.3.2 strength-grade concession; a dash (null) means no cover is tabulated for that exposure at that f'c. Whatever
// the table says, cover is never less than the bar diameter (Cl 4.10.3.1 via Findings 12.3; the aggregate size is not
// an input here). Tilt-up cast on site against a slab is standard formwork; the panel record names the table it used.
const COVER_FC = [20, 25, 32, 40, 50];
const COVER_TABLE = {
  source: "AS 3600 Tables 4.10.3.2 / 4.10.3.3 as reproduced in Loo & Chowdhury (2009 edition, secondary source; Findings 12.3)",
  tables: { standard: { name: "standard formwork and compaction", table: "4.10.3.2" }, rigid: { name: "rigid formwork and intense compaction", table: "4.10.3.3" } },
  exposures: { A1: "A1 · interior, or exterior sheltered inland", A2: "A2 · exterior inland, or interior wet", B1: "B1 · near-coastal or industrial", B2: "B2 · coastal" },
  v: {   // [20, 25, 32, 40, 50]; a number, { v, c: true } for a concession value, null for no entry
    A1: { standard: [20, 20, 20, 20, 20], rigid: [20, 20, 20, 20, 20] },
    A2: { standard: [{ v: 50, c: true }, 30, 25, 20, 20], rigid: [{ v: 45, c: true }, 30, 20, 20, 20] },
    B1: { standard: [null, { v: 60, c: true }, 40, 30, 25], rigid: [null, { v: 45, c: true }, 30, 25, 20] },
    B2: { standard: [null, null, { v: 65, c: true }, 45, 35], rigid: [null, null, { v: 50, c: true }, 35, 25] }
  }
};
// The cover the table asks for: exposure, the f'c step at or below the concrete's f'c, the table (standard / rigid) and
// the largest bar in the element (cover ≥ db). Returns null fields where the exposure is not stated.
function coverRequired(exposure, fc, table, maxBar) {
  const ex = COVER_TABLE.v[exposure] ? exposure : null, tb = table === "rigid" ? "rigid" : "standard";
  const idx = COVER_FC.map((f, i) => f <= fc ? i : -1).filter(i => i >= 0).pop();
  const read = t => { if (!ex || idx == null) return { v: null, c: false }; const e = COVER_TABLE.v[ex][t][idx]; return e == null ? { v: null, c: false } : typeof e === "number" ? { v: e, c: false } : { v: e.v, c: true }; };
  const me = read(tb), other = read(tb === "rigid" ? "standard" : "rigid");
  const bar = maxBar || 0;
  const req = me.v == null ? (bar || null) : Math.max(me.v, bar);
  return { exposure: ex, exposureText: ex ? COVER_TABLE.exposures[ex] : "not stated", fc: fc, fcStep: idx == null ? null : COVER_FC[idx], table: tb, tableName: COVER_TABLE.tables[tb].name, tableNo: COVER_TABLE.tables[tb].table,
    tabulated: me.v, concession: me.c, other: other.v, otherConcession: other.c, otherTable: tb === "rigid" ? "standard" : "rigid", maxBar: bar, required: req, govern: req == null ? null : me.v != null && me.v >= bar ? "table" : "bar", source: COVER_TABLE.source };
}
// Minimum reinforcement in a wall, AS 3600 Cl 11.7.1: the ratio of the reinforcement area to the gross concrete area in
// each direction, both faces together, not less than 0.0015 vertically and 0.0025 horizontally. Cl 11.7.2 (crack control
// where the wall is restrained) asks for more horizontally: 0.0025 minor, 0.0035 moderate, 0.006 strong, and 0.006 in
// exposure B1 / B2 / C. SECONDARY SOURCE (Findings 12.1, an eng-tips reading of the clause); the engineer chooses the
// crack-control degree, so only the Cl 11.7.1 minimums are flagged here and the Cl 11.7.2 values are printed beside them.
const MIN_REO = { V: 0.0015, H: 0.0025, crack: { minor: 0.0025, moderate: 0.0035, strong: 0.006 }, source: "AS 3600 Cl 11.7.1 / 11.7.2 (secondary source; Findings 12.1)" };
const barAreaPerM = (db, sp) => Math.PI * db * db / 4 * 1000 / sp;   // mm²/m of one layer of bars db at spacing sp

export { COVER_FC, COVER_TABLE, coverRequired, MIN_REO, barAreaPerM };
