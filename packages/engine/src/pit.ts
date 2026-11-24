// A pit (#43h): an in-ground box with a base slab, walls on three sides, a ramp up out of the open end, and
// internal walls across it, as a mud trap, wash-down sump or settling pit is built. Coordinates in millimetres:
// x across the pit (0 … width), y along it (0 at the closed end … length at the ramp end), z up from the underside of
// the flat base. Every size, bar and detail is an input; the example (PIT_CFG) is the mud trap of a real XREO job
// with the values XREO's estimate allowed (the walls drawing was not supplied, so those values are XREO's stated
// allowances, not the engineer's: check them against the walls drawing).
import { KGM } from "./constants.ts";
import { bendGeom, classify, cutLength } from "./bending.ts";
import { parseCallout } from "./grammar.ts";

export interface PitInput {
  kind: "pit";
  name: string;
  /** Schedule mark prefix (MT01, MT02 …). */
  mark: string;
  /** Outside sizes of the base, toe to toe: across (x) and along (y). */
  width: number;
  length: number;
  /** How far the base runs past the walls' outer faces. */
  toe: number;
  /** Base and ramp slab thickness, and the base's depth under the walls and toes (a thickening below). */
  base: number;
  underWall: number;
  wall: number;
  /** Wall height above the top of the base. */
  height: number;
  /** The ramp at the open end: its length on plan and its slope in degrees; the flat landing beyond its top. */
  ramp: { length: number; slope: number; landing: number } | null;
  /** Internal walls across the pit: clear distance from the end wall's inner face, thickness, height. */
  internal: { at: number; thickness: number; height: number }[];
  cover: number;
  /** Laps by bar size (mm), and the stock length bars are cut from. */
  laps: Record<string, number>;
  stock: number;
  /** Callouts in the drawing's words. */
  bars: { base: string; walls: string; internal: string; head: string; thickening: string };
  /** Which base bars sit outermost (top and bottom): across the pit or along it. The drawing does not say. */
  outer: "across" | "along";
  /** Wall vertical bars: the leg into the base; wall-head U-bars: the leg down each face. */
  leg: number;
  headLeg: number;
  /** End wall horizontals are U-bars whose legs run this far along the side walls (a lap into them). */
  cornerLeg: number;
}

/** The mud trap of a real job, with the values XREO's estimate allowed (Rev 2): see the module comment. */
export const PIT_CFG: PitInput = {
  kind: "pit", name: "Mud trap", mark: "MT",
  width: 5000, length: 9425, toe: 200,
  base: 250, underWall: 400, wall: 250, height: 2600,
  ramp: { length: 2600, slope: 45, landing: 450 },
  internal: [{ at: 1500, thickness: 200, height: 2000 }],
  cover: 50, laps: { "12": 500, "16": 650 }, stock: 6000,
  bars: { base: "N16-200 TOP & BOT", walls: "N16-200 EW EF", internal: "N16-200 EW EF", head: "N12-300", thickening: "2-N12" },
  outer: "across", leg: 400, headLeg: 350, cornerLeg: 650
};

type P3 = [number, number, number];
type P2 = [number, number];

export const PIT_LAYERS = [
  { id: "K", name: "Thickening bars", short: "Thickening", css: "#9aa7b4" },
  { id: "A", name: "Base bottom, outer (B1)", short: "A · B1", css: "#4f8fe8" },
  { id: "B", name: "Base bottom, inner (B2)", short: "B · B2", css: "#3fc1c9" },
  { id: "W", name: "Wall verticals (into the base)", short: "Wall verticals", css: "#b48cf0" },
  { id: "C", name: "Base top, inner (T2)", short: "C · T2", css: "#e8a33d" },
  { id: "D", name: "Base top, outer (T1)", short: "D · T1", css: "#e5534b" },
  { id: "H", name: "Wall horizontals", short: "Wall horizontals", css: "#8fd17a" },
  { id: "I", name: "Internal wall", short: "Internal wall", css: "#f0d24a" },
  { id: "U", name: "Wall-head U-bars", short: "Head U-bars", css: "#f78fb3" }
];
const ORDER = PIT_LAYERS.map(l => l.id);

