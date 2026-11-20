// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { BAR_SIZES } from "./constants.ts";

// ---------- lap and development lengths (backlog #5) ----------
// AS 3600:2018 Section 13 as read in the research note (planning log, Findings 2; research/02-lap-and-development-lengths.md)
// from secondary sources (Calcs.com, Spectacalc, SkyCiv, New Future Solutions); the standard itself is paywalled, so the
// clause numbers and coefficients below are to be verified against the purchased standard (Amdt 2) before release.
//   Cl 13.1.2.2  Lsy.tb = 0.5 k1 k3 fsy db / (k2 √f'c), not less than 0.058 fsy k1 db (29 k1 db at fsy 500); f'c capped at 65.
//                k1 = 1.3 for a horizontal bar with more than 300 of concrete cast below it, else 1.0.
//                k2 = (132 − db) / 100.  k3 = 1.0 − 0.15 (cd − db) / db, kept within 0.7 … 1.0.
//   Fig 13.2.2   cd for a lap: the smaller of the cover to the bar and half the clear spacing to the next lapped pair
//                (clear spacing a = s − 2 db). DECISIONS.md: cd = min(cover, half clear spacing), show which governed.
//   Cl 13.2.2    tension lap in a wide element (slab, wall): Lsy.t.lap = k7 Lsy.t, not less than 0.058 fsy k1 db; k7 = 1.25 (no
//                As-provided credit, k4 = k5 = 1.0). Narrow element (beam web): also not less than Lsy.t + 1.5 sb; the beam
//                bars here are contact laps (sb = 0), so k7 Lsy.t governs.
//   Cl 13.1.5.2  Lsy.cb = 0.22 fsy db / √f'c, not less than 0.0435 fsy db nor 200; k6 = 1.0.
//   Cl 13.2.4    compression lap = max(Lsy.c, 40 db, 300).
// Computed laps round UP to 50 (DECISIONS.md 2026-11-04). Engineers' tables (ACOR B23) round to the NEAREST 50, so a table
// cell can sit a little under the rounded value; "shorter" below compares with the unrounded formula value.
const LAP_CASES = {
  slab: { name: "slab", short: "slab", word: "SLAB", comp: false },
  beamLt300: { name: "beam, <300 of concrete below the bar", short: "beam <300 below", word: "BEAM <300", k1: 1.0, comp: false },
  beamGt300: { name: "beam, >300 of concrete below the bar", short: "beam >300 below", word: "BEAM >300", k1: 1.3, comp: false },
  column: { name: "column / wall (compression)", short: "column", word: "COLUMN", comp: true },
  panel: { name: "precast panel, a wide element cast flat", short: "panel", word: "PANEL", comp: false }   // panels (#33): flat lap only, no table row
};
const LAP_ROUND = 50;
const roundUpLap = v => Math.ceil(v / LAP_ROUND - 1e-9) * LAP_ROUND;
// o = { size, type (N or R), fc, cover (to the bar), spacing (centres of the lapped bars; 0 = a single bar line, cover
// governs), below (concrete cast below a horizontal bar), k1 (overrides below), comp (compression lap) }
function lapCalc(o) {
  const db = +o.size, fsy = o.type === "R" ? 250 : 500, fc = Math.min(65, Math.max(20, +o.fc || 20));
  if (o.comp) {
    const basic = 0.22 * fsy * db / Math.sqrt(fc), floor = Math.max(0.0435 * fsy * db, 200), Lsy_cb = Math.max(basic, floor);
    const raw = Math.max(Lsy_cb, 40 * db, 300);
    const rule = raw === Lsy_cb ? "Cl 13.1.5.2 Lsy.c" : raw === 300 ? "Cl 13.2.4 minimum 300" : "Cl 13.2.4 40db";
    return { comp: true, fsy: fsy, fc: fc, Lsy_cb: Math.round(Lsy_cb), raw: Math.round(raw), lap: roundUpLap(raw), rule: rule,
      detail: "Lsy.c " + Math.round(Lsy_cb) + ", 40db " + 40 * db + ", up to " + LAP_ROUND };
  }
  const C = +o.cover, k1 = o.k1 != null ? o.k1 : (o.below > 300 ? 1.3 : 1.0);
  const halfClear = o.spacing > 0 ? (o.spacing - 2 * db) / 2 : Infinity;
  const cd = Math.min(C, halfClear), cdGov = halfClear < C ? "half clear spacing" : "cover";
  const k2 = (132 - db) / 100, k3 = Math.min(1, Math.max(0.7, 1 - 0.15 * (cd - db) / db));
  const floor = 0.058 * fsy * k1 * db, basic = 0.5 * k1 * k3 * fsy * db / (k2 * Math.sqrt(fc)), Lsy_tb = Math.max(basic, floor);
  const raw = Math.max(1.25 * Lsy_tb, floor);
  return { comp: false, fsy: fsy, fc: fc, k1: k1, k2: k2, k3: Math.round(k3 * 1000) / 1000, cd: Math.round(cd), cdGov: cdGov, floor: Math.round(floor),
    Lsy_tb: Math.round(Lsy_tb), raw: Math.round(raw), lap: roundUpLap(raw), rule: basic >= floor ? "Cl 13.2.2 1.25 × Lsy.tb" : "Cl 13.2.2 1.25 × Lsy.tb (at its 29 k1 db minimum)",
    detail: "Lsy.tb " + Math.round(Lsy_tb) + " × 1.25 = " + Math.round(raw) + ", up to " + LAP_ROUND + "; cd " + Math.round(cd) + " = " + cdGov + ", k1 " + k1.toFixed(1) };
}
// A project lap table typed from the drawing's general notes (ACOR B23 style, Findings 2.2): a header line per case
// (SLAB / BEAM <300 / BEAM >300 / BEAM alone = both beam cases / COLUMN or WALL) followed by the f'c grades of its
// columns, then one row per bar size with one lap per grade. A case with no grades (B23's columns) has one value per
// size for any f'c. Lines starting with # are comments.
//   SLAB 25 32 40
//   N12 600 500 450
//   N16 850 750 650
//   COLUMN
//   N12 500
// Returns { cases: { slab: { fcs: [25, 32, 40] | null, rows: { 12: [600, 500, 450] }, line }, … }, errors: [], rows, empty }.
function parseLapTable(text) {
  const out = { cases: {}, errors: [], rows: 0, empty: true };
  let cur = null;
  const QUAL = /(<|>|LT|GT|LESS THAN|MORE THAN|UNDER|OVER|BELOW|ABOVE)\s*300(?:\s*(?:MM|BELOW|OF CONCRETE(?: CAST)?(?: BELOW)?(?: THE BAR)?|CAST BELOW|CONCRETE BELOW|BELOW BAR))?/g;
  String(text || "").split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim(); if (!raw || /^(#|\/\/)/.test(raw)) return;
    out.empty = false;
    const where = "Lap table line " + (i + 1) + " (" + raw.slice(0, 40) + (raw.length > 40 ? "…" : "") + "): ";
    const s = raw.toUpperCase().replace(/[–—]/g, "-").replace(/\b(MPA|F'C|FC|GRADES?|LAPS?|LENGTHS?|MM|BARS?|SIZE)\b/g, " ").replace(/[:,;()|]/g, " ").replace(/\s+/g, " ").trim();
    let m;
    if ((m = s.match(/^(SLABS?|BEAMS?|COLUMNS?(?: (?:AND|&|\/) WALLS?)?|WALLS?)(?:\s+(.*))?$/))) {
      const word = m[1], rest = (m[2] || "").trim();
      let keys;
      if (/^SLAB/.test(word)) keys = ["slab"];
      else if (/^BEAM/.test(word)) keys = /(<|LT|LESS THAN|UNDER|BELOW)\s*300/.test(rest) ? ["beamLt300"] : /(>|GT|MORE THAN|OVER|ABOVE)\s*300/.test(rest) ? ["beamGt300"] : ["beamLt300", "beamGt300"];
      else keys = ["column"];
      const toks = rest.replace(QUAL, " ").split(" ").filter(Boolean);
      const bad = toks.find(t => !/^\d{2,3}$/.test(t));
      if (bad) { out.errors.push(where + "after the case word give only the f'c grades of the columns (e.g. SLAB 25 32 40), not \"" + bad + "\"."); cur = null; return; }
      const fcs = toks.map(Number);
      if (fcs.some(f => f < 20 || f > 100)) { out.errors.push(where + "grades must be f'c values 20–100 MPa."); cur = null; return; }
      if (new Set(fcs).size !== fcs.length) { out.errors.push(where + "a grade is repeated."); cur = null; return; }
      const dup = keys.find(k => out.cases[k]); if (dup) { out.errors.push(where + LAP_CASES[dup].word + " was already given above; put all its rows under one header."); cur = keys.filter(k => out.cases[k]); return; }   // rows below still go to that case
      keys.forEach(k => { out.cases[k] = { fcs: fcs.length ? fcs : null, rows: {}, line: i + 1, both: keys.length > 1 }; });
      cur = keys; return;
    }
    if ((m = s.match(/^(?:N\s?)?(\d{1,2})(?:\s+(.*))?$/))) {
      if (!cur) { out.errors.push(where + "give the case first: SLAB, BEAM <300, BEAM >300 or COLUMN, then its f'c grades."); return; }
      const size = +m[1], vals = (m[2] || "").split(" ").filter(Boolean);
      if (BAR_SIZES.N.indexOf(size) < 0) { out.errors.push(where + "N" + size + " is not a standard N bar size."); return; }
      const bad = vals.find(v => !/^\d{3,4}$/.test(v)); if (bad) { out.errors.push(where + "laps must be whole millimetres 100–3500, not \"" + bad + "\"."); return; }
      const nums = vals.map(Number);
      if (nums.some(v => v < 100 || v > 3500)) { out.errors.push(where + "laps must be 100–3500 mm."); return; }
      const c0 = out.cases[cur[0]], want = c0.fcs ? c0.fcs.length : 1;
      if (nums.length !== want) { out.errors.push(where + nums.length + " lap" + (nums.length === 1 ? "" : "s") + " for " + (c0.fcs ? c0.fcs.length + " grades (" + c0.fcs.join(", ") + ")" : "a case with no grades (one lap per size)") + "."); return; }
      if (c0.rows[size]) { out.errors.push(where + "N" + size + " is already in " + LAP_CASES[cur[0]].word + "."); return; }
      cur.forEach(k => { out.cases[k].rows[size] = nums; }); out.rows++; return;
    }
    out.errors.push(where + "not a case header or a bar row (write SLAB 25 32 40, then N12 600 500 450).");
  });
  Object.keys(out.cases).forEach(k => { const c = out.cases[k]; if (!Object.keys(c.rows).length && !(c.both && k === "beamGt300")) out.errors.push("Lap table line " + c.line + " (" + LAP_CASES[k].word + "): no bar rows under this case."); });
  return out;
}
// The table's lap for a case / size / f'c: { len } ; { missing: true, fcs } when the case has grades but not this one; null when it has no such row.
function lapLookup(table, kase, size, fc) {
  const c = table && table.cases[kase]; if (!c) return null;
  const r = c.rows[size]; if (!r) return null;
  if (!c.fcs) return { len: r[0] };
  const i = c.fcs.indexOf(fc); return i < 0 ? { missing: true, fcs: c.fcs } : { len: r[i] };
}

export { LAP_CASES, LAP_ROUND, roundUpLap, lapCalc, parseLapTable, lapLookup };
