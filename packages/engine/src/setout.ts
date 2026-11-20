import { fmt } from "./bending.ts";

// ---------- setout from grids ---------- (strict TypeScript, backlog #39)

export type GridLine = [string, number];   // [grid name, coordinate mm]
export interface GridRef { v: number; grid: string; at: number; d: number; side: string; text: string }
export interface Axis { X: boolean; a: number; b: number; p: number }
export interface LapZone { end: string; len: number; a: GridRef; b: GridRef; text?: string }
export interface GridSetout { dir: "X" | "Y"; ends: string[]; line: GridRef; from: GridRef; to: GridRef; laps: LapZone[]; lineIndex?: number; n?: number; sp?: number }
export interface SetoutBar { pts: number[][]; col?: unknown; lig?: unknown; tie?: unknown; line?: number; lapPrev?: unknown; lapNext?: unknown; run?: { n?: number; sp?: number } }

// A fixer sets out with a tape from the nearest grid line, not from the slab edge, so every bar in plan carries
// grid-referenced distances (backlog #20): its line across the run direction, both ends along it, and its lap zones.
// G is a grid list [[name, coordinate], …] (GX for x, GY for y); dirs = [positive side, negative side] in plan words.
function nearestGrid(G: GridLine[], v: number, dirs: string[], useGrid?: string | null): GridRef {
  let g = G[0]; G.forEach(q => { if (q[0] === useGrid ? true : (useGrid == null && Math.abs(v - q[1]) < Math.abs(v - g[1]))) g = q; });
  const d = Math.round(v - g[1]), on = Math.abs(d) < 5;
  return { v: Math.round(v), grid: g[0], at: g[1], d: d, side: on ? "" : d > 0 ? dirs[0] : dirs[1], text: on ? "on grid " + g[0] : fmt(Math.abs(d)) + " " + (d > 0 ? dirs[0] : dirs[1]) + " of grid " + g[0] };
}
// Which way a bar runs in plan (from its longest leg), its extent along that way and its line position across it.
// null for bars with no plan axis (starters, column verticals, ties, diagonals).
function barAxis(b: { pts: number[][] }): Axis | null {
  const xs = b.pts.map(p => p[0]), ys = b.pts.map(p => p[1]);
  const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys);
  let best = 0, p: number | null = null, X: boolean | null = null;
  for (let i = 1; i < b.pts.length; i++) { const l = Math.hypot(b.pts[i][0] - b.pts[i - 1][0], b.pts[i][1] - b.pts[i - 1][1]); if (l > best) { best = l; X = Math.abs(b.pts[i][0] - b.pts[i - 1][0]) >= Math.abs(b.pts[i][1] - b.pts[i - 1][1]); p = X ? b.pts[i][1] : b.pts[i][0]; } }
  // a bar 300 or more along one way has a longest leg, so p is set whenever an axis is returned
  if (dx >= 300 && dx > dy * 3) return { X: true, a: Math.min(...xs), b: Math.max(...xs), p: p as number };
  if (dy >= 300 && dy > dx * 3) return { X: false, a: Math.min(...ys), b: Math.max(...ys), p: p as number };
  return null;
}
// b.grid for one bar: { dir, ends, line, from, to, laps[], lineIndex?, n? }; every ref is a nearestGrid() result.
// Lap zones run from the bar end inwards by the lap length (the lapped bar overlaps this zone).
function gridSetout(b: SetoutBar, GX: GridLine[], GY: GridLine[], lap?: number): GridSetout | null {
  const ax = b.col ? null : barAxis(b); if (!ax) return null;   // column bars are set out by their column, not a bar line
  const ref = (v: number, axis: string, useGrid?: string | null): GridRef => axis === "x" ? nearestGrid(GX, v, ["E", "W"], useGrid) : nearestGrid(GY, v, ["N", "S"], useGrid);
  const cross = ax.X ? "y" : "x", along = ax.X ? "x" : "y", ends = ax.X ? ["W", "E"] : ["S", "N"];
  const g: GridSetout = { dir: ax.X ? "X" : "Y", ends: ends, line: ref(ax.p, cross), from: ref(ax.a, along), to: ref(ax.b, along), laps: [] };
  if (b.line && b.run && b.run.n) { g.lineIndex = b.line; g.n = b.run.n; g.sp = b.run.sp; }
  if (lap && !b.lig && !b.tie && !b.col) {
    // both ends of a lap zone are measured from the same grid (the one nearest the bar end) so one tape setting marks the zone
    if (b.lapPrev) g.laps.push({ end: ends[0], len: lap, a: g.from, b: ref(ax.a + lap, along, g.from.grid) });
    if (b.lapNext) g.laps.push({ end: ends[1], len: lap, a: ref(ax.b - lap, along, g.to.grid), b: g.to });
    g.laps.forEach(z => { z.text = fmt(z.len) + " lap at the " + z.end + " end, lap zone " + z.a.text + " to " + z.b.text; });
  }
  return g;
}

export { nearestGrid, barAxis, gridSetout };
