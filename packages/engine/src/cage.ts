// A footing cage (#44): a rectangular footing block reinforced as a cage: bars top and bottom cogged at both ends,
// closed ligs with 135° hooks, and single-leg ties. A precast or cast-in-place footing for plant (a generator, a
// transformer) is often detailed this way. Coordinates are in millimetres: x along the block (0 … length), y across it
// (0 … width), z up from its underside. Every size, bar and detail is an input. The examples (CAGE_EXAMPLES F1, F2, F3)
// are XReo's sample cages for a real job, set out and bent as XReo's sample cage sheet has them (Rev A, 25 Nov 2026),
// and they reproduce its schedule: F1 64 pieces 81.40 kg, F2 22 pieces 55.33 kg, F3 20 pieces 47.35 kg.
//
// Set-out, as the sample sheet draws it:
// - Ligs: the centreline sits at cover + d/2 from each face, bent on a 4d pin (AS 3600 Cl 17.2.3.2, fitments of D500N).
// - Corner bars sit in the ligs' bends. A bar's centre is (pin/2 − bar radius) from the bend's centre, along the
//   diagonal. The other bars sit on the lig, evenly spaced between the corners.
// - Bottom bars (B1): cogs turn up, the cog's outside face at cover from the end.
// - Top bars (B2): cogs turn down, one bottom-bar diameter further in, so their cogs sit beside the B1 cogs.
// - Lig sets: evenly spaced at the largest spacing or less. The first and last sit just clear (2 mm) of the B2 cogs.
// - Ties: beside each lig on the side facing the middle of the block.
// Cut lengths come from bending.ts (centreline, corners as arcs, 135° hooks), rounded up to 5 mm, as the sheet's are.
import { KGM } from "./constants.ts";
import { bendGeom, classify, cutLength, type BendGeom } from "./bending.ts";
import { parseCallout } from "./grammar.ts";

type P2 = [number, number];
type P3 = [number, number, number];

export interface CageInput {
  kind: "cage";
  name: string;
  /** The concrete block: length (x), width (y) and depth (z). */
  length: number;
  width: number;
  depth: number;
  /** Cover to the outside of the ligs on every face, and to the bars' cogs at the ends. */
  cover: number;
  /** Bottom and top bars in the drawing's words: count and size, e.g. "5N12". */
  bottom: string;
  top: string;
  /** The 90° cogs at both ends of both layers: the outside length in mm, or "standard" (the AS 3600 standard cog). */
  cog: number | "standard";
  /** Closed ligs: size and the largest spacing, e.g. "N12-150". */
  ligs: string;
  /** The straight tails past the 135° hooks of ligs and ties, in lig diameters (the sample sheet: 10). */
  tailDb: number;
  /** The centre of the first and last lig set from the ends; null: just clear of the top bars' cogs. */
  ligFirst: number | null;
  /** Single-leg ties in each set: on the second bar in from each side ("outer"), on the middle bars ("middle"), none. */
  ties: "outer" | "middle" | "none";
  /** The middle top bar's centre from the side face, moved to clear the lift anchors; null: evenly spaced. */
  midTop: number | null;
  /** Cast-in lift anchors on a line along the block, at these distances from one end (y null: on the centreline). */
  anchors: { name: string; at: number[]; y: number | null; length: number; dia: number; recess: number; note: string; supply: string } | null;
  /** Cast-in locator pins at [x, y]: diameter, embedment, height above the top, and the clear distance wanted to the bars. */
  pins: { name: string; at: P2[]; dia: number; embed: number; proud: number; clear: number; qty: string; note: string; supply: string } | null;
  /** Other cast-ins and accessories, listed with the schedule. */
  items: { item: string; qty: string; where: string; supply: string }[];
  /** What the detailer read from the drawing or changed, for the engineer to confirm: they become warnings. */
  holds: string[];
}

