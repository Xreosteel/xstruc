// @xstruc/reader: an engineer's slab plan → the engine's inputs, by rules (research/04, 05, 17). DXF now; PDF next.
export * from "./sheet.ts";
export { readDxf, decodeDxf, plainMtext, plainText, entityPoints } from "./dxf.ts";
export { readPlan, type PlanReading, type Found, type FoundKind, type Issue, type Missing, type StepReport, type ReadOptions } from "./plan.ts";
export { boxOf, type Box } from "./geom.ts";
