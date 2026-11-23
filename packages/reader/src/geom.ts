// Plane geometry for the plan reader. Millimetres; pure functions.
import type { Pt } from "./sheet.ts";

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const round = (v: number, step = 1): number => Math.round(v / step) * step;

export interface Box { x0: number; y0: number; x1: number; y1: number }
export const boxOf = (pts: Pt[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};
export const boxW = (b: Box) => b.x1 - b.x0;
export const boxH = (b: Box) => b.y1 - b.y0;
export const boxCentre = (b: Box): Pt => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
export const inBox = (p: Pt, b: Box, tol = 0): boolean => p[0] >= b.x0 - tol && p[0] <= b.x1 + tol && p[1] >= b.y0 - tol && p[1] <= b.y1 + tol;
export const boxesOverlap = (a: Box, b: Box, tol = 0): boolean => a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;
/** Distance from a point to a box (0 inside). */
export const boxDist = (p: Pt, b: Box): number => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));

/** Signed area (counter-clockwise positive). */
export function area(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Point in polygon (even-odd); points on the boundary count as inside within tol. */
export function inPoly(p: Pt, poly: Pt[], tol = 0.5): boolean {
  for (let i = 0; i < poly.length; i++) if (segDist(p, poly[i], poly[(i + 1) % poly.length]) <= tol) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from p to segment ab. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Direction of a segment in degrees, folded to [0, 180). */
export function angleOf(a: Pt, b: Pt): number {
  let d = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  d = ((d % 180) + 180) % 180;
  return d > 179.999 ? 0 : d;
}
export const isHorizontal = (a: Pt, b: Pt, tolDeg = 1): boolean => { const d = angleOf(a, b); return d <= tolDeg || d >= 180 - tolDeg; };
export const isVertical = (a: Pt, b: Pt, tolDeg = 1): boolean => Math.abs(angleOf(a, b) - 90) <= tolDeg;

/** Intersection of segments ab and cd, or null. */
export function segX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r: Pt = [b[0] - a[0], b[1] - a[1]], s: Pt = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

/** Removes repeated points and collinear middle points (within tol mm) from a ring or path. */
export function simplify(pts: Pt[], closed: boolean, tol = 0.5): Pt[] {
  let out = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > tol);
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) <= tol) out = out.slice(0, -1);
  let changed = true;
  while (changed && out.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < (closed ? out.length : out.length - 1); i++) {
      const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
      if (segDist(b, a, c) <= tol) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

/** True when a ring is an axis-aligned rectangle (4 corners after simplifying). */
export function isRect(pts: Pt[], tol = 1): boolean {
  const r = simplify(pts, true, tol);
  if (r.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = r[i], b = r[(i + 1) % 4];
    if (!isHorizontal(a, b, 0.5) && !isVertical(a, b, 0.5)) return false;
  }
  return true;
}

/** True when every edge of a ring is horizontal or vertical. */
export function isOrthogonal(pts: Pt[], tol = 1): boolean {
  const r = simplify(pts, true, tol);
  return r.every((a, i) => { const b = r[(i + 1) % r.length]; return isHorizontal(a, b, 0.5) || isVertical(a, b, 0.5); });
}

/** Points along an arc (degrees, counter-clockwise a0 → a1) at a chord tolerance. */
export function arcPoints(c: Pt, r: number, a0: number, a1: number, chordTol = 2): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 360;
  const step = r > chordTol ? (2 * Math.acos(Math.max(-1, 1 - chordTol / r)) * 180) / Math.PI : 90;
  const n = Math.max(2, Math.ceil(sweep / Math.max(step, 1)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const t = ((a0 + (sweep * i) / n) * Math.PI) / 180; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); }
  return out;
}

/** The median of a list of numbers (0 for none). */
export function median(v: number[]): number {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