const ITEMS: CageInput["items"] = [
  { item: "Earthing lug", qty: "1", where: "Top face, as shown on the section", supply: "By others" },
  { item: "50 mm bar chairs and side spacers", qty: "As needed", where: "Chairs under the bottom bars at about 1 m spacing, spacers on the sides and ends", supply: "XReo, confirm with the client" },
  { item: "Tie wire", qty: "As needed", where: "Every corner bar to every lig, every second crossing elsewhere", supply: "XReo" }
];
const ANCHOR = (L: number): CageInput["anchors"] => ({ name: "Swift lift anchor 2.5 t (2FA090H)", at: [300, L - 300], y: null, length: 110, dia: 14, recess: 15, note: "On the width centreline, 300 min from each end. Lift at 25 MPa or more.", supply: "By others unless agreed" });
const PIN = { name: "Galvanised R16 locator pin", dia: 16, embed: 200, proud: 75, clear: 50, supply: "By others unless agreed" };
const COGS = (c: number) => "Cogs: the drawing says \"standard cog\"; full-depth cogs (" + c + " outside) are used instead, which are longer than standard. Top and bottom cogs sit side by side.";

/** XReo's sample cages (see the module comment). The holds are the sample sheet's hold points before the inspection. */
export const CAGE_EXAMPLES: Record<"F1" | "F2" | "F3", CageInput> = {
  F1: {
    kind: "cage", name: "F1 footing", length: 2650, width: 900, depth: 350, cover: 50,
    bottom: "5N12", top: "5N12", cog: 230, ligs: "N12-150", tailDb: 10, ligFirst: null, ties: "outer", midTop: 510,
    anchors: ANCHOR(2650),
    pins: { ...PIN, at: [[98, 200]], qty: "Per layout (1 or 2)", note: "200 min embedment, about 75 above the top, 50 clear to the reo ±10. Hold only with galvanised steel." },
    items: ITEMS,
    holds: [
      "Ligs and ties: the drawing calls for N10; they are made in N12 because XReo does not stock N10. Get the engineer's OK in writing (for N10, change the ligs to N10-150).",
      "Ties: \"3N10-150 LIGS\" is read from the section as 1 closed lig + 2 single-leg ties per set. Confirm with the engineer.",
      COGS(230)
    ]
  },
  F2: {
    kind: "cage", name: "F2 footing", length: 1500, width: 900, depth: 600, cover: 50,
    bottom: "5N16", top: "5N16", cog: 480, ligs: "N12-300", tailDb: 10, ligFirst: null, ties: "middle", midTop: 490,
    anchors: ANCHOR(1500),
    pins: { ...PIN, at: [[200, 324]], qty: "Per the footing plan", note: "200 min embedment, about 75 above the top, 50 clear to the reo ±10. Shown at a typical position only." },
    items: ITEMS,
    holds: [
      "Ties: \"N12-300 LIGS\" has no count. It is read from the section as 1 closed lig + 1 single-leg tie on the middle bars per set. Confirm with the engineer.",
      COGS(480),
      "Middle top bar: moved 40 off centre to clear the lift anchor. Confirm the anchor type and length.",
      "Locator pins: the plan puts them near the ends, between the first two lig sets. Check they still get 50 clear to the bars once their positions are confirmed."
    ]
  },
  F3: {
    kind: "cage", name: "F3 footing", length: 1200, width: 900, depth: 600, cover: 50,
    bottom: "5N16", top: "5N16", cog: 480, ligs: "N12-300", tailDb: 10, ligFirst: null, ties: "middle", midTop: 490,
    anchors: ANCHOR(1200), pins: null,
    items: ITEMS,
    holds: [
      "Ties: \"N12-300 LIGS\" has no count. It is read from the section as 1 closed lig + 1 single-leg tie on the middle bars per set. Confirm with the engineer.",
      COGS(480),
      "Middle top bar: moved 40 off centre to clear the lift anchor. Confirm the anchor type and length.",
      "Anchors and ligs: check the lig sets next to the anchors once the anchor positions are confirmed."
    ]
  }
};
export const CAGE_CFG: CageInput = CAGE_EXAMPLES.F1;

export const CAGE_LAYERS = [
  { id: "B1", name: "Bottom bars (B1)", short: "B1 bottom", css: "#9aa7b4" },
  { id: "B2", name: "Top bars (B2)", short: "B2 top", css: "#4f8fe8" },
  { id: "L1", name: "Closed ligs (L1)", short: "L1 ligs", css: "#e5534b" },
  { id: "T1", name: "Single-leg ties (T1)", short: "T1 ties", css: "#3fc1c9" }
];
const ORDER = CAGE_LAYERS.map(l => l.id);

