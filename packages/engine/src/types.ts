// Types for the engine's public API (architecture v2 §6). They describe what callers rely on today and get stricter as
// each module is converted to strict TypeScript (backlog #39).

export type Layer = string;              // floors: BM A B CH C D ST SR; panels: FF1 FF2 CH IN NF2 NF1 (bed face first)
export type BarType = "N" | "R" | "W";   // W = a mesh wire
export type Point3 = [number, number, number];   // mm: x east / along the panel, y north / up the panel, z up from the soffit or bed

export interface Bar {
  id: number;
  layer: Layer;
  run: Run;
  size: number;
  type: BarType;
  shape: string;
  pts: Point3[];
  len: number;            // cut length, mm (rounded up to 5)
  kg: number;
  code?: string;          // CIA / ARC shape code: S, L, LL, U, T, CC, ZL, TB …
  dims?: Record<string, number>;
  dimStr?: string;
  mark?: string;
  setout?: string;
  note?: string;
  flags?: string[];
  existing?: boolean;     // context only (e.g. starters below), never scheduled
  path?: Point3[];        // the centreline as drawn, bends as arcs and hooks included (cages); pts otherwise
  [extra: string]: unknown;
}

export interface Run {
  label: string;
  callout: string;
  layer: Layer;
  bars: Bar[];
  [extra: string]: unknown;
}

export interface Mark {
  mark: string;
  type: string;
  size: number | string;
  code: string;
  dimStr?: string;
  len: number;
  qty: number;
  layer: Layer;
  kg: number;
  flags?: string[];
  [extra: string]: unknown;
}

export interface MeshPiece {
  id: string;
  layer: Layer;
  code: string;
  x0: number; y0: number; x1: number; y1: number;
  cutL: number; cutW: number;
  mark?: string;
  [extra: string]: unknown;
}

export interface Model {
  kind?: "panel" | "pit" | "cage"; // absent for a floor
  cfg: ElementInput;
  errors: string[];       // the model is not usable while any are present
  warnings: string[];     // flags for the engineer / detailer; the model still builds
  bars: Bar[];
  runs: Run[];
  marks: Mark[];
  meshPieces?: MeshPiece[];
  kg: number;
  LAYERS: Array<{ id: Layer; name: string; short?: string; css?: string }>;
  ORDER?: Layer[];
  [extra: string]: unknown;
}

/** A floor slab's inputs (the prototype's DEFAULT_CFG shape). Loose until the Zod schema lands in Phase 1. */
export interface FloorInput {
  kind?: undefined;
  gridX: number[] | string;
  gridY: number[] | string;
  thickness: number;
  cover: number;
  fc: number;
  lap: number;
  callouts: string;
  features: Record<string, boolean>;
  [extra: string]: unknown;
}

/** A precast panel's inputs (the prototype's PANEL_CFG shape). */
export interface PanelInput {
  kind: "panel";
  name: string;
  W: number; H: number; T: number;
  cover: number; fc: number; lap: number;
  castFace: "NF" | "FF";
  faces: Record<"NF" | "FF", { kind: "bar" | "mesh"; callouts: string }>;
  [extra: string]: unknown;
}

export type ElementInput = FloorInput | PanelInput | import("./pit.ts").PitInput | import("./cage.ts").CageInput;
