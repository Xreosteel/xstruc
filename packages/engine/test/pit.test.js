// The pit (#43h): a mud trap's base, ramp, walls and internal wall, against the shape of the real job it came from
// (XREO's estimate and schedule for that job: about 4.1 t for the same scope, without the drain-opening bars).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, canonicalOutput, PIT_CFG } from "../src/index.ts";

const pit = (patch = {}) => buildModel({ ...JSON.parse(JSON.stringify(PIT_CFG)), ...patch });
const byLayer = M => M.bars.reduce((o, b) => ((o[b.layer] = (o[b.layer] || 0) + 1), o), {});
const kgOf = (M, layers) => M.bars.filter(b => layers.includes(b.layer)).reduce((s, b) => s + b.kg, 0);

test("the example mud trap builds, in fixing order, with every bar inside the concrete", () => {
  const M = pit();
  assert.deepEqual(M.errors, []);
  assert.equal(M.kind, "pit");
  assert.deepEqual(M.ORDER, ["K", "A", "B", "W", "C", "D", "H", "I", "U"]);
  assert.deepEqual(Object.keys(byLayer(M)).sort(), ["A", "B", "C", "D", "H", "I", "K", "U", "W"]);
  for (const b of M.bars) for (const [x, y, z] of b.pts) {
    assert.ok(x >= 50 - 1e-6 && x <= 4950 + 1e-6 && y >= 50 - 1e-6 && y <= 9375 + 1e-6, "bar " + b.id + " " + b.note + " at " + [x, y, z]);
    assert.ok(z >= -150 + 50 && z <= 2850 - 50 + 1e-6, "bar " + b.id + " z " + z);
  }
  // no piece longer than the 6 m stock, except bent bars (said in a warning when that happens)
  for (const b of M.bars) if (b.shape === "straight") assert.ok(b.len <= 6000, b.note + " " + b.len);
  assert.ok(M.warnings.some(w => /walls drawing/.test(w)) && M.warnings.some(w => /outermost/.test(w)));
});

test("base mats follow the base, up the 45° ramp and along the landing; the outer bars run across", () => {
  const M = pit();
  const A = M.bars.filter(b => b.layer === "A"), B = M.bars.filter(b => b.layer === "B"), D = M.bars.filter(b => b.layer === "D");
  // across bars are straight, cover to cover across the base, at the outer level of each face
  assert.ok(A.every(b => b.pts.length === 2 && b.pts[0][0] === 50 && b.pts[1][0] === 4950));
  assert.ok(A.some(b => b.pts[0][2] === 58) && D.some(b => Math.abs(b.pts[0][2] - 192) < 0.1));
  // on the ramp the across bars rise with it: their height grows 1 : 1 with y between the ramp's toe and top
  const onRamp = A.filter(b => b.pts[0][1] > 6600 && b.pts[0][1] < 8600);
  assert.ok(onRamp.length >= 8 && onRamp.every(b => Math.abs((b.pts[0][2] - onRamp[0].pts[0][2]) - (b.pts[0][1] - onRamp[0].pts[0][1])) < 2));
  // the along bars: one straight piece and one bent at the toe and the top (lapped 650), as XREO scheduled them
  const bent = B.filter(b => b.pts.length === 4);
  assert.ok(bent.length > 0 && B.length === 2 * bent.length);
  const [p0, p1, p2] = bent[0].pts, slope = (p2[2] - p1[2]) / (p2[1] - p1[1]);
  assert.ok(Math.abs(slope - 1) < 1e-6, "45° ramp: " + slope);
  const straight = B.filter(b => b.pts.length === 2 && b.pts[0][0] === bent[0].pts[0][0])[0];
  assert.ok(Math.abs(straight.pts[1][1] - p0[1] - 650) < 1, "lap " + (straight.pts[1][1] - p0[1]));
  // across bars at 200 along the developed base
  const ys = A.filter(b => b.pts[0][2] < 60).map(b => b.pts[0][1]).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - 200) < 10, ys[i] - ys[i - 1] + "");
  // outer "along" swaps the directions
  const S = pit({ outer: "along" });
  assert.ok(S.bars.filter(b => b.layer === "A").some(b => b.pts.length === 4) && S.bars.filter(b => b.layer === "B").every(b => b.pts.length === 2));
});