/** A cast-in item listed with the schedule, and the pieces of it the 3D view draws (axis from a to b, radius r). */
export interface CastIn { item: string; qty: string; where: string; supply: string }
export interface CastInPart { item: string; a: P3; b: P3; r: number }

// ---- geometry
type Cmd = ["s", number] | ["a", number, number];   // a straight of a length; an arc of a radius turning by degrees (+ left)
/** A centreline in a plane from a start point and heading: straights and arcs, the arcs as short chords. */
function walk(p: P2, heading: number, cmds: Cmd[]): P2[] {
  const pts: P2[] = [[p[0], p[1]]];
  let x = p[0], y = p[1], a = (heading * Math.PI) / 180;
  for (const c of cmds) {
    if (c[0] === "s") { x += Math.cos(a) * c[1]; y += Math.sin(a) * c[1]; pts.push([x, y]); continue; }
    const r = c[1], da = (c[2] * Math.PI) / 180, s = Math.sign(da);
    const cx = x + Math.cos(a + (s * Math.PI) / 2) * r, cy = y + Math.sin(a + (s * Math.PI) / 2) * r;
    const st = Math.atan2(y - cy, x - cx), n = Math.max(4, Math.ceil(Math.abs(c[2]) / 15));
    for (let i = 1; i <= n; i++) { const t = st + (da * i) / n; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); }
    x = pts[pts.length - 1][0]; y = pts[pts.length - 1][1]; a += da;
  }
  return pts;
}
const r1 = (v: number) => Math.round(v * 10) / 10;
const R = (p: number[]): P3 => [r1(p[0]), r1(p[1]), r1(p[2])];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** The closest distance between two segments (Ericson, Real-Time Collision Detection, 5.1.9). */
function segDist(p1: P3, q1: P3, p2: P3, q2: P3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-9 && e <= 1e-9) return Math.sqrt(dot(r, r));
  if (a <= 1e-9) t = clamp(f / e);
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) s = clamp(-c / a);
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  const w = sub([p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]);
  return Math.sqrt(dot(w, w));
}

