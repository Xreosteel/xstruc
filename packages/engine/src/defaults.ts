// @ts-nocheck: moved from engine.js unchanged (backlog #39); strict types come module by module

// ---------- default configuration: the Level 1 example ----------
const DEFAULT_CFG = {
  name: "Level 1",
  gridX: [0, 5000, 9500, 14000],
  gridY: [0, 4500, 9000],
  overhang: 250,
  thickness: 200,
  cover: 30,
  fc: 32,
  lap: 600,
  callouts: "N16-200 A E-W\nN12-200 B N-S\nN12-150 C N-S\nN12-150 D E-W",
  features: { beams: true, columns: true, drop: true, step: true, balcony: true, openings: true, extras: true, edges: true, stair: true },
  scheme: "ABCD"
};

export { DEFAULT_CFG };
