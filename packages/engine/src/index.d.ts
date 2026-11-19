// Types for the engine's public API (architecture v2 §6). engine.js is still the prototype's JavaScript; these types
// describe what callers rely on today and get stricter as each module is converted to TypeScript (Phase 1).

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
  kind?: "panel";         // absent for a floor
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

export type ElementInput = FloorInput | PanelInput;

export const ENGINE_VERSION: string;
export const DEFAULT_CFG: FloorInput;
export const PANEL_CFG: PanelInput;

/** Builds a floor slab or (kind: "panel") a precast panel. Never throws on bad inputs: they come back in `errors`. */
export function buildModel(cfg: ElementInput): Model;
export function buildPanel(cfg: PanelInput): Model;
/** The JSON an approval hashes: same inputs + same ENGINE_VERSION → the same string. */
export function canonicalOutput(model: Model): string;

export interface Callout {
  count: number | null; type: string | null; size: number | null; spacing: number | null;
  layer: string | null; direction: string | null; role: string | null; raw: string;
  [extra: string]: unknown;
}
export function parseCallout(text: string, opts?: { scheme?: "ABCD" | "TB" }): Callout;
/** The placing sheet for one layer (or the finished floor when solid is null), as plain plan geometry in mm. */
export function buildSheet(model: Model, solid: Layer | null, ghost?: boolean): Record<string, unknown>;
/** A vertical section through the model. */
export function buildSection(model: Model, opts: { dir: "EW" | "NS"; at: number; look?: string; depth?: number }): Record<string, unknown>;
/** AS 3600 Section 13 lap / development length for one case (secondary-source coefficients; see the engine). */
export function lapCalc(o: Record<string, unknown>): Record<string, unknown>;
export function bendGeom(type: string, size: number, role?: string): Record<string, number>;

// Catalogues and tables (data with sources; typed loosely until the rule packs are split out).
export const MESH: Record<string, Record<string, number | string>>;
export const INSERT_CAT: Record<string, unknown>;
export const COVER_TABLE: Record<string, unknown>;
export const SHAPES: Record<string, unknown>;
export const LAYERS: Array<{ id: Layer; name: string; short?: string; css?: string }>;

// Everything else the prototype's tests reach into (parseLapTable, gridSetout, sheetMarksFor, panelOutline, …) is
// exported too and typed loosely here; tighten each as its module is converted.
export const parseLapTable: (...a: any[]) => any;
export const lapLookup: (...a: any[]) => any;
export const LAP_CASES: any;
export const LBY: any;
export const MESH_CODES: any;
export const BAR_SIZES: any;
export const pinDia: (...a: any[]) => any;
export const cutLength: (...a: any[]) => any;
export const nearestGrid: (...a: any[]) => any;
export const barAxis: (...a: any[]) => any;
export const gridSetout: (...a: any[]) => any;
export const matDirectionError: (...a: any[]) => any;
export const sheetMarksFor: (...a: any[]) => any;
export const sheetPrintScale: (...a: any[]) => any;
export const PRINT_SCALES: any;
export const PAPER_MM: any;
export const parseGrids: (...a: any[]) => any;
export const exampleGeometry: (...a: any[]) => any;
export const meshStock: (...a: any[]) => any;
export const MESH_LAP: (...a: any[]) => any;
export const wireKgm: (d: number) => number;
export const INSERT_RULES: any;
export const insertWll: (...a: any[]) => any;
export const panelTag: (...a: any[]) => any;
export const PANEL_TABLE_COLS: any;
export const COVER_FC: any;
export const coverRequired: (...a: any[]) => any;
export const MIN_REO: any;
export const barAreaPerM: (...a: any[]) => any;
export const panelOutline: (...a: any[]) => any;
export const SECTION_LOOK: any;
