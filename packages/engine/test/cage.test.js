// Footing cages (#44): the sample cages F1–F3 reproduce XReo's sample cage sheet (Rev A) mark for mark, the bars sit
// inside the concrete where the sheet sets them out, and the checks (clashes, pin clearance, bad inputs) work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel, CAGE_EXAMPLES, canonicalOutput } from "../src/index.ts";

const sheet = {
  F1: { kg: 81.40, pieces: 64, marks: { B1: ["N12", "LL", 2960, 5, 13.14], B2: ["N12", "LL", 2935, 5, 13.03], L1: ["N12", "T", 2335, 18, 37.32], T1: ["N12", "HH", 560, 36, 17.90] },
        ligs: [82, 228, 374, 521, 667, 813, 959, 1106, 1252, 1398, 1544, 1691, 1837, 1983, 2129, 2276, 2422, 2568], bottom: [73, 262, 450, 638, 827], top: [73, 262, 510, 638, 827] },
  F2: { kg: 55.33, pieces: 22, marks: { B1: ["N16", "LL", 2290, 5, 18.09], B2: ["N16", "LL", 2255, 5, 17.81], L1: ["N12", "T", 2835, 6, 15.10], T1: ["N12", "HH", 810, 6, 4.32] },
        ligs: [90, 354, 618, 882, 1146, 1410], bottom: [75, 262, 450, 638, 825], top: [75, 262, 490, 638, 825] },
  F3: { kg: 47.35, pieces: 20, marks: { B1: ["N16", "LL", 1990, 5, 15.72], B2: ["N16", "LL", 1955, 5, 15.44], L1: ["N12", "T", 2835, 5, 12.59], T1: ["N12", "HH", 810, 5, 3.60] },
        ligs: [90, 345, 600, 855, 1110], bottom: [75, 262, 450, 638, 825], top: [75, 262, 490, 638, 825] }
};

test("F1, F2 and F3 reproduce the sample sheet's schedule and set-out", () => {
  for (const [k, s] of Object.entries(sheet)) {
    const M = buildModel(CAGE_EXAMPLES[k]);
    assert.deepEqual(M.errors, [], k);
    assert.equal(M.kind, "cage");
    assert.equal(M.bars.length, s.pieces, k + " pieces");
    assert.equal(M.kg.toFixed(2), s.kg.toFixed(2), k + " kg");
    assert.deepEqual(M.marks.map(m => m.mark), Object.keys(s.marks), k + " marks");
    for (const m of M.marks) {
      const [size, code, len, qty, kg] = s.marks[m.mark];
      assert.deepEqual([m.type + m.size, m.code, m.len, m.qty, +m.kg.toFixed(2)], [size, code, len, qty, kg], k + " " + m.mark);
    }
    const near = (a, b, what) => { assert.equal(a.length, b.length, what); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 0.6, what + " " + v + " vs " + b[i])); };
    near(M.cage.ligX, s.ligs, k + " lig set-out");
    near(M.cage.across.bottom, s.bottom, k + " bottom set-out");
    near(M.cage.across.top, s.top, k + " top set-out");
  }
  // the sheet's dims: outside lengths, 800 × 250 ligs, 250 ties
  const M = buildModel(CAGE_EXAMPLES.F1), dims = Object.fromEntries(M.marks.map(m => [m.mark, m.dimStr]));
  assert.deepEqual(dims, { B1: "A 2550 · C 230", B2: "A 2526 · C 230", L1: "A 800 · B 250", T1: "A 250" });
});

test("the sheet's N10 alternative: L1 cut 2300, T1 cut 510", () => {
  const M = buildModel({ ...CAGE_EXAMPLES.F1, ligs: "N10-150" });
  assert.deepEqual(M.marks.filter(m => m.mark === "L1" || m.mark === "T1").map(m => [m.mark, m.type + m.size, m.len, m.qty]), [["L1", "N10", 2300, 18], ["T1", "N10", 510, 36]]);
});

