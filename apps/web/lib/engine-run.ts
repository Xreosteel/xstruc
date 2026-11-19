import { buildModel, canonicalOutput, ENGINE_VERSION, type ElementInput, type Model } from "@xstruc/engine";
import { sha256Hex } from "@/lib/hash";

export interface Summary {
  bars: number;      // bars in this pour (context bars such as starters below are left out)
  marks: number;
  kg: number;
  meshSheets: number;
  errors: number;
  warnings: number;
}

export interface Run {
  model: Model;
  engineVersion: string;
  hash: string;      // SHA-256 of canonicalOutput(model): what a saved version and its approval carry
  summary: Summary;
}

export function summarise(model: Model): Summary {
  return {
    bars: model.bars.filter(b => !b.existing).length,
    marks: model.marks.length,
    kg: Math.round(model.kg),
    meshSheets: (model.meshPieces ?? []).length,
    errors: model.errors.length,
    warnings: model.warnings.length
  };
}

/** Builds an element with the engine and hashes its canonical output. Used in the browser and by the approval route. */
export async function runEngine(inputs: ElementInput): Promise<Run> {
  const model = buildModel(inputs);
  return { model, engineVersion: ENGINE_VERSION, hash: await sha256Hex(canonicalOutput(model)), summary: summarise(model) };
}

export interface StoredVersion {
  inputs: ElementInput;
  engine_version: string;
  output_hash: string;
  status: string;
}

/**
 * The approval rule (architecture v2 ADR-007): a draft is approved only if this server, running the same engine
 * version, rebuilds it without errors and gets the same hash the draft was saved with.
 */
export async function checkForApproval(v: StoredVersion): Promise<{ ok: true; hash: string } | { ok: false; reason: string }> {
  if (v.status !== "draft") return { ok: false, reason: "Only a draft can be approved; this version is " + v.status + "." };
  if (v.engine_version !== ENGINE_VERSION) {
    return { ok: false, reason: "Saved with engine " + v.engine_version + "; the server runs " + ENGINE_VERSION + ". Open it, rebuild and save a new version." };
  }
  const run = await runEngine(v.inputs);
  if (run.summary.errors) return { ok: false, reason: "The model has " + run.summary.errors + " error(s); fix them and save a new version." };
  if (run.hash !== v.output_hash) return { ok: false, reason: "The server's rebuild does not match what was saved, so it cannot be approved. Save the version again." };
  return { ok: true, hash: run.hash };
}
