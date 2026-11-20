// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module
import { fmt } from "./bending.ts";
import { barAxis } from "./setout.ts";

// ---------- placing-sheet annotation (backlog #9b) ----------
// Text on the sheet is paper text: sized in plan mm so the layout (and the declutter) is fixed at any zoom, like a
// drawing at scale. 220 mm tag text is 2.2 mm on paper at 1 : 100. Monospace advance ≈ 0.6 em.
const SHEET_TXT = { tag: 220, mark: 150, note: 170, cw: 0.6, pad: 60, gap: 90 };
const txtW = (s, h) => s.length * SHEET_TXT.cw * h + 2 * SHEET_TXT.pad;
const boxHit = (p, q, m) => p.x0 < q.x1 + m && q.x0 < p.x1 + m && p.y0 < q.y1 + m && q.y0 < p.y1 + m;
const boxAt = (cx, cy, w, h) => ({ x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 });
const clampV = (v, a, b) => Math.max(a, Math.min(b, v));
function nearestOnPolys(polys, x, y) {   // nearest point on a set of plan polylines
  let best = null, bd = Infinity;
  polys.forEach(pts => {
    for (let i = 0; i < Math.max(1, pts.length - 1); i++) {
      const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
      const t = L2 ? clampV(((x - p[0]) * dx + (y - p[1]) * dy) / L2, 0, 1) : 0, px = p[0] + t * dx, py = p[1] + t * dy, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = [px, py]; }
    }
  });
  return best;
}
// Run tags of the layer being placed. A run with a distribution line gets its tag beside that line, slid along it
// to find room; one with a tag anchor (Z-bars, trimmers, extras, beams) starts at that anchor and points a leader at
// the nearest of its bars. A tag that cannot sit in its first-choice place is pushed outward and gets a leader to
// its line or bars. No tag of the active layer is ever dropped: the last resort is the first choice, flagged overlap.
const noteBoxes = S => S.notes.forEach(n => { n.h = SHEET_TXT.note; n.box = boxAt(n.x, n.y, txtW(n.text, n.h), n.h * 1.4); });
function sheetTags(M, S) {
  S.tags = []; S.distLines = [];
  // feature notes are paper text too, and tags keep clear of them
  noteBoxes(S);
  if (!S.layer) return;   // the finished floor and the formwork sheet carry no run tags (the 3D view has them)
  const H = SHEET_TXT.tag, bh = H * 1.5, B = S.bounds, placed = S.notes.map(n => n.box);
  const inB = r => r.x0 >= B.x0 && r.x1 <= B.x1 && r.y0 >= B.y0 && r.y1 <= B.y1;
  (S.inserts || []).forEach(q => placed.push(q.boxes[0], q.boxes[1]));   // insert symbols and their labels (#33d)
  if (S.cog) placed.push(S.cog.box);
  const free = r => inB(r) && !placed.some(q => boxHit(r, q, 40));
  const polysOf = r => S.bars.filter(it => !it.ghost && it.bar.run === r).map(it => it.pts);
  const runs = M.runs.filter(r => r.layer === S.layer && r.label && polysOf(r).length);
  runs.sort((p, q) => (!!q.dist - !!p.dist) || (q.kind === "main") - (p.kind === "main") || q.bars.length - p.bars.length || p.id.localeCompare(q.id));
  runs.forEach(r => {
    const w = txtW(r.label, H), tag = { run: r.id, text: r.label, h: H, layer: r.layer, pushed: false, overlap: false, leader: null };
    let box = null, anchor = null;
    if (r.dist) {
      const vert = r.dist.dir === "X";   // bars E-W: the distribution line runs N-S at x = at
      const d = r.dist, at = d.at, p0 = Math.min(d.p0, d.p1), p1 = Math.max(d.p0, d.p1);
      const line = vert ? { x0: at, y0: p0, x1: at, y1: p1 } : { x0: p0, y0: at, x1: p1, y1: at };
      S.distLines.push({ run: r.id, x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1, n: r.grid ? r.grid.n : null });
      const along = t => p0 + clampV(t, 0, 1) * (p1 - p0);
      const centre = (t, side, push) => vert ? [at + side * (SHEET_TXT.gap + w / 2 + push), along(t)] : [along(t), at + side * (SHEET_TXT.gap + bh / 2 + push)];
      const ts = [0]; [0.04, 0.08, 0.12, 0.18, 0.25, 0.33, 0.42, 0.5].forEach(k => ts.push(k, -k));
      const tries = [];
      ts.forEach(k => [1, -1].forEach(side => tries.push({ t: d.frac + k, side: side, push: 0 })));
      for (let k = 1; k <= 10; k++) [1, -1].forEach(side => [0, 0.1, -0.1].forEach(dt => tries.push({ t: d.frac + dt, side: side, push: k * bh, pushed: true })));
      let pick = tries.find(c => { const q = centre(c.t, c.side, c.push); return free(boxAt(q[0], q[1], w, bh)); });
      if (!pick) { pick = tries[0]; tag.overlap = true; }
      const q = centre(pick.t, pick.side, pick.push);
      box = boxAt(q[0], q[1], w, bh);
      anchor = vert ? [at, along(pick.t)] : [along(pick.t), at];
      tag.pushed = !!pick.pushed; tag.dist = true;
      if (tag.pushed) tag.leader = [[clampV(anchor[0], box.x0, box.x1), clampV(anchor[1], box.y0, box.y1)], anchor];
    } else {
      const tp = r.tagPos || midOfPolys(polysOf(r)), target = nearestOnPolys(polysOf(r), tp[0], tp[1]);
      const tries = [[0, 0, false]];
      for (let k = 1; k <= 8; k++) [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(u => tries.push([u[0] * k * (w * 0.55), u[1] * k * bh * 1.1, true]));
      let pick = tries.find(o => free(boxAt(tp[0] + o[0], tp[1] + o[1], w, bh)));
      if (!pick) { pick = tries[0]; tag.overlap = true; }
      box = boxAt(tp[0] + pick[0], tp[1] + pick[1], w, bh); anchor = target; tag.pushed = pick[2]; tag.dist = false;
      const e = [clampV(target[0], box.x0, box.x1), clampV(target[1], box.y0, box.y1)];
      if (Math.hypot(e[0] - target[0], e[1] - target[1]) > 20) tag.leader = [e, target];
    }
    tag.box = box; tag.x = (box.x0 + box.x1) / 2; tag.y = (box.y0 + box.y1) / 2; tag.anchor = anchor;
    placed.push(box); S.tags.push(tag);
  });
}
function midOfPolys(polys) { const all = [].concat(...polys); return [all.reduce((s, p) => s + p[0], 0) / all.length, all.reduce((s, p) => s + p[1], 0) / all.length]; }
// Lap zones of the layer being placed, one per zone (the two lapped bars share it): a segment on the bar line from
// b.grid.laps (#20), so the sheet and the inspector give the same zone.
function sheetLaps(S) {
  S.laps = [];
  const seen = {};
  S.bars.forEach(it => {
    const b = it.bar; if (it.ghost || !b.grid || !b.grid.laps.length) return;
    const ax = barAxis(b); if (!ax) return;
    b.grid.laps.forEach(z => {
      const a = Math.min(z.a.v, z.b.v), c = Math.max(z.a.v, z.b.v), key = (ax.X ? "X" : "Y") + "|" + Math.round(ax.p) + "|" + a + "|" + c;
      if (seen[key]) { if (seen[key].bars.indexOf(b.id) < 0) seen[key].bars.push(b.id); return; }
      const L = ax.X ? { x0: a, y0: ax.p, x1: c, y1: ax.p } : { x0: ax.p, y0: a, x1: ax.p, y1: c };
      seen[key] = Object.assign({ dir: ax.X ? "X" : "Y", len: z.len, bars: [b.id], layer: b.layer, run: b.run.id, text: fmt(z.len) + " LAP" }, L);
      S.laps.push(seen[key]);
    });
  });
}
// Bar marks beside the bars of each run on a one-layer sheet; the viewer shows the selected run's set. Every distinct
// mark in a run gets a label (its first bar goes first and slides along the bar to find room); repeats of a mark are
// kept only where they do not collide, so a long mat reads "A12 A12 A13 …" along its bars without overprinting.
function sheetMarks(S) {
  S.runMarks = {};
  if (!S.layer) return;
  const H = SHEET_TXT.mark, bh = H * 1.4, byRun = {};
  S.bars.forEach(it => { if (!it.ghost && it.bar.mark && !it.point) (byRun[it.bar.run.id] = byRun[it.bar.run.id] || []).push(it); });
  Object.keys(byRun).forEach(rid => {
    const items = byRun[rid], out = [], placed = [], firsts = {}, order = [];
    items.forEach(it => { if (!firsts[it.bar.mark]) { firsts[it.bar.mark] = true; order.push([it, true]); } });
    items.forEach(it => { if (order.every(o => o[0] !== it)) order.push([it, false]); });
    order.forEach(([it, first]) => {
      if (it.bar.wire && !first) return;   // a mesh sheet (#33) is labelled once, not along every wire
      let si = 0, sl = -1;   // the bar's longest plan leg carries the label
      for (let i = 1; i < it.pts.length; i++) { const l = Math.hypot(it.pts[i][0] - it.pts[i - 1][0], it.pts[i][1] - it.pts[i - 1][1]); if (l > sl) { sl = l; si = i; } }
      const p = it.pts[si - 1], q = it.pts[si], ux = (q[0] - p[0]) / sl, uy = (q[1] - p[1]) / sl, horiz = Math.abs(ux) >= Math.abs(uy);
      const w = txtW(it.bar.mark, H), off = (horiz ? bh : w) / 2 + it.w + 20;
      const at = f => { const x = p[0] + ux * sl * f, y = p[1] + uy * sl * f; return horiz ? [x, y + off] : [x + off, y]; };
      const fr = first ? [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9] : [0.5];
      let c = fr.map(at).find(xy => !placed.some(r => boxHit(boxAt(xy[0], xy[1], w, bh), r, 10)));
      let overlap = false;
      if (!c) { if (!first) return; c = at(0.5); overlap = true; }
      const box = boxAt(c[0], c[1], w, bh); placed.push(box);
      out.push({ bar: it.bar.id, mark: it.bar.mark, x: c[0], y: c[1], h: H, box: box, first: first, overlap: overlap });
    });
    S.runMarks[rid] = out;
  });
}

export { SHEET_TXT, txtW, boxHit, boxAt, clampV, nearestOnPolys, noteBoxes, sheetTags, midOfPolys, sheetLaps, sheetMarks };
