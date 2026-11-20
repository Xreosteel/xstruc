// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module

// ---------- cast-in inserts: catalogue, checks and component bars (backlog #33c) ----------
// Seeded from Findings 12.2 (research/12-precast-panel-reinforcement.md), which read the suppliers' own published
// compliance documents and design guides; each entry names its document and the AS 3850.1 edition it is written to.
// Capacities (WLL) are the suppliers' at the lifting strength and are stored to be printed in the insert table; X Struc
// never compares them with a load — lifting design stays with the Erection Designer under AS 3850.2.
//   em / am  minimum edge distance / spacing between anchors (mm) as published for the edge lifters.
//   c1 / s1  minimum edge distance / spacing for the threaded inserts (Ancon guide, by insert length).
//   T        panel thickness range the lifter is published for.  wllAt: WLL (t) by f'c at lift (MPa), the 150 panel series.
//   bars     the component reinforcement each anchor needs: shape, size, legs (outside, mm), included angle, base width.
//   embed    PLACEHOLDER: how far the anchor reaches into the panel from the edge (where the tension bar passes through its
//            lower hole); not in the compliance documents read. Question for Baji / the supplier drawings.
// Where a document gave a choice (SJU tension bar N16 × 500 / × 750 / N20 × 750) the first option is seeded.
const INSERT_CAT = {
  edition: "Findings 12.2 seed", date: "2026-11-16",
  items: {
    "3DX10": { brand: "Reid", name: "SwiftLift 3Dx 10 t edge lift", code: "3DX10A, void former 3DX85VF", kind: "lifter", place: "edge", wll: 10, wllAt: { 15: 8.9, 20: 9.5, 25: 10 }, wllNote: "150 panel; a 120 panel 6.3–10 t; shear 2.2–2.9 t", T: [120, 300], em: 420, am: 840, embed: 300, body: 40,
      bars: [{ role: "tension", shape: "TB", size: 16, leg: 500, angle: 45 }], assumes: "SL82 + N16 perimeter bar centrally placed (double mesh at 250–300)", doc: "Reid SwiftLift 3Dx 10 t compliance document", std: "AS 3850.1:2024" },
    "SJL": { brand: "Reid", name: "SwiftLift JAWS SJL 3 t edge lift", kind: "lifter", place: "edge", wll: 3, wllAt: { 15: 2.4, 20: 3 }, wllNote: "2.4 t at 15 MPa in a 100 panel", T: [100, 150], em: 300, am: 700, embed: 150, body: 30,
      bars: [{ role: "tension", shape: "S", size: 12, len: 300 }, { role: "shear", shape: "U", size: 10, leg: 200, width: 60 }], assumes: "SL82 + N16 perimeter bar, central", doc: "Reid SwiftLift JAWS edge lift anchor compliance document", std: "AS 3850.1:2015" },
    "SJS": { brand: "Reid", name: "SwiftLift JAWS SJS 7 t edge lift", kind: "lifter", place: "edge", wll: 7, wllAt: { 15: 7 }, T: [125, 200], em: 420, am: 840, embed: 220, body: 36,
      bars: [{ role: "tension", shape: "S", size: 16, len: 500 }, { role: "shear", shape: "U", size: 12, leg: 250, width: 90 }], assumes: "SL82 + N16 perimeter bar, central", doc: "Reid SwiftLift JAWS edge lift anchor compliance document", std: "AS 3850.1:2015" },
    "SJU": { brand: "Reid", name: "SwiftLift JAWS SJU 10 t edge lift", kind: "lifter", place: "edge", wll: 10, wllAt: { 15: 7.1, 25: 10 }, wllNote: "7.1–10 t by thickness and f'c", T: [125, 200], em: 450, am: 900, embed: 300, body: 40,
      bars: [{ role: "tension", shape: "S", size: 16, len: 500 }, { role: "shear", shape: "U", size: 16, leg: 300, width: 90 }], assumes: "SL82 + N16 perimeter bar, central", doc: "Reid SwiftLift JAWS edge lift anchor compliance document", std: "AS 3850.1:2015" },
    "RFL5": { brand: "Reid", name: "face-lift foot anchor RFL / FL0 5 t", kind: "lifter", place: "face", wll: 5, wllNote: "preassembled per panel thickness; edge distance not published", em: null, am: null, body: 30,
      bars: [{ role: "floating", shape: "S", size: 12, len: 300, pair: 60 }], doc: "Reid lifting anchor systems installation guide", std: "AS 3850.1" },
    "QF20B": { brand: "Ancon", name: "QwikFoot brace insert 96 long (M20)", kind: "brace", place: "face", len: 96, c1: 155, s1: 305, body: 28, wllText: "brace WLL 27.4 kN at 20 MPa", bars: [], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QX20B": { brand: "Ancon", name: "QwikFix brace insert 96 long (M20)", kind: "brace", place: "face", len: 96, c1: 135, s1: 270, body: 28, wllText: "46.3 kN tension at 50 MPa", bars: [{ role: "cross", shape: "S", size: 12, len: 300 }], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QF20": { brand: "Ancon", name: "QwikFoot ferrule 96 long (M20)", kind: "ferrule", place: "face", len: 96, c1: 155, s1: 305, body: 28, wllText: "55.6 kN tension, 48.6 kN shear at 50 MPa", bars: [], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QF16": { brand: "Ancon", name: "QwikFoot ferrule 70 long", kind: "ferrule", place: "face", len: 70, c1: 115, s1: 225, body: 24, bars: [], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QF12": { brand: "Ancon", name: "QwikFoot ferrule 50 long", kind: "ferrule", place: "face", len: 50, c1: 85, s1: 165, body: 20, bars: [], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QX16": { brand: "Ancon", name: "QwikFix ferrule 76 long", kind: "ferrule", place: "face", len: 76, c1: 105, s1: 205, body: 24, wllText: "31.6 kN tension at 50 MPa", bars: [{ role: "cross", shape: "S", size: 12, len: 300 }], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" },
    "QX20": { brand: "Ancon", name: "QwikFix ferrule 96 long (M20)", kind: "ferrule", place: "face", len: 96, c1: 135, s1: 270, body: 28, wllText: "46.3 kN tension at 50 MPa", bars: [{ role: "cross", shape: "S", size: 12, len: 300 }], doc: "Ancon QwikFoot and QwikFix threaded inserts design guide v2", std: "AS 3850.1" }
  }
};
Object.keys(INSERT_CAT.items).forEach(k => { INSERT_CAT.items[k].key = k; });
const INSERT_KIND = { lifter: "lifter", brace: "brace insert", ferrule: "fixing ferrule" };
// Placement rules that are not the catalogue's: brace inserts at least 300 from any edge and 200 horizontally off every
// lifter line so the braces hang clear (NT COP 5.1.5 / QLD COP s4 via Findings 12.1); at least two braces per element
// (COP, advisory here); brace centroid under 60 % of the height (US rule, advisory); lifters not 3, 6, 9 or 12 (the
// any-two-of-four rule, QLD COP s14.1.1, advisory) and symmetric about the CoG within 50 (advisory).
const INSERT_RULES = { braceEdge: 300, braceOffLifter: 200, braceMin: 2, braceHeight: 0.6, lifterCounts: [3, 6, 9, 12], symmetry: 50 };
// WLL at the lifting strength: the largest published f'c step at or below fcLift; null below the lowest step
function insertWll(cat, fcLift) {
  if (!cat.wllAt) return { wll: cat.wll || null, at: null, text: cat.wllText || (cat.wll ? cat.wll + " t" : "not published") };
  const steps = Object.keys(cat.wllAt).map(Number).sort((a, b) => a - b), at = steps.filter(s => s <= fcLift).pop();
  if (at == null) return { wll: null, at: null, text: "no WLL published below " + steps[0] + " MPa", below: steps[0] };
  return { wll: cat.wllAt[at], at: at, text: cat.wllAt[at] + " t at " + fcLift + " MPa (table step " + at + ")" };
}

export { INSERT_CAT, INSERT_KIND, INSERT_RULES, insertWll };
