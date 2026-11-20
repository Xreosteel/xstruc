// ---------- sheet on site and in print (backlog #9c) ---------- (strict TypeScript, backlog #39)

export interface MarkLabel { mark: string; [more: string]: unknown }
export interface Bounds { x0: number; y0: number; x1: number; y1: number }

// The labels of one bar mark across every run of a one-layer sheet (the schedule-mark highlight draws these).
function sheetMarksFor(S: { runMarks?: Record<string, MarkLabel[]> }, mark: string): MarkLabel[] {
  const out: MarkLabel[] = [];
  const runMarks = S.runMarks || {};
  Object.keys(runMarks).forEach(rid => runMarks[rid].forEach(m => { if (m.mark === mark) out.push(m); }));
  return out;
}
// Paper sizes (ISO 216, mm) and the drawing scales a placing sheet is printed at: the preferred scales of
// AS 1100.101 / ISO 5455 (1:1, 1:2, 1:5 series) plus the 1:25 / 1:75 / 1:125 / 1:150 that reo drawings commonly use.
const PAPER_MM: Record<"A4" | "A3" | "A2" | "A1", { w: number; h: number }> = { A4: { w: 297, h: 210 }, A3: { w: 420, h: 297 }, A2: { w: 594, h: 420 }, A1: { w: 841, h: 594 } };
const PRINT_SCALES: number[] = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000];
// Largest standard scale (smallest denominator) at which the sheet bounds fit a drawable area of dw × dh mm of paper.
// Returns { den, fits }: den is the last scale in the list when nothing fits (fits = false), so the sheet still prints.
function sheetPrintScale(bounds: Bounds, dw: number, dh: number): { den: number; fits: boolean } {
  const need = Math.max((bounds.x1 - bounds.x0) / Math.max(1, dw), (bounds.y1 - bounds.y0) / Math.max(1, dh));
  const den = PRINT_SCALES.find(d => d >= need);
  return den ? { den: den, fits: true } : { den: PRINT_SCALES[PRINT_SCALES.length - 1], fits: false };
}

export { sheetMarksFor, PAPER_MM, PRINT_SCALES, sheetPrintScale };
