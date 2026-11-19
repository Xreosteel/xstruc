import { describe, expect, it } from "vitest";
import { DEFAULT_CFG, ENGINE_VERSION, PANEL_CFG } from "@xstruc/engine";
import { checkForApproval, runEngine } from "@/lib/engine-run";

describe("engine runs and the approval rule", () => {
  it("hashes the same inputs to the same output, floor and panel", async () => {
    for (const cfg of [DEFAULT_CFG, PANEL_CFG]) {
      const a = await runEngine(cfg), b = await runEngine(structuredClone(cfg));
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.hash).toBe(b.hash);
      expect(a.summary.errors).toBe(0);
    }
  });

  it("different inputs give a different hash", async () => {
    const a = await runEngine(DEFAULT_CFG), b = await runEngine({ ...DEFAULT_CFG, thickness: 250 });
    expect(a.hash).not.toBe(b.hash);
  });

  it("approves a matching draft and refuses everything else", async () => {
    const run = await runEngine(DEFAULT_CFG);
    const v = { inputs: DEFAULT_CFG, engine_version: ENGINE_VERSION, output_hash: run.hash, status: "draft" };
    expect(await checkForApproval(v)).toEqual({ ok: true, hash: run.hash });
    expect((await checkForApproval({ ...v, status: "approved" })).ok).toBe(false);
    expect((await checkForApproval({ ...v, engine_version: "0.9.0" })).ok).toBe(false);
    expect((await checkForApproval({ ...v, output_hash: "0".repeat(64) })).ok).toBe(false);
    const bad = { ...DEFAULT_CFG, callouts: "N16-200 A" };
    expect((await checkForApproval({ ...v, inputs: bad, output_hash: (await runEngine(bad)).hash })).ok).toBe(false);
  });
});
