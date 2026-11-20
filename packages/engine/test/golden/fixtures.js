// The golden set (architecture v2 §6 / §10): elements whose full engine output is pinned in golden.json. Any change
// to a single bar, mark, sheet line or section dot changes a hash and fails test/golden.test.js; a deliberate change
// is re-pinned with `UPDATE_GOLDEN=1 node --test test/golden.test.js` and an ENGINE_VERSION bump.
import { DEFAULT_CFG, PANEL_CFG } from "../../src/index.ts";

const clone = o => JSON.parse(JSON.stringify(o));
const floor = (patch = {}) => Object.assign(clone(DEFAULT_CFG), patch);
const panel = (patch = {}) => Object.assign(clone(PANEL_CFG), patch);
const mats = DEFAULT_CFG.callouts.split("\n");

export const FIXTURES = {
  "floor-example": floor(),
  "floor-top-mesh": floor({ callouts: mats.filter(l => / [AB] /.test(l + " ")).concat("SL82 T E-W").join("\n") }),
  "floor-no-features": floor({ features: Object.fromEntries(Object.keys(DEFAULT_CFG.features).map(k => [k, false])) }),
  "floor-250-thick": floor({ thickness: 250, cover: 40 }),
  "panel-example": panel(),
  "panel-nf-on-bed": panel({ castFace: "NF" }),
  "panel-bars-both-faces": panel({ T: 220, faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" } } }),
  "panel-too-thin-error": panel({ faces: { NF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" }, FF: { kind: "bar", callouts: "N12-200 H\nN12-200 V" } } }),
  "panel-stock-mesh": panel({ meshSheets: "stock" }),
  "panel-with-door": panel({ openings: (PANEL_CFG.openings || []).concat({ name: "DOOR", x0: 1300, y0: 0, x1: 2300, y1: 2100 }) })
};

export const SECTIONS = { floor: [{ dir: "EW", at: 4500, look: "N" }, { dir: "NS", at: 6000, look: "E" }], panel: [{ dir: "EW", at: 1500 }, { dir: "NS", at: 2000 }] };