/** A concrete piece for the viewer: an outline extruded along an axis (z: plan outline; x: a section along y–z). */
export interface Solid { kind: string; axis: "x" | "z"; outline: P2[]; holes: P2[][]; z0: number; z1: number }

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a: P3) => Math.hypot(a[0], a[1], a[2]);
const polyLen = (pts: P3[]) => pts.reduce((s, p, i) => (i ? s + len3(sub(p, pts[i - 1])) : s), 0);

/** The part of a polyline between two distances along it. */
function cutPolyline(pts: P3[], from: number, to: number): P3[] {
  const out: P3[] = [];
  let s = 0;
  const at = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = len3(sub(b, a));
    const s0 = s, s1 = s + L;
    if (s1 >= from && s0 <= to && L > 0) {
      if (!out.length) out.push(at(a, b, Math.max(0, (from - s0) / L)));
      if (s1 <= to) out.push(b); else { out.push(at(a, b, (to - s0) / L)); break; }
    }
    s = s1;
  }
  return out.filter((p, i) => i === 0 || len3(sub(p, out[i - 1])) > 0.5);
}

/** Bars longer than stock, cut into pieces that overlap by the lap; cuts kept clear of bends. */
function stockPieces(pts: P3[], stock: number, lap: number): P3[][] {
  const L = polyLen(pts);
  if (L <= stock + 0.5) return [pts];
  const n = Math.ceil((L - lap) / (stock - lap));
  const step = (L + (n - 1) * lap) / n;   // equal pieces
  const out: P3[][] = [];
  for (let k = 0; k < n; k++) { const a = k * (step - lap), b = k === n - 1 ? L : a + step; out.push(cutPolyline(pts, a, b)); }
  return out;
}

