// ---------- constants ---------- (strict TypeScript, backlog #39)

export interface LayerDef { id: string; name: string; short?: string; css: string; idx?: number }

const LAYERS: LayerDef[] = [
  { id: "CL", name: "Columns below (poured)", css: "#7d8fa3" },
  { id: "BM", name: "Beam cages", css: "#b48cf0" },
  { id: "A", name: "Layer A · bottom 1st", css: "#4f8fe8" },
  { id: "B", name: "Layer B · bottom 2nd", css: "#3fc1c9" },
  { id: "CH", name: "Bar chairs", css: "#9aa7b4" },
  { id: "C", name: "Layer C · top 3rd", css: "#e8a33d" },
  { id: "D", name: "Layer D · top 4th", css: "#e5534b" },
  { id: "ST", name: "Column starters", css: "#f0d24a" },
  { id: "SR", name: "Stair flight", short: "Stair", css: "#8fd17a" }   // #8: the flight below the slab, a later pour; left out of a floor without a stair
];
const LBY: Record<string, LayerDef> = {}; LAYERS.forEach((l, i) => { l.idx = i; LBY[l.id] = l; });
const EXPLODE: Record<string, number> = { CL: 0, BM: 0, A: 0, B: 0.3, CH: 0, C: 0.65, D: 0.95, ST: 1.35, SR: 0 };
const KGM: Record<string, number> = { N10: 0.632, N12: 0.888, N16: 1.58, N20: 2.47, N24: 3.55, N28: 4.83, N32: 6.31, N36: 7.99, N40: 9.86, R6: 0.222, R10: 0.617, R12: 0.888, R16: 1.58, R20: 2.47 };
const BAR_SIZES: Record<"N" | "R" | "S" | "W", number[]> = { N: [10, 12, 16, 20, 24, 28, 32, 36, 40], R: [6, 10, 12, 16, 20, 24], S: [12], W: [4, 5, 6, 8, 10, 12] };

export { LAYERS, LBY, EXPLODE, KGM, BAR_SIZES };
