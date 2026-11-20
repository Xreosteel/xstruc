// ---------- bending geometry ---------- (strict TypeScript, backlog #39)

/** Bend geometry of one bar size for one role (mm). */
export interface BendGeom { db: number; dp: number; fp: number; rc: number; ro: number; e: number; hook180: number; hook135: number; cogLeg: number; cogDepth: number; hookWidth: number; role?: string }
export type Dim = [string, number | string];   // a length in mm, or an angle such as "45°"
export interface ShapeClass { code: string; name: string; dims: Dim[]; dimStr: string; flags: string[] }

// Pin (minimum internal bend) diameters: AS 3600:2018 Cl 17.2.3.2 as printed in SRIA "Bending reinforcement on site" (2016)
// and InfraBuild Reinforcing Product Guide 2023 p.41: fitments of R250N bar or 500L wire 3db, fitments of D500N bar 4db, all other bars 5db.
// Standard hook/cog: Cl 13.1.2.7 (InfraBuild p.37–38): 180° or 135° bend at that pin plus a straight extension of max(4db, 70);
// a 90° cog has the same total bar length as the 180° hook of that size. Values cross-checked against the research note
// (planning log, Findings 1; research/01-bar-bending-shape-codes.md): N12 5db hook180 183, cog leg 127, cog depth 169.
const PIN_RULE = { main: 5, fitmentN: 4, fitmentR: 3 };
function pinDia(type: string, size: number, role?: string): number { const fp = role === "fitment" ? (type === "R" || type === "W" ? PIN_RULE.fitmentR : PIN_RULE.fitmentN) : PIN_RULE.main; return fp * size; }
function bendGeom(type: string, size: number, role?: string): BendGeom {
  const db = size, dp = pinDia(type, size, role), rc = (dp + db) / 2, ro = dp / 2 + db, e = Math.max(4 * db, 70);
  const hook180 = Math.PI * rc + e, hook135 = 0.75 * Math.PI * rc + e, cogLeg = hook180 - 0.5 * Math.PI * rc;
  return { db: db, dp: dp, fp: dp / db, rc: rc, ro: ro, e: e, hook180: hook180, hook135: hook135, cogLeg: cogLeg, cogDepth: ro + cogLeg, hookWidth: dp + 2 * db, role: role };
}
// Cut length of a bar drawn as a centreline polyline: Σ straight legs, less the corner overshoot at each bend
// (2·rc·tan(θ/2) − rc·θ, i.e. the sharp-corner length replaced by the arc), plus undrawn 135° hook ends on fitments
// (0.75π·rc + e beyond the tangent point, less the rc of straight leg the polyline already counts to the corner).
function cutLength(pts: number[][], g: BendGeom, hookEnds?: number): number {
  let len = 0;
  const segs: { d: number[]; L: number }[] = [];
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]); segs.push({ d: d, L: L }); len += L; }
  for (let i = 1; i < segs.length; i++) {
    const u = segs[i - 1], v = segs[i]; if (!u.L || !v.L) continue;
    const cos = Math.max(-1, Math.min(1, (u.d[0] * v.d[0] + u.d[1] * v.d[1] + u.d[2] * v.d[2]) / (u.L * v.L)));
    const th = Math.acos(cos); if (th < 1e-4 || th > Math.PI - 1e-4) continue;
    len -= 2 * g.rc * Math.tan(th / 2) - g.rc * th;
  }
  if (hookEnds) len += hookEnds * (g.hook135 - g.rc);
  return len;
}
// Shape codes: CIA Z6 core letters (Reinforcement Detailing Handbook ch. 9, via the research note); ZL for cog + crank follows Best Bar's 2024 guide.
const SHAPES: Record<string, string> = { S: "straight", L: "cog one end", LL: "cog both ends", U: "U-bar", CC: "cranked (offset)", ZL: "cog + crank", T: "closed tie, 135° hooks", H: "hook one end", HH: "hook both ends", TB: "tension bar, two legs bent at the anchor" };
// Which code a drawn bar gets, and its bending dimensions measured to the bar extremities (outside), per Australian practice
// (TMR Vol 3 Ch 4 Cl 4.5): a centreline leg + db/2 for each bent corner it touches.
function classify(b: { pts: number[][]; shape: string }, g: BendGeom): ShapeClass {
  const n = b.pts.length - 1, segs: number[] = [];
  for (let i = 0; i < n; i++) { const p = b.pts[i], q = b.pts[i + 1]; segs.push(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])); }
  const out = segs.map((s, i) => Math.round(s + (i > 0 ? g.db / 2 : 0) + (i < n - 1 ? g.db / 2 : 0)));
  const sh = b.shape, flags: string[] = [];
  let code = "S", dims: Dim[] = [];
  const cogCheck = (legOut: number, which: string) => { if (legOut + 0.5 < g.cogDepth) flags.push(which + " cog " + legOut + " is shorter than the AS 3600 standard cog (" + Math.round(g.cogDepth) + " outside) because the slab depth does not allow it"); };
  if (sh === "straight") { code = "S"; dims = [["A", out[0]]]; }
  else if (sh === "cogged one end") { const ci = out[0] < out[n - 1] ? 0 : n - 1, mi = ci === 0 ? 1 : 0; code = "L"; dims = [["A", out[mi]], ["C", out[ci]]]; cogCheck(out[ci], "end"); }
  else if (sh === "cogged both ends") { code = "LL"; dims = [["A", out[1]], ["C", out[0]]]; if (out[n - 1] !== out[0]) dims.push(["C'", out[n - 1]]); cogCheck(Math.min(out[0], out[n - 1]), "end"); }
  else if (sh === "Z-bar") { code = "CC"; dims = [["A", out[0]], ["B", out[1]], ["C", out[2]], ["D", Math.round(Math.abs(b.pts[0][2] - b.pts[n][2]))]]; }
  else if (sh === "cog + Z") { code = "ZL"; dims = [["A", out[0]], ["B", out[1]], ["C", out[2]], ["D", out[3]], ["E", Math.round(Math.abs(b.pts[2][2] - b.pts[3][2]))]]; cogCheck(out[0], "edge"); }
  else if (sh === "closed lig" || sh === "closed tie") { code = "T"; dims = [["A", Math.round(segs[0] + g.db)], ["B", Math.round(segs[1] + g.db)]]; }
  // insert component bars (#33c, Findings 12.5 step 6): a U over an anchor (legs A and C, base B outside) and the
  // two-leg tension bar bent at the anchor's hole (legs A and B outside, the included angle between them)
  else if (sh === "U-bar") { code = "U"; dims = [["A", out[0]], ["B", out[1]], ["C", out[2]]]; }
  else if (sh === "TB") { const u = [b.pts[0][0] - b.pts[1][0], b.pts[0][1] - b.pts[1][1], b.pts[0][2] - b.pts[1][2]], v = [b.pts[2][0] - b.pts[1][0], b.pts[2][1] - b.pts[1][1], b.pts[2][2] - b.pts[1][2]]; const ang = Math.round(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI); code = "TB"; dims = [["A", out[0]], ["B", out[1]], ["angle", ang + "°"]]; }
  // a stair bar bent from a slab leg to the slope (#8): an L whose bend is not a right angle, so the angle is scheduled with the legs
  else if (sh === "stair L") { const u = [b.pts[0][0] - b.pts[1][0], b.pts[0][1] - b.pts[1][1], b.pts[0][2] - b.pts[1][2]], v = [b.pts[2][0] - b.pts[1][0], b.pts[2][1] - b.pts[1][1], b.pts[2][2] - b.pts[1][2]]; const ang = Math.round(Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI); code = "L"; dims = [["A", out[0]], ["C", out[1]], ["angle", ang + "°"]]; }
  else if (sh === "L-bar" || sh === "L starter" || sh === "cogged top") { code = "L"; const ci = out[0] < out[n - 1] ? 0 : n - 1, mi = ci === 0 ? 1 : 0; dims = [["A", out[mi]], ["C", out[ci]]]; if (n > 2) dims = out.map((v, i): Dim => [String.fromCharCode(65 + i), v]); }
  else { code = n <= 1 ? "S" : "V"; dims = out.map((v, i): Dim => [String.fromCharCode(65 + i), v]); }
  return { code: code, name: SHAPES[code] || sh, dims: dims, dimStr: dims.map(d => d[0] + " " + d[1]).join(" · "), flags: flags };
}
const MESH_CODES: string[] = ["SL52", "SL62", "SL72", "SL81", "SL82", "SL92", "SL102", "RL718", "RL818", "RL918", "RL1018", "RL1118", "RL1218", "L8TM", "L11TM", "L12TM"];
const MAT_LAYERS: string[] = ["A", "B", "C", "D"];
const FLOOR_ORDER: string[] = ["BM", "A", "B", "CH", "C", "D", "ST"];   // a floor's fixing order; a stair flight (#8) adds SR after it
const STOCK = 12000;

const fmt = (n: number): string => Math.round(n).toLocaleString("en-AU");
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: unknown): string => String(s).replace(/[&<>"]/g, ch => ESC[ch]);

export { PIN_RULE, pinDia, bendGeom, cutLength, SHAPES, classify, MESH_CODES, MAT_LAYERS, FLOOR_ORDER, STOCK, fmt, esc };