test("walls: L-bars into the base each face, shorter beside the ramp; horizontals step down to it; U-bars at the end and the heads", () => {
  const M = pit();
  const W = M.bars.filter(b => b.layer === "W");
  assert.ok(W.every(b => b.code === "L" && b.pts.length === 3));
  const west = W.filter(b => b.note.startsWith("west wall"));
  const full = west.filter(b => b.pts[0][1] < 6375), beside = west.filter(b => b.pts[0][1] > 6375);
  assert.ok(full.length > 0 && beside.length > 0);
  assert.ok(new Set(full.map(b => b.len)).size === 1, "full-height verticals all the same");
  const besideLens = [...new Map(beside.sort((a, b) => a.pts[0][1] - b.pts[0][1]).map(b => [b.pts[0][1], b.len])).values()];
  assert.ok(besideLens.length > 5 && besideLens.every((l, i) => i === 0 || l < besideLens[i - 1]), "beside the ramp they get shorter: " + besideLens.join(","));
  // legs 400 into the pit
  assert.ok(west.every(b => Math.abs(b.pts[2][0] - b.pts[1][0] - 400) < 0.5));
  const H = M.bars.filter(b => b.layer === "H");
  const ends = H.filter(b => b.code === "U");
  assert.ok(ends.length > 0 && ends.every(b => Math.abs(b.pts[0][1] - b.pts[1][1] - 650) < 0.5));
  // side wall rows reach further up the ramp the higher they are
  const rows = H.filter(b => /west outer/.test(b.note)).map(b => ({ z: b.pts[0][2], end: Math.max(b.pts[0][1], b.pts[1][1]) }));
  const top = Math.max(...rows.map(r => r.z)), low = Math.min(...rows.map(r => r.z));
  assert.ok(Math.max(...rows.filter(r => r.z === top).map(r => r.end)) > Math.max(...rows.filter(r => r.z === low).map(r => r.end)) + 2000);
  const U = M.bars.filter(b => b.layer === "U");
  assert.ok(U.length > 60 && U.every(b => b.code === "U" && b.size === 12));
  const I = M.bars.filter(b => b.layer === "I");
  assert.ok(I.some(b => b.code === "L") && I.some(b => b.code === "S"));
});

test("steel near XREO's estimate for the same scope", () => {
  // XREO E04 Rev 2: mud trap slab and ramp 1.701 t + walls and wall heads 2.434 t, of which 44 kg are drain-opening
  // trimmers and diagonals the pit does not model yet
  const M = pit();
  const xreo = 1701 + 2434 - 44;
  assert.ok(Math.abs(M.kg - xreo) / xreo < 0.05, "pit " + Math.round(M.kg) + " kg vs XREO " + xreo);
  assert.ok(Math.abs(kgOf(M, ["A", "B", "C", "D", "K"]) - 1701) / 1701 < 0.12, "base " + Math.round(kgOf(M, ["A", "B", "C", "D", "K"])));
});

test("as drawn (8.0 m wide), with no ramp, and bad inputs", () => {
  const wide = pit({ width: 8000 });
  assert.deepEqual(wide.errors, []);
  assert.ok(wide.kg > pit().kg * 1.2);
  const flat = pit({ ramp: null });
  assert.deepEqual(flat.errors, []);
  assert.ok(flat.bars.filter(b => b.layer === "B").every(b => b.pts.length === 2));
  assert.match(pit({ width: 1000 }).errors.join(" "), /between the walls/);
  assert.match(pit({ ramp: { length: 9000, slope: 45, landing: 450 } }).errors.join(" "), /ramp/);
  assert.match(pit({ bars: { base: "N16" } }).errors.join(" "), /spacing/);
  assert.match(pit({ internal: [{ at: 7000, thickness: 200, height: 2000 }] }).errors.join(" "), /runs into the ramp/);
  assert.match(pit({ laps: { "16": 0 } }).errors.join(" "), /no lap given for N16/);
});

test("deterministic", () => {
  assert.equal(canonicalOutput(pit()), canonicalOutput(pit()));
});