export function buildCage(input: Partial<CageInput>) {
  const cfg: CageInput = { ...CAGE_CFG, ...input } as CageInput;
  const errors: string[] = [], warnings: string[] = [];
  const L = +cfg.length, W = +cfg.width, H = +cfg.depth, c = +cfg.cover;
  const num = (v: unknown) => Number.isFinite(+(v as number)) && +(v as number) > 0;
  for (const [k, v] of Object.entries({ length: L, width: W, depth: H, cover: c, tailDb: cfg.tailDb })) if (!num(v)) errors.push("Cage " + k + ": a positive number is needed.");
  const bar = (what: string, text: string, need: "count" | "spacing") => {
    const p = parseCallout(String(text || ""), { scheme: "TB" });
    if (p.error || p.kind !== "bar" || !p.size || !p.type) { errors.push("Cage " + what + " \"" + text + "\": not a bar callout (" + (p.error || "no bar size") + ")."); return null; }
    if (need === "count" && !(p.count && p.count >= 2)) { errors.push("Cage " + what + " \"" + text + "\": give the number of bars, at least 2 (e.g. 5N12)."); return null; }
    if (need === "spacing" && !p.spacing) { errors.push("Cage " + what + " \"" + text + "\": give the largest spacing (e.g. N12-150)."); return null; }
    if (!KGM[p.type + p.size]) { errors.push("Cage " + what + " \"" + text + "\": no mass for " + p.type + p.size + "."); return null; }
    return { type: p.type as string, d: p.size as number, n: p.count ?? 0, sp: p.spacing ?? 0, text: String(text) };
  };
  const bB = bar("bottom bars", cfg.bottom, "count"), bT = bar("top bars", cfg.top, "count"), bL = bar("ligs", cfg.ligs, "spacing");
  if (cfg.ties !== "outer" && cfg.ties !== "middle" && cfg.ties !== "none") errors.push("Cage ties: outer, middle or none.");
  if (errors.length || !bB || !bT || !bL) return result([], [], [], [], [], {});

  // ---- the lig and where the bars sit in it
  const dl = bL.d, gL: BendGeom = bendGeom(bL.type, dl, "fitment");
  const tail = +cfg.tailDb * dl;
  const gHook: BendGeom = { ...gL, e: tail, hook135: 0.75 * Math.PI * gL.rc + tail };   // the sheet's 135° hooks: tails of tailDb·d
  const e = c + dl / 2;              // lig centreline from each face
  const bend = e + gL.rc;            // the centre of a lig bend from the two faces
  const inner = gL.dp / 2;           // the bend's inside radius
  if (W - 2 * e < 4 * gL.rc || H - 2 * e < 4 * gL.rc) errors.push("Cage: the block is too small for " + bL.type + dl + " ligs with " + c + " cover.");
  const seat = (rb: number) => Math.max(c + dl + rb, bend - (inner - rb) / Math.SQRT2);   // a corner bar's centre from both faces
  const layer = (b: NonNullable<typeof bB>, top: boolean, mid: number | null) => {
    const rb = b.d / 2, cc = seat(rb), n = b.n;
    const ys = Array.from({ length: n }, (_, i) => cc + ((W - 2 * cc) * i) / (n - 1));
    if (top && mid != null) {
      if (n % 2 === 0) errors.push("Cage: the middle top bar can only be moved when there is an odd number of top bars.");
      else {
        const k = (n - 1) / 2, lo = ys[k - 1] + b.d, hi = ys[k + 1] - b.d;
        if (!(+mid > lo && +mid < hi)) errors.push("Cage: the middle top bar at " + mid + " from the side face clashes with its neighbours (keep it between " + Math.ceil(lo) + " and " + Math.floor(hi) + ").");
        else ys[k] = +mid;
      }
    }
    const zs = ys.map((_, i) => { const corner = i === 0 || i === n - 1; return top ? H - (corner ? cc : c + dl + rb) : corner ? cc : c + dl + rb; });
    if ((W - 2 * cc) / (n - 1) < 2 * b.d) errors.push("Cage: " + n + " " + b.type + b.d + " bars do not fit across " + W + " with " + c + " cover.");
    return { ys, zs, rb };
  };
  const lb = layer(bB, false, null), lt = layer(bT, true, cfg.midTop ?? null);
  const gB = bendGeom(bB.type, bB.d, "main"), gT = bendGeom(bT.type, bT.d, "main");
  const cogOf = (g: BendGeom) => (cfg.cog === "standard" ? Math.ceil(g.cogDepth / 5) * 5 : +cfg.cog);
  const CB = cogOf(gB), CT = cogOf(gT);
  if (!(CB > 0) || !(CT > 0)) errors.push("Cage cog: a length in mm or \"standard\".");
  const xB = c + bB.d / 2, xT = c + bB.d + bT.d / 2;   // the cogs' centrelines from the ends: B1 outermost, B2 beside it
  const tipB = Math.max(...lb.zs) - lb.rb + CB, tipT = Math.min(...lt.zs) + lt.rb - CT;
  if (tipB > H - c + 0.5) errors.push("Cage: the bottom bars' " + CB + " cogs reach " + Math.round(tipB) + " up, past the top cover (" + (H - c) + "); at most " + Math.floor(CB - (tipB - (H - c))) + ".");
  if (tipT < c - 0.5) errors.push("Cage: the top bars' " + CT + " cogs reach " + Math.round(H - tipT) + " down, past the bottom cover; at most " + Math.floor(CT - (c - tipT)) + ".");
  // lig sets along the block
  const first = cfg.ligFirst != null ? +cfg.ligFirst : c + bB.d + bT.d + dl / 2 + 2;
  if (!(first > 0) || L - 2 * first < 0) errors.push("Cage: the first lig set at " + first + " from the ends leaves no room for the others.");
  if (cfg.ties === "outer" && Math.min(bB.n, bT.n) < 4) errors.push("Cage: ties on the second bar in from each side need at least 4 bars in each layer.");
  if (cfg.ties === "middle" && (bB.n % 2 === 0 || bT.n % 2 === 0)) errors.push("Cage: ties on the middle bars need an odd number of bars in each layer.");
  if (errors.length) return result([], [], [], [], [], {});
  const nSets = Math.ceil((L - 2 * first) / bL.sp - 1e-9) + 1;
  const ligX = Array.from({ length: nSets }, (_, i) => (nSets === 1 ? L / 2 : first + ((L - 2 * first) * i) / (nSets - 1)));
  const pitch = nSets > 1 ? (L - 2 * first) / (nSets - 1) : 0;

  // ---- concrete
  const solids = [{ kind: "footing", axis: "z" as const, outline: [[0, 0], [L, 0], [L, W], [0, W]] as P2[], holes: [] as P2[][], z0: 0, z1: H }];

  // ---- bars
  const bars: any[] = [], runs: any[] = [];   // the model shape shared with the other elements (types.ts Bar / Run)
  const addRun = (r: Record<string, unknown>): any => { const run = { id: "R" + runs.length, bars: [] as unknown[], ...r }; runs.push(run); return run; };
  const addBar = (run: any, type: string, size: number, pts: P3[], path: P3[], shape: string, g: BendGeom, setout: string, note: string, hookEnds = 0, bent?: { len: number; code: string; dims: [string, number][] }) => {
    const b: any = { id: bars.length, layer: run.layer, run, size, type, shape, pts: pts.map(R), path: path.map(R), setout, note, geom: g, hookEnds };
    b.len = Math.ceil((bent ? bent.len : cutLength(b.pts, g, hookEnds)) / 5) * 5;
    b.kg = (b.len / 1000) * (KGM[type + size] || 0);
    if (bent) { b.code = bent.code; b.shapeName = "hook both ends"; b.dims = bent.dims; b.dimStr = bent.dims.map(d => d[0] + " " + d[1]).join(" · "); b.flags = []; }
    else { const cl = classify(b, g); b.code = cl.code; b.shapeName = cl.name; b.dims = cl.dims; b.dimStr = cl.dimStr; b.flags = cl.flags; }
    bars.push(b); run.bars.push(b);
    return b;
  };
  const ord = (i: number, n: number) => "bar " + (i + 1) + " of " + n;
  // bottom bars, cogs up; top bars, cogs down beside them
  for (const [lay, b, g, ly, x0, C, up] of [["B1", bB, gB, lb, xB, CB, true], ["B2", bT, gT, lt, xT, CT, false]] as const) {
    const run = addRun({ layer: lay, size: b.d, type: b.type, sp: 0, label: b.n + b.type + b.d + " " + (up ? "bottom" : "top"), callout: b.text + " " + (up ? "bottom" : "top") + ", cogged " + (up ? "up" : "down") + " both ends (" + C + " outside)", tagPos: [L / 2, W, up ? 0 : H] });
    ly.ys.forEach((y, i) => {
      const z = ly.zs[i], tip = up ? z - ly.rb + C : z + ly.rb - C, rc = g.rc;
      const leg = Math.abs(tip - z) - rc, span = L - 2 * x0 - 2 * rc;
      const path = walk([x0, tip], up ? -90 : 90, [["s", leg], ["a", rc, up ? 90 : -90], ["s", span], ["a", rc, up ? 90 : -90], ["s", leg]]).map(([x, zz]) => [x, y, zz] as P3);
      const moved = !up && cfg.midTop != null && i === (b.n - 1) / 2;
      addBar(run, b.type, b.d, [[x0, y, tip], [x0, y, z], [L - x0, y, z], [L - x0, y, tip]], path, "cogged both ends", g,
        (up ? "Bottom " : "Top ") + ord(i, b.n) + ", " + Math.round(y) + " from the side face" + (moved ? " (moved to clear the lift anchors)" : "") + (i === 0 || i === b.n - 1 ? ", in the lig corners" : ""),
        "Cogged " + (up ? "up" : "down") + " both ends, " + C + " outside, on a " + g.dp + " pin (5d, AS 3600 Cl 17.2.3.2)." + (up ? "" : " " + bB.d + " shorter each end than B1 so its cogs sit beside the B1 cogs."));
    });
  }
  // closed ligs: 135° hooks at a top corner, the corner alternating set to set; the back hook stepped one diameter along
  {
    const run = addRun({ layer: "L1", size: dl, type: bL.type, sp: bL.sp, label: nSets + " × " + bL.type + dl + " ligs", callout: bL.text + " closed ligs, " + nSets + " sets at " + Math.round(pitch) + " centres (" + bL.sp + " max), 135° hooks with " + tail + " tails", tagPos: [ligX[Math.min(1, nSets - 1)], 0, H] });
    const hs = H - 2 * bend, ws = W - 2 * bend, rc = gL.rc;
    const fw = walk([e, H - bend], -90, [["s", hs], ["a", rc, 90], ["s", ws], ["a", rc, 90], ["s", hs], ["a", rc, 90], ["s", ws], ["a", rc, 135], ["s", tail]]);
    const bk = walk([e, H - bend], 90, [["a", rc, -135], ["s", tail]]).reverse();
    ligX.forEach((x, j) => {
      const flip = j % 2 === 1, Y = (u: number) => (flip ? W - u : u);
      const path: P3[] = [...bk.map(([u, v], i) => [x + dl * (1 - i / (bk.length - 1)), Y(u), v] as P3), ...fw.slice(1).map(([u, v]) => [x, Y(u), v] as P3)];
      addBar(run, bL.type, dl, [[x, e, e], [x, W - e, e], [x, W - e, H - e], [x, e, H - e], [x, e, e]], path, "closed lig", gHook,
        "Set " + (j + 1) + " of " + nSets + ", " + Math.round(x) + " from the end",
        "Closed lig bent on a " + gL.dp + " pin (4d, AS 3600 Cl 17.2.3.2), two 135° hooks with " + tail + " tails at a top corner, the corner alternating set to set.", 2);
    });
  }
  // single-leg ties: hooked round a bottom bar and a top bar, leaning when the top bar is moved
  if (cfg.ties !== "none") {
    const pairs: [number, number][] = cfg.ties === "outer" ? [[1, 1], [bB.n - 2, bT.n - 2]] : [[(bB.n - 1) / 2, (bT.n - 1) / 2]];
    const which = cfg.ties === "outer" ? "bars 2 and " + (bB.n - 1) : "the middle bars";
    const run = addRun({ layer: "T1", size: dl, type: bL.type, sp: bL.sp, label: nSets * pairs.length + " × " + bL.type + dl + " ties", callout: bL.type + dl + " single-leg ties on " + which + ", " + pairs.length + " per set, 135° hooks with " + tail + " tails", tagPos: [ligX[Math.max(0, nSets - 2)], W / 2, H] });
    const hs = H - 2 * bend, rc = gL.rc, legC = H - 2 * e;
    const tieLen = cutLength([[0, 0, 0], [0, 0, legC]], gHook, 2);   // bent straight: a lean to a moved top bar is taken up in the hooks
    for (const [x, j] of ligX.map((x, j) => [x, j] as const)) {
      const tx = x < L / 2 ? x + dl : x - dl;
      for (const [ib, it] of pairs) {
        // the leg on the bar's outer side and the hooks' tails towards the middle of the width, so a tie on the far
        // half is the mirror image of one on the near half (and its tails stay clear of the ligs' hooks)
        const yb = lb.ys[ib], yt = lt.ys[it], m = yb > W / 2 + 1 ? -1 : 1;
        const f = walk([yb - rc, H - bend], -90, [["s", hs], ["a", rc, 135], ["s", tail]]);
        const k = walk([yb - rc, H - bend], 90, [["a", rc, -135], ["s", tail]]).reverse();
        const path = [...k, ...f.slice(1)].map(([u, v]) => [tx, yb + m * (u - yb) + ((v - bend) / hs) * (yt - yb), v] as P3);
        addBar(run, bL.type, dl, [[tx, yb - m * rc, e], [tx, yt - m * rc, H - e]], path, "single-leg tie", gHook,
          "Set " + (j + 1) + ", beside the lig on the side facing the middle, round bottom bar " + (ib + 1) + " and top bar " + (it + 1),
          "Single-leg tie, two 135° hooks with " + tail + " tails on a " + gL.dp + " pin" + (Math.abs(yt - yb) > 1 ? "; it leans " + Math.round(Math.abs(yt - yb)) + " to the moved top bar." : "."), 2,
          { len: tieLen, code: "HH", dims: [["A", Math.round(legC + dl)]] });
      }
    }
  }

  // ---- bars that run into each other (steel through steel): every pair of drawn centrelines closer than the two radii
  {
    const box = bars.map(b => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (const p of b.path as P3[]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } return { lo, hi }; });
    const found = new Map<string, { n: number; a: any; b: any }>();
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) {
      const A = bars[i], B = bars[j], gap = A.size / 2 + B.size / 2 - 1, P = box[i], Q = box[j];
      if ([0, 1, 2].some(k => P.lo[k] > Q.hi[k] + gap || Q.lo[k] > P.hi[k] + gap)) continue;
      let hit = false;
      for (let s = 1; s < A.path.length && !hit; s++) {
        const a0 = A.path[s - 1], a1 = A.path[s];
        if ([0, 1, 2].some(k => Math.min(a0[k], a1[k]) > Q.hi[k] + gap || Math.max(a0[k], a1[k]) < Q.lo[k] - gap)) continue;
        for (let t = 1; t < B.path.length; t++) if (segDist(a0, a1, B.path[t - 1], B.path[t]) < gap) { hit = true; break; }
      }
      if (!hit) continue;
      const key = A.layer === B.layer ? A.layer : [A.layer, B.layer].sort((x: string, y: string) => ORDER.indexOf(y) - ORDER.indexOf(x)).join(" into ");
      const f = found.get(key) ?? { n: 0, a: A, b: B };
      f.n++; found.set(key, f);
    }
    for (const [key, f] of found) {
      let hint = "";
      if (key === "B2 into B1") {
        // a top bar's cog beside a bottom bar's cog, at the same place across, runs down into the bottom bar's bend: the
        // longest top-bar cog that stops on that bend
        const same = lt.ys.map((yt, i) => [i, lb.ys.findIndex(yb => Math.abs(yb - yt) < (bB.d + bT.d) / 2)]).filter(([, ib]) => ib >= 0);
        const most = Math.min(...same.map(([it, ib]) => lt.zs[it] + lt.rb - (lb.zs[ib] + gB.rc)));
        hint = " Where a top bar is above a bottom bar, its cog beside the bottom bar's cog runs down into that bar's bend. Stop the B2 cogs at " + Math.floor(most / 5) * 5 + " outside or less, or set the top bars beside the bottom bars across: which is wanted?";
      }
      warnings.push("Bars clash: " + key + ", " + f.n + " pair" + (f.n === 1 ? "" : "s") + " of bars (the first: " + f.a.setout.split(",")[0].toLowerCase() + " and " + f.b.setout.split(",")[0].toLowerCase() + ")." + hint);
    }
  }

  // ---- cast-ins: drawn, listed, and the pins checked for clearance to the bars
  const castins: CastIn[] = [], parts: CastInPart[] = [];
  const nearest = (a: P3, b: P3, r: number) => {
    let best = { clear: Infinity, bar: null as any };
    for (const bar of bars) for (let i = 1; i < bar.path.length; i++) {
      const d = segDist(a, b, bar.path[i - 1], bar.path[i]) - r - bar.size / 2;
      if (d < best.clear) best = { clear: d, bar };
    }
    return best;
  };
  const where = (bar: any) => bar.layer + (bar.layer === "L1" || bar.layer === "T1" ? " at " + Math.round(bar.pts[0][0]) + " from the end" : "");
  if (cfg.anchors) {
    const A = cfg.anchors, y = A.y ?? W / 2, notes: string[] = [];
    for (const x of A.at) {
      const z1 = H - A.recess, z0 = z1 - A.length;
      parts.push({ item: A.name, a: [x, y, z0], b: [x, y, z1], r: A.dia / 2 }, { item: A.name, a: [x, y, z0], b: [x, y, z0 + 8], r: A.dia }, { item: A.name, a: [x, y, z1 - 8], b: [x, y, z1], r: A.dia * 0.85 });
      const n = nearest([x, y, z0], [x, y, z1], A.dia / 2), set = ligX.reduce((m, lx) => Math.min(m, Math.abs(lx - x)), Infinity);
      notes.push("at " + x + ": the nearest lig set " + Math.round(set) + " away, " + Math.max(0, Math.round(n.clear)) + " clear to " + where(n.bar));
    }
    castins.push({ item: A.name, qty: String(A.at.length), where: A.note + " As modelled, " + notes.join("; ") + ".", supply: A.supply });
  }
  if (cfg.pins && cfg.pins.at.length) {
    const P = cfg.pins;
    for (const [x, y] of P.at) {
      parts.push({ item: P.name, a: [x, y, H - P.embed], b: [x, y, H + P.proud], r: P.dia / 2 });
      const n = nearest([x, y, H - P.embed], [x, y, H], P.dia / 2);
      if (n.bar && n.clear < P.clear) warnings.push("Locator pin at " + x + ", " + y + ": " + (n.clear < 0.5 ? "it touches the " + where(n.bar) : Math.round(n.clear) + " clear to the " + where(n.bar)) + "; " + P.clear + " clear is wanted.");
    }
    castins.push({ item: P.name, qty: P.qty, where: P.note, supply: P.supply });
  }
  for (const it of cfg.items || []) castins.push({ ...it });
  for (const h of cfg.holds || []) warnings.push(h);
  return result(bars, runs, solids, castins, parts, { ligX: ligX.map(r1), pitch: r1(pitch), across: { bottom: lb.ys.map(r1), top: lt.ys.map(r1) } });

  function result(bs: any[], rs: any[], ss: typeof solids, ci: CastIn[], cp: CastInPart[], extra: Record<string, unknown>) {
    // marks: the layer's name (B1, B2, L1, T1); a layer with bars of more than one length or shape gets B1a, B1b …
    const byLayer = new Map<string, Map<string, any[]>>();
    for (const b of bs) {
      const k = b.type + b.size + "|" + b.code + "|" + b.len + "|" + b.dimStr;
      if (!byLayer.has(b.layer)) byLayer.set(b.layer, new Map());
      const g = byLayer.get(b.layer)!;
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(b);
    }
    const marks: any[] = [];
    for (const id of ORDER) {
      const groups = [...(byLayer.get(id)?.values() ?? [])];
      groups.forEach((list, i) => {
        const m = groups.length === 1 ? id : id + String.fromCharCode(97 + i);
        list.forEach(b => { b.mark = m; });
        marks.push({ mark: m, type: list[0].type, size: list[0].size, shape: list[0].shape, code: list[0].code, shapeName: list[0].shapeName, dims: list[0].dims, dimStr: list[0].dimStr, flags: list[0].flags, pin: list[0].geom.dp, len: list[0].len, qty: list.length, layer: id, kg: list.reduce((s, b) => s + b.kg, 0) });
      });
    }
    rs.forEach(r => { r.marks = [...new Set(r.bars.map((b: any) => b.mark))]; r.n = r.bars.length; });
    const kg = bs.reduce((s, b) => s + b.kg, 0);
    const SL = { x0: 0, y0: 0, x1: L || 0, y1: W || 0 };
    const LBY = Object.fromEntries(CAGE_LAYERS.map((l, i) => [l.id, { ...l, idx: i }]));
    return {
      kind: "cage" as const, cfg, name: cfg.name, errors, warnings, bars: bs, runs: rs, marks, sched: bs, kg, kgBars: kg, kgMesh: 0, meshPieces: [], wires: [], chairs: [],
      solids: ss, castins: ci, castinParts: cp, SL, EXT: SL, T: H, C: c, GX: [], GY: [], LAYERS: CAGE_LAYERS, LBY, ORDER,
      cage: { length: L, width: W, depth: H, cover: c, sets: bs.filter(b => b.layer === "L1").length, ...extra }
    };
  }
}
