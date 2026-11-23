// The Sheet: a drawing reduced to what the plan reader needs, whatever file it came from (DXF now, PDF next;
// research/04 §4.5 and research/05 §5.5). Everything is in millimetres in the drawing's own frame (model space,
// x right, y up), blocks exploded, so the recognisers never see file formats.

export type Pt = [number, number];

interface Base {
  /** Stable id: the DXF handle (with the block path when exploded from an INSERT), or a running number. */
  id: string;
  layer: string;
  /** AutoCAD colour index after BYLAYER is resolved (1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white/black). */
  color: number;
  /** Linetype name after BYLAYER is resolved, upper case ("CONTINUOUS", "DASHED", "CENTER" …). */
  linetype: string;
  /** Block names this entity was exploded from, outermost first; empty for model-space entities. */
  blocks: string[];
}

export interface Line extends Base { kind: "line"; a: Pt; b: Pt }
export interface Pline extends Base { kind: "pline"; pts: Pt[]; closed: boolean }
export interface Circle extends Base { kind: "circle"; c: Pt; r: number }
/** Angles in degrees, counter-clockwise from +x, the arc running a0 → a1 counter-clockwise. */
export interface Arc extends Base { kind: "arc"; c: Pt; r: number; a0: number; a1: number }
export interface Text extends Base {
  kind: "text";
  /** The text as a person reads it: formatting codes removed, lines joined by "\n". */
  text: string;
  /** As stored in the file. */
  raw: string;
  /** Insertion point as stored (for MTEXT its attachment point). */
  p: Pt;
  /** Character height and rotation (degrees). */
  h: number;
  rot: number;
  /** Approximate axis-aligned box of the whole text (character widths estimated at 0.8 × height). */
  box: [Pt, Pt];
  /** The source entity: TEXT, MTEXT, ATTRIB, or the text of a DIMENSION. */
  src: "TEXT" | "MTEXT" | "ATTRIB" | "DIMENSION";
}
export interface Dim extends Base { kind: "dim"; p1: Pt; p2: Pt; at: Pt; measured: number; text: string }
export interface Leader extends Base { kind: "leader"; pts: Pt[]; arrow: boolean }
export interface Hatch extends Base { kind: "hatch"; loops: Pt[][]; solid: boolean; pattern: string }

export type Entity = Line | Pline | Circle | Arc | Text | Dim | Leader | Hatch;

export interface Layer { name: string; color: number; off: boolean; frozen: boolean; linetype: string }

export interface Sheet {
  source: "dxf";
  /** How file units became millimetres. */
  units: { code: number; name: string; factor: number; inferred: boolean };
  version: string;
  layers: Layer[];
  entities: Entity[];
  extents: { min: Pt; max: Pt } | null;
  /** Things the reader skipped or had to assume, in plain words. */
  warnings: string[];
  stats: { pairs: number; entities: number; exploded: number; skipped: Record<string, number> };
}

export const isDashed = (lt: string): boolean => /DASH|HIDDEN|CENT|PHANTOM|DOT|DIVIDE|BORDER|ACAD_ISO0[2-9]|ACAD_ISO1/.test(lt);
