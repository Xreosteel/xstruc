"use client";
import { useMemo, useState } from "react";
import { buildModel, DEFAULT_CFG, PANEL_CFG, PIT_CFG, ENGINE_VERSION } from "@xstruc/engine";
import { ModelViewer } from "@/components/ModelViewer";
import { Schedule } from "@/components/Schedule";

// The engine's examples in 3D, no account needed: the Level 1 floor, the precast panel P1 and a mud trap (a pit).
export default function Demo() {
  const [kind, setKind] = useState<"floor" | "panel" | "pit">("floor");
  const model = useMemo(() => buildModel(kind === "panel" ? PANEL_CFG : kind === "pit" ? PIT_CFG : DEFAULT_CFG), [kind]);
  const bars = model.bars.filter(b => !b.existing).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-sm text-muted">Demo · engine {ENGINE_VERSION}</div>
          <h1 className="text-2xl font-semibold">{kind === "panel" ? "Precast panel P1" : kind === "pit" ? "Mud trap" : "Level 1 floor"}</h1>
        </div>
        <div className="ml-auto flex gap-2">
          <button className={"btn " + (kind === "floor" ? "btn-primary" : "")} type="button" onClick={() => setKind("floor")}>Floor slab</button>
          <button className={"btn " + (kind === "panel" ? "btn-primary" : "")} type="button" onClick={() => setKind("panel")}>Precast panel</button>
          <button className={"btn " + (kind === "pit" ? "btn-primary" : "")} type="button" onClick={() => setKind("pit")}>Mud trap</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-6 font-mono text-sm" data-testid="demo-stats">
        <span>{bars.toLocaleString("en-AU")} bars</span><span>{model.marks.length} marks</span><span>{Math.round(model.kg).toLocaleString("en-AU")} kg</span>
      </div>
      <ModelViewer model={model} />
      <section className="card"><h2 className="mb-2 font-semibold">Bar schedule</h2><Schedule model={model} /></section>
    </div>
  );
}