export function buildPit(input: Partial<PitInput>) {
  const cfg: PitInput = { ...PIT_CFG, ...input, bars: { ...PIT_CFG.bars, ...(input.bars ?? {}) }, laps: { ...PIT_CFG.laps, ...(input.laps ?? {}) } } as PitInput;
  if (input.ramp === null) cfg.ramp = null;
  const errors: string[] = [], warnings: string[] = [];
  const W = +cfg.width, L = +cfg.length, toe = +cfg.toe, tb = +cfg.base, tu = +cfg.underWall, tw = +cfg.wall, H = +cfg.height, c = +cfg.cover;
  const num = (v: unknown) => Number.isFinite(+(v as number)) && +(v as number) > 0;
  for (const [k, v] of Object.entries({ width: W, length: L, base: tb, wall: tw, height: H, cover: c, stock: cfg.stock })) if (!num(v)) errors.push("Pit " + k + ": a positive number is needed.");
  if (!(toe >= 0)) errors.push("Pit toe: zero or more.");

  // bars from the callouts
  const bar = (what: string, text: string, needSpacing: boolean) => {
    const p = parseCallout(String(text || ""), { scheme: "TB" });
    if (p.error || p.kind !== "bar" || !p.size || !p.type) { errors.push("Pit " + what + " bars \"" + text + "\": not a bar callout (" + (p.error || "no bar size") + ")."); return null; }
    if (needSpacing && !p.spacing) { errors.push("Pit " + what + " bars \"" + text + "\": give the spacing (e.g. N16-200)."); return null; }
    if (!KGM[p.type + p.size]) { errors.push("Pit " + what + " bars \"" + text + "\": no mass for " + p.type + p.size + "."); return null; }
    return { type: p.type as string, d: p.size as number, sp: p.spacing ?? 0, count: p.count ?? 0, text: String(text) };
  };
  const bBase = bar("base", cfg.bars.base, true), bWall = bar("wall", cfg.bars.walls, true), bInt = bar("internal wall", cfg.bars.internal, true);
  const bHead = cfg.bars.head ? bar("wall-head U-", cfg.bars.head, true) : null, bThk = cfg.bars.thickening ? bar("thickening", cfg.bars.thickening, false) : null;
  const lapOf = (d: number) => {
    const v = +cfg.laps[String(d)];
    if (!(v > 0)) { errors.push("Pit: no lap given for N" + d + " bars."); return 0; }
    return v;
  };

  // geometry
  const ramp = cfg.ramp;
  const slope = ramp ? (+ramp.slope * Math.PI) / 180 : 0, tanS = Math.tan(slope), cosS = Math.cos(slope);
  const landing = ramp ? +ramp.landing : 0;
  const yr1 = ramp ? L - landing : L, yr0 = ramp ? yr1 - +ramp.length : L;
  const rise = ramp ? +ramp.length * tanS : 0;
  const xi0 = toe + tw, xi1 = W - toe - tw, yEnd0 = toe, yEnd1 = toe + tw;   // inner faces of the side walls; the end wall
  const ztop = tb + H;
  if (ramp && !(+ramp.slope > 0 && +ramp.slope <= 60)) errors.push("Pit ramp slope: between 0 and 60 degrees.");
  if (xi1 - xi0 < 600) errors.push("Pit: the width leaves " + Math.round(xi1 - xi0) + " between the walls; at least 600 is needed.");
  if (ramp && yr0 < yEnd1 + 600) errors.push("Pit: the ramp (" + ramp.length + " on plan) leaves no floor at the bottom; the pit is " + L + " long.");
  if (tb < 2 * c + 4 * (bBase?.d ?? 16)) errors.push("Pit base " + tb + " thick: too thin for two mats each face with " + c + " cover.");
  if (tw < 2 * c + 4 * (bWall?.d ?? 16)) errors.push("Pit walls " + tw + " thick: too thin for two layers each face with " + c + " cover.");
  if (ramp && Math.abs(rise - H) > 1 && rise > H) warnings.push("Pit ramp rises " + Math.round(rise) + ", more than the walls' " + H + "; the ramp top stands above the walls.");
  const internals = (cfg.internal || []).map((iw, k) => {
    const y0 = yEnd1 + +iw.at, y1 = y0 + +iw.thickness;
    if (!(+iw.thickness > 0 && +iw.height > 0)) errors.push("Pit internal wall " + (k + 1) + ": give its thickness and height.");
    if (y1 > yr0 - 300) errors.push("Pit internal wall " + (k + 1) + " at " + iw.at + " runs into the ramp.");
    if (+iw.height > H) warnings.push("Pit internal wall " + (k + 1) + " is higher than the walls.");
    return { y0, y1, t: +iw.thickness, h: +iw.height };
  });
  if (errors.length || !bBase || !bWall || !bInt) return result([], [], []);

  // ---- concrete
  const tv = ramp ? tb / cosS : tb;   // the ramp slab's vertical thickness
  const solids: Solid[] = [];
  const section: P2[] = ramp
    ? [[0, 0], [yr0 + (tv - tb) / tanS, 0], [Math.min(L, yr1 + (tv - tb) / tanS), rise], [L, rise], [L, tb + rise], [yr1, tb + rise], [yr0, tb], [0, tb]]
    : [[0, 0], [L, 0], [L, tb], [0, tb]];
  solids.push({ kind: "base and ramp", axis: "x", outline: section, holes: [], z0: 0, z1: W });
  const dd = tu - tb;
  if (dd > 0) {
    const flatEnd = ramp ? yr0 : L;
    solids.push({ kind: "thickening", axis: "z", outline: [[0, 0], [xi0, 0], [xi0, flatEnd], [0, flatEnd]], holes: [], z0: -dd, z1: 0 });
    solids.push({ kind: "thickening", axis: "z", outline: [[xi1, 0], [W, 0], [W, flatEnd], [xi1, flatEnd]], holes: [], z0: -dd, z1: 0 });
    solids.push({ kind: "thickening", axis: "z", outline: [[xi0, 0], [xi1, 0], [xi1, yEnd1], [xi0, yEnd1]], holes: [], z0: -dd, z1: 0 });
  }
  const sideWall: P2[] = ramp ? [[yEnd0, tb], [yr0, tb], [yr1, Math.min(ztop, tb + rise)], ...(tb + rise < ztop ? [[yr1, ztop] as P2] : []), [yEnd0, ztop]] : [[yEnd0, tb], [L - toe, tb], [L - toe, ztop], [yEnd0, ztop]];
  solids.push({ kind: "wall", axis: "x", outline: sideWall, holes: [], z0: toe, z1: xi0 });
  solids.push({ kind: "wall", axis: "x", outline: sideWall, holes: [], z0: xi1, z1: W - toe });
  solids.push({ kind: "wall", axis: "z", outline: [[toe, yEnd0], [W - toe, yEnd0], [W - toe, yEnd1], [toe, yEnd1]], holes: [], z0: tb, z1: ztop });
  for (const iw of internals) solids.push({ kind: "internal wall", axis: "z", outline: [[xi0, iw.y0], [xi1, iw.y0], [xi1, iw.y1], [xi0, iw.y1]], holes: [], z0: tb, z1: tb + iw.h });

  // ---- bars
  const bars: any[] = [], runs: any[] = [];   // the model shape shared with floors and panels (types.ts Bar / Run)
  const addRun = (r: Record<string, unknown>): any => { const run = { id: "R" + runs.length, bars: [] as unknown[], ...r }; runs.push(run); return run; };
  const addBar = (run: any, pts: P3[], shape: string, note: string, lap = 0) => {
    const size = run.size as number, type = run.type as string;
    for (const piece of lap ? stockPieces(pts, +cfg.stock, lap) : [pts]) {
      if (piece.length < 2) continue;
      const b: any = { id: bars.length, layer: run.layer, run, size, type, shape: piece.length === 2 ? "straight" : shape, pts: piece.map(p => p.map(v => Math.round(v * 10) / 10)), setout: note, note };
      b.geom = bendGeom(type, size, "main");
      b.geomLen = Math.round(polyLen(piece));
      b.len = Math.ceil(cutLength(b.pts, b.geom, 0) / 5) * 5;
      b.kg = (b.len / 1000) * (KGM[type + size] || 0);
      const cl = classify(b, b.geom);
      b.code = cl.code; b.shapeName = cl.name; b.dims = cl.dims; b.dimStr = cl.dimStr; b.flags = cl.flags;
      if (b.len > +cfg.stock + 0.5) warnings.push("Pit: a " + run.label + " bar is " + b.len + " long, over the " + cfg.stock + " stock length (a bent bar is not cut).");
      bars.push(b); run.bars.push(b);
    }
  };
  const evenly = (a: number, b: number, sp: number): number[] => {   // positions from a to b at about sp, ends included
    if (b - a < 1) return [a];
    const n = Math.max(1, Math.ceil((b - a) / sp - 1e-9));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };

  // base: four mats following the base, up the ramp and onto the landing; outer layers A (bottom) and D (top)
  const dB = bBase.d, lapB = lapOf(dB);
  const outerAcross = cfg.outer !== "along";
  const mats = [
    { id: "A", top: false, depth: c + dB / 2, across: outerAcross },
    { id: "B", top: false, depth: c + dB * 1.5, across: !outerAcross },
    { id: "C", top: true, depth: c + dB * 1.5, across: !outerAcross },
    { id: "D", top: true, depth: c + dB / 2, across: outerAcross }
  ];
  // the line of a mat in the y–z section: flat, up the ramp, along the landing
  const matPath = (top: boolean, depth: number): P2[] => {
    if (!ramp) return [[c, top ? tb - depth : depth], [L - c, top ? tb - depth : depth]];
    const zFlat = top ? tb - depth : depth, zLand = top ? tb + rise - depth : rise + depth;
    const off = top ? -depth / cosS : -tv + depth / cosS;   // the ramp line, offset from the top surface z = tb + (y − yr0)·tan
    const yA = yr0 + (zFlat - tb - off) / tanS, yB = yr0 + (zLand - tb - off) / tanS;
    return [[c, zFlat], [yA, zFlat], [yB, zLand], [L - c, zLand]];
  };
  const along2 = (path: P2[], s: number): P2 => {
    let acc = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + l >= s || i === path.length - 1) { const t = l ? Math.min(1, (s - acc) / l) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
      acc += l;
    }
    return path[path.length - 1];
  };
  const pathLen = (path: P2[]) => path.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : s), 0);
  for (const m of mats) {
    const path = matPath(m.top, m.depth);
    const face = m.top ? "top" : "bottom", way = m.across ? "across" : "along";
    const run = addRun({ layer: m.id, size: dB, type: bBase.type, sp: bBase.sp, label: bBase.type + dB + "-" + bBase.sp + " " + (m.top ? "T" : "B") + (m.id === "A" || m.id === "D" ? "1" : "2") + " " + way, callout: bBase.text + " · " + face + " " + (m.id === "A" || m.id === "D" ? "outer" : "inner") + " layer, bars " + way + " the pit", dir: m.across ? "X" : "Y" });
    if (m.across) {
      const S = pathLen(path);
      for (const s of evenly(dB / 2, S - dB / 2, bBase.sp)) {
        const [y, z] = along2(path, s);
        addBar(run, [[c, y, z], [W - c, y, z]], "straight", face + " bar across at " + Math.round(y) + " from the end wall's outside", lapB);
      }
      const mid = along2(path, S * 0.35);
      run.tagPos = [W * 0.3, mid[0], mid[1]];
    } else {
      for (const x of evenly(c + dB / 2, W - c - dB / 2, bBase.sp)) addBar(run, path.map(([y, z]) => [x, y, z] as P3), "cranked", face + " bar along, " + Math.round(x) + " from the west edge", lapB);
      run.tagPos = [W * 0.6, path[0][0] + 1500, path[0][1]];
    }
  }

  // thickening bars under the walls (2-N12 continuous): two bars along the bottom of each thickening
  if (bThk && dd > 0) {
    const n = Math.max(1, bThk.count || 2), d = bThk.d, z = -dd + c + d / 2, lap = lapOf(d);
    const run = addRun({ layer: "K", size: d, type: bThk.type, sp: 0, label: n + "-" + bThk.type + d + " thickening", callout: bThk.text + " in the thickening under each wall" });
    const flatEnd = ramp ? yr0 : L;
    const across = (a: number, b: number) => (n === 1 ? [(a + b) / 2] : evenly(a, b, Math.max(1, (b - a) / (n - 1))).slice(0, n));
    for (const x of across(c + d / 2, xi0 - c - d / 2)) addBar(run, [[x, c, z], [x, flatEnd - c, z]], "straight", "thickening, west wall", lap);
    for (const x of across(xi1 + c + d / 2, W - c - d / 2)) addBar(run, [[x, c, z], [x, flatEnd - c, z]], "straight", "thickening, east wall", lap);
    for (const y of across(c + d / 2, yEnd1 - c - d / 2)) addBar(run, [[c, y, z], [W - c, y, z]], "straight", "thickening, end wall", lap);
    run.tagPos = [toe, flatEnd * 0.5, -dd];
  }

  // the level of the base's bottom mat where a wall stands (the wall verticals' legs sit on it)
  const legZ = (y: number) => {
    const zFlat = c + 2 * dB + bWall.d / 2;
    if (!ramp || y <= yr0) return zFlat;
    const zr = tb + (Math.min(y, yr1) - yr0) * tanS - tv + (c + 2 * dB + bWall.d / 2) / cosS;
    return Math.max(zFlat, Math.min(rise + c + 2 * dB + bWall.d / 2, zr));
  };
  const rampTop = (y: number) => (!ramp ? tb : y <= yr0 ? tb : y >= yr1 ? tb + rise : tb + (y - yr0) * tanS);
  const dW = bWall.d, lapW = lapOf(dW), sW = bWall.sp;
  const zTopBar = ztop - c - dW / 2;
  const legLen = +cfg.leg;
  // wall verticals: L-bars, both faces, the leg into the base towards the inside of the pit
  {
    const run = addRun({ layer: "W", size: dW, type: bWall.type, sp: sW, label: bWall.type + dW + "-" + sW + " verticals EF", callout: bWall.text + " · verticals each face, L-bars with a " + legLen + " leg into the base" });
    const yEndV = (ramp ? yr1 : L - toe) - c - dW / 2;
    for (const [side, xo, xi, s] of [["west", toe + c + dW / 2, xi0 - c - dW / 2, 1], ["east", W - toe - c - dW / 2, xi1 + c + dW / 2, -1]] as [string, number, number, number][]) {
      for (const y of evenly(yEnd0 + c + dW / 2, yEndV, sW)) {
        const zb = legZ(y);
        if (zTopBar - zb < 300) continue;
        for (const [x, face] of [[xo, "outer"], [xi, "inner"]] as [number, string][]) addBar(run, [[x, y, zTopBar], [x, y, zb], [x + s * legLen, y, zb]], "L-bar", side + " wall, " + face + " face, " + Math.round(y) + " from the end wall's outside" + (y > yr0 ? " (beside the ramp)" : ""));
      }
    }
    for (const x of evenly(toe + c + dW / 2, W - toe - c - dW / 2, sW)) {
      for (const [y, face] of [[yEnd0 + c + dW / 2, "outer"], [yEnd1 - c - dW / 2, "inner"]] as [number, string][]) {
        if (face === "inner" && (x < xi0 - c || x > xi1 + c)) continue;
        addBar(run, [[x, y, zTopBar], [x, y, legZ(0)], [x, y + legLen, legZ(0)]], "L-bar", "end wall, " + face + " face, " + Math.round(x) + " from the west edge");
      }
    }
    run.tagPos = [toe, (yEnd1 + yr0) / 2, ztop];
  }
  // wall horizontals, inside the verticals: side walls straight, stepping down beside the ramp; the end wall's as
  // U-bars whose legs run along the side walls
  {
    const run = addRun({ layer: "H", size: dW, type: bWall.type, sp: sW, label: bWall.type + dW + "-" + sW + " horizontals EF", callout: bWall.text + " · horizontals each face, end wall U-bars lapping " + cfg.cornerLeg + " into the side walls" });
    const zs = evenly(tb + sW / 2, ztop - c - dW * 1.5, sW);
    for (const z of zs) {
      const yStart = yEnd0 + c + dW * 1.5;
      const yStop = ramp ? Math.min(yr1, yr0 + Math.max(0, z - tb) / (tanS || 1)) - c : L - toe - c;
      if (yStop - yStart < 300) continue;
      for (const [x, wall] of [[toe + c + dW * 1.5, "west outer"], [xi0 - c - dW * 1.5, "west inner"], [W - toe - c - dW * 1.5, "east outer"], [xi1 + c + dW * 1.5, "east inner"]] as [number, string][]) {
        addBar(run, [[x, yStart, z], [x, yStop, z]], "straight", wall + " face, " + Math.round(z - tb) + " above the base", lapW);
      }
      const leg = +cfg.cornerLeg;
      const yo = yEnd0 + c + dW * 1.5, yi = yEnd1 - c - dW * 1.5;
      const xo0 = toe + c + dW * 2.5, xo1 = W - toe - c - dW * 2.5, xn0 = xi0 - c - dW * 2.5, xn1 = xi1 + c + dW * 2.5;
      addBar(run, [[xo0, yo + leg, z], [xo0, yo, z], [xo1, yo, z], [xo1, yo + leg, z]], "U-bar", "end wall, outer face, " + Math.round(z - tb) + " above the base");
      addBar(run, [[xn0, yi + leg, z], [xn0, yi, z], [xn1, yi, z], [xn1, yi + leg, z]], "U-bar", "end wall, inner face, " + Math.round(z - tb) + " above the base");
    }
    run.tagPos = [W - toe, (yEnd1 + yr0) / 2, tb + H * 0.6];
  }
  // internal walls: verticals each face (legs into the base, away from the wall), horizontals into the side walls
  internals.forEach((iw, k) => {
    const d = bInt.d, sp = bInt.sp, zt = tb + iw.h - c - d / 2;
    const run = addRun({ layer: "I", size: d, type: bInt.type, sp, label: "Internal wall " + bInt.type + d + "-" + sp + " EF", callout: bInt.text + " · internal wall " + (k + 1) + ", " + iw.t + " thick, " + iw.h + " high" });
    for (const x of evenly(xi0 + c + d / 2, xi1 - c - d / 2, sp)) {
      addBar(run, [[x, iw.y0 + c + d / 2, zt], [x, iw.y0 + c + d / 2, legZ(0)], [x, iw.y0 + c + d / 2 - legLen, legZ(0)]], "L-bar", "internal wall, south face");
      addBar(run, [[x, iw.y1 - c - d / 2, zt], [x, iw.y1 - c - d / 2, legZ(0)], [x, iw.y1 - c - d / 2 + legLen, legZ(0)]], "L-bar", "internal wall, north face");
    }
    for (const z of evenly(tb + sp / 2, zt - d, sp)) for (const y of [iw.y0 + c + d * 1.5, iw.y1 - c - d * 1.5]) {
      addBar(run, [[toe + c + 2 * dW + d / 2, y, z], [W - toe - c - 2 * dW - d / 2, y, z]], "straight", "internal wall, into both side walls", lapOf(d));
    }
    run.tagPos = [W / 2, iw.y1, tb + iw.h];
  });
  // wall-head U-bars over the side walls and the end wall
  if (bHead) {
    const d = bHead.d, sp = bHead.sp, z = ztop - c - d / 2, legH = +cfg.headLeg;
    const run = addRun({ layer: "U", size: d, type: bHead.type, sp, label: bHead.type + d + "-" + sp + " head U-bars", callout: bHead.text + " U-bars over the wall heads, legs " + legH + " down each face" });
    const inset = c + dW + d / 2;   // inside the vertical bars
    const yStop = (ramp ? yr1 : L - toe) - sp / 2;
    for (const y of evenly(yEnd0 + sp / 2, yStop, sp)) for (const [xa, xb] of [[toe + inset, xi0 - inset], [W - toe - inset, xi1 + inset]] as [number, number][]) {
      if (ztop - rampTop(y) < legH + 100) continue;   // the wall has run out beside the ramp's top
      addBar(run, [[xa, y, z - legH], [xa, y, z], [xb, y, z], [xb, y, z - legH]], "U-bar", "wall head, side wall");
    }
    for (const x of evenly(xi0 + sp / 2, xi1 - sp / 2, sp)) addBar(run, [[x, yEnd0 + inset, z - legH], [x, yEnd0 + inset, z], [x, yEnd1 - inset, z], [x, yEnd1 - inset, z - legH]], "U-bar", "wall head, end wall");
    run.tagPos = [toe, yEnd1 + 500, ztop];
  }

  // what was assumed, said where an engineer will see it
  warnings.push("Pit: the base bars run under the walls to the toes; the wall verticals stand on the bottom mat with a " + legLen + " leg into the base; the end wall's horizontals are U-bars lapping " + cfg.cornerLeg + " into the side walls; the internal wall's horizontals run into the side walls. Check these against the walls drawing.");
  warnings.push("Pit: the base's outer bars run " + (outerAcross ? "across" : "along") + " the pit (top and bottom); the drawing does not say which way is outermost.");
  return result(bars, runs, solids);

  function result(bs: any[], rs: any[], ss: Solid[]) {
    // marks: one per distinct bar (size, shape, length, dims), numbered in fixing order
    const groups = new Map<string, any[]>();
    for (const b of bs) { const k = b.type + b.size + "|" + b.code + "|" + b.len + "|" + b.dimStr; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(b); }
    const pad = (i: number) => (i < 10 ? "0" : "") + i;
    const marks = [...groups.values()].sort((P, Q) => ORDER.indexOf(P[0].layer) - ORDER.indexOf(Q[0].layer) || Q[0].size - P[0].size || Q[0].len - P[0].len).map((list, i) => {
      const m = cfg.mark + pad(i + 1);
      list.forEach(b => { b.mark = m; });
      return { mark: m, type: list[0].type, size: list[0].size, shape: list[0].shape, code: list[0].code, shapeName: list[0].shapeName, dims: list[0].dims, dimStr: list[0].dimStr, flags: list[0].flags, pin: list[0].geom.dp, len: list[0].len, qty: list.length, layer: list[0].layer, kg: list.reduce((s, b) => s + b.kg, 0) };
    });
    rs.forEach(r => { r.marks = [...new Set(r.bars.map((b: any) => b.mark))]; r.n = r.bars.length; });
    const kg = bs.reduce((s, b) => s + b.kg, 0);
    const SL = { x0: 0, y0: 0, x1: W || 0, y1: L || 0 };
    const LBY = Object.fromEntries(PIT_LAYERS.map((l, i) => [l.id, { ...l, idx: i }]));
    return {
      kind: "pit" as const, cfg, name: cfg.name, errors, warnings, bars: bs, runs: rs, marks, sched: bs, kg, kgBars: kg, kgMesh: 0, meshPieces: [], wires: [], chairs: [],
      solids: ss, SL, EXT: SL, T: tb, C: c, GX: [], GY: [], LAYERS: PIT_LAYERS, LBY, ORDER,
      pit: { width: W, length: L, toe, base: tb, underWall: tu, wall: tw, height: H, rampFrom: yr0, rampTo: yr1, rise, internals }
    };
  }
}