test("bars sit inside the block with cover; corner bars sit in the lig bends", () => {
  for (const k of ["F1", "F2", "F3"]) {
    const M = buildModel(CAGE_EXAMPLES[k]), { length: L, width: W, depth: H, cover: c } = M.cage;
    for (const b of M.bars) for (const p of b.path) {
      const r = b.size / 2 - 0.6;
      assert.ok(p[0] >= c + r && p[0] <= L - c - r, k + " " + b.mark + " x " + p[0]);
      assert.ok(p[1] >= c + r && p[1] <= W - c - r, k + " " + b.mark + " y " + p[1]);
      assert.ok(p[2] >= c - 0.6 && p[2] <= H - c + 0.6, k + " " + b.mark + " z " + p[2]);
    }
    // ligs: outside at the cover on every face
    for (const b of M.bars.filter(b => b.mark === "L1")) {
      const ys = b.pts.map(p => p[1]), zs = b.pts.map(p => p[2]);
      assert.equal(Math.min(...ys) - b.size / 2, c); assert.equal(Math.max(...ys) + b.size / 2, W - c);
      assert.equal(Math.min(...zs) - b.size / 2, c); assert.equal(Math.max(...zs) + b.size / 2, H - c);
    }
    // a corner bar's centre is (pin/2 − bar radius) from the lig bend's centre
    const lig = M.bars.find(b => b.mark === "L1"), B1 = M.bars.filter(b => b.mark === "B1");
    const bendC = c + lig.size / 2 + (lig.geom.dp + lig.size) / 2, corner = B1[0].pts[1];
    assert.ok(Math.abs(Math.hypot(corner[1] - bendC, corner[2] - bendC) - (lig.geom.dp / 2 - B1[0].size / 2)) < 0.2, k + " corner bar in the bend");
    // ties beside a lig, on the side facing the middle
    for (const t of M.bars.filter(b => b.mark === "T1")) {
      const x = t.pts[0][0], nearest = M.cage.ligX.reduce((a, v) => (Math.abs(v - x) < Math.abs(a - x) ? v : a));
      assert.equal(Math.round(Math.abs(x - nearest)), t.size);
      if (Math.abs(nearest - L / 2) > 1) assert.ok(Math.abs(x - L / 2) < Math.abs(nearest - L / 2), "tie towards the middle");
    }
  }
});

test("the checks: clashes, pin clearance, bad inputs", () => {
  const F1 = buildModel(CAGE_EXAMPLES.F1);
  // full-depth top cogs at the same set-out as the bottom bars run into the bottom bars' bends (the moved middle bar does not)
  const clash = F1.warnings.find(w => w.startsWith("Bars clash"));
  assert.match(clash, /B2 into B1, 4 pairs of bars/);
  assert.match(clash, /Stop the B2 cogs at 170 outside or less/);
  assert.ok(!F1.warnings.some(w => /clash: (L1|T1)/.test(w)), "ligs and ties clear of each other and the bars");
  const short = buildModel({ ...CAGE_EXAMPLES.F1, cog: 170 });
  assert.ok(!short.warnings.some(w => w.startsWith("Bars clash")), "170 cogs clear the bends");
  assert.ok(F1.warnings.some(w => /Locator pin at 98, 200: it touches the L1 at 82/.test(w)), "the pin by the first lig set");
  // the holds travel with the model; cast-ins listed
  assert.ok(F1.warnings.some(w => w.startsWith("Ligs and ties: the drawing calls for N10")));
  assert.deepEqual(F1.castins.map(c => c.item.split(" ")[0]), ["Swift", "Galvanised", "Earthing", "50", "Tie"]);
  assert.equal(F1.castinParts.filter(p => /Swift/.test(p.item)).length, 6);
  // standard cogs: the AS 3600 cog for N12 (169 → 170), no clash at that length
  const std = buildModel({ ...CAGE_EXAMPLES.F1, cog: "standard" });
  assert.equal(std.marks.find(m => m.mark === "B1").dimStr, "A 2550 · C 170");
  // no ties; even counts; inputs that cannot be built
  assert.equal(buildModel({ ...CAGE_EXAMPLES.F1, ties: "none" }).marks.map(m => m.mark).join(), "B1,B2,L1");
  for (const bad of [{ bottom: "N12" }, { ligs: "N12" }, { depth: -1 }, { cog: 400 }, { ties: "middle", bottom: "4N12", top: "4N12", midTop: null }, { midTop: 270 }, { bottom: "40N12" }]) {
    const M = buildModel({ ...CAGE_EXAMPLES.F1, ...bad });
    assert.ok(M.errors.length > 0, JSON.stringify(bad));
    assert.equal(M.bars.length, 0);
  }
});

test("cages build the same every time", () => {
  for (const k of ["F1", "F2", "F3"]) assert.equal(canonicalOutput(buildModel(CAGE_EXAMPLES[k])), canonicalOutput(buildModel(structuredClone(CAGE_EXAMPLES[k]))));
});
