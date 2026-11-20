// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { DEFAULT_CFG } from "./defaults.ts";

// ---------- grids and the example geometry ----------
// Grid lines in mm from grid 1 (E–W) and grid A (N–S), cleaned and sorted, and the slab outline (grids + overhang).
function parseGrids(cfg) {
  const OV = +cfg.overhang || 250;
  const num = v => (typeof v === "number" ? [v] : String(v).split(/[\s,;]+/)).map(Number).filter(n => isFinite(n));
  const clean = arr => { const a = [...new Set(arr.map(n => Math.round(n)))].sort((p, q) => p - q); return a.length ? a : [0]; };
  const gx = clean(Array.isArray(cfg.gridX) ? cfg.gridX : num(cfg.gridX)), gy = clean(Array.isArray(cfg.gridY) ? cfg.gridY : num(cfg.gridY));
  return { gx: gx, gy: gy, OV: OV, SL: { x0: gx[0] - OV, x1: gx[gx.length - 1] + OV, y0: gy[0] - OV, y1: gy[gy.length - 1] + OV } };
}
// The Level 1 example's openings, balcony, set-down and step, derived from the grids (backlog #7a, #7b, #7c). A config
// that carries its own cfg.openings (array), cfg.balconies (array), cfg.setdowns (array) or cfg.step (object) is a
// real job and those are built as entered; a config without them gets these. The inputs panel shows them as its
// starting rows, so editing one row turns the example into a job.
//   opening:  { name, x0, y0, x1, y1 }  mm from grid 1 / grid A
//   balcony:  { name, edge, from, to, proj, thk, down }  a cantilever off one slab edge (edge N / S / E / W): from / to
//             along that edge (mm from grid 1 on the N and S edges, from grid A on the E and W edges), projection out
//             from the edge, slab thickness and set-down of its top below the main slab top. Several balconies per
//             floor. (cfg.balcony = one object { x0, x1, proj, thk, down } on the north edge, the #7a shape, is still read.)
//   setdown:  { name, x0, y0, x1, y1, depth }  a shallow set-down of the whole slab (soffit and top), Z-bar splices
//             across its edges in every mat (DECISIONS.md: Z-bars at shallow set-downs, SRIA TN5)
//   step:     { x0, y0, rise, nib }  the slab NE of (x0, y0) is raised by rise on a nib (the step's vertical face,
//             nib wide); L-bars lap each mat on both sides of the step
function exampleGeometry(cfg) {
  cfg = Object.assign({}, DEFAULT_CFG, cfg || {});
  const G = parseGrids(cfg), gx = G.gx, gy = G.gy, SL = G.SL, nX = gx.length, nY = gy.length;
  const openings = [
    { name: "STAIR VOID", x0: gx[nX - 1] - 3200, y0: gy[0] + 900, x1: gx[nX - 1] - 600, y1: gy[0] + 3100 },
    { name: "RISER", x0: gx[0] + 3000, y0: gy[0] + 2000, x1: gx[0] + 3600, y1: gy[0] + 2600 }
  ];
  const bx0 = Math.max(SL.x0 + 500, gx[Math.min(1, nX - 1)] - 800);
  const balconies = [{ name: "BALCONY", edge: "N", from: bx0, to: Math.min(bx0 + 5000, SL.x1 - 500), proj: 1800, thk: 180, down: 50 }];
  const setdowns = [{ name: "WET AREA", x0: gx[0] + 600, y0: gy[nY - 1] - 3700, x1: gx[0] + 3800, y1: gy[nY - 1] - 800, depth: 70 }];
  // the step line sits on the second-last grid each way (on a two-line grid that is grid 1 / A, which the model
  // rejects as too close to the slab edge, so a small grid gets no step, with a warning)
  const step = { x0: gx[Math.max(0, nX - 2)], y0: gy[Math.max(0, nY - 2)], rise: 200, nib: 300 };
  // stair (#8): a straight flight up from the floor below into the stair void, arriving at its east edge (the flight
  // runs west under the slab); floor-to-floor and the steel are STAIR_DEFAULTS placeholders
  const stair = Object.assign({}, STAIR_DEFAULTS);
  return { openings: openings, balconies: balconies, setdowns: setdowns, step: step, stair: stair };
}
// Balcony edge frames (#7c): `along` is the plan axis the edge runs on, `sg` the direction out from the slab.
const EDGES = { N: { along: "X", sg: 1, name: "north" }, S: { along: "X", sg: -1, name: "south" }, E: { along: "Y", sg: 1, name: "east" }, W: { along: "Y", sg: -1, name: "west" } };
// The balcony list a config means: cfg.balconies, else the #7a single north-edge object as a one-item list, else null (use the example).
function balconyRows(cfg) {
  if (Array.isArray(cfg.balconies)) return cfg.balconies;
  if (cfg.balcony && typeof cfg.balcony === "object") { const b = cfg.balcony; return [{ name: "BALCONY", edge: "N", from: b.x0, to: b.x1, proj: b.proj, thk: b.thk, down: b.down }]; }
  return null;
}
// Deepest change of level the model splices with a Z-bar (crank 1:6, SRIA TN5); anything deeper is a step with
// L-bars and a nib. 160 is the threshold the example has always used, not a value from a cited source — asked Baji
// (planning doc, Questions for Baji, 2026-11-10). The step rise and nib caps below are placeholders in the same question.
const ZBAR_MAX_DROP = 160, STEP_MAX_RISE = 600, NIB_MAX = 600;
// Stair flight (#8). Geometry limits as the NCC gives them for a stairway (NCC 2022 Volume One D3D14 "Goings and
// risers", D2.13 in NCC 2019: riser 115–190, going 250–355 for a public stair (240–355 private), 2G + R 550–700, 2 to
// 18 risers in a flight, risers and goings constant within a flight; D3D14(e) 2,000 headroom measured vertically
// above the nosing line). Quoted from the code as remembered — verify the clause numbers and values against the NCC
// text before release. The waist (180, the backlog's figure), the bar sizes and the leg lengths below are
// placeholders, not engineered values: question for Baji (planning doc, Questions for Baji, 2026-11-17).
const STAIR_RULES = { riserMin: 115, riserMax: 190, goingMin: 250, goingMax: 355, twoGRMin: 550, twoGRMax: 700, risersMax: 18, headroom: 2000, waistMin: 120, waistMax: 400, widthMin: 600 };
const STAIR_DEFAULTS = { void: "STAIR VOID", arrive: "E", rise: 3000, risers: "", going: 250, waist: 180, width: "", main: "N16-200", dist: "N12-300", top: "N16-200", topLeg: 1000 };

export { parseGrids, exampleGeometry, EDGES, balconyRows, ZBAR_MAX_DROP, STEP_MAX_RISE, NIB_MAX, STAIR_RULES, STAIR_DEFAULTS };
