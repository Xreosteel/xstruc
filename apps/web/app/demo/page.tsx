"use client";
import { useMemo, useState } from "react";
import { buildModel, CAGE_EXAMPLES, DEFAULT_CFG, PANEL_CFG, PIT_CFG, ENGINE_VERSION } from "@xstruc/engine";
import { ModelViewer } from "@/components/ModelViewer";
import { Schedule } from "@/components/Schedule";

type Cage = keyof typeof CAGE_EXAMPLES;
const CAGES = Object.keys(CAGE_EXAMPLES) as Cage[];

// The engine's examples in 3D, no account needed: the Level 1 floor, the precast panel P1, a mud trap (a pit) and the
// sample footing cages F1–F3.
export default function Demo() {
  const [kind, setKind] = useState<"floor" | "panel" | "pit" | "cage">("floor");
  const [cage, setCage] = useState<Cage>("F1");
  const model = useMemo(() => buildModel(kind === "panel" ? PANEL_CFG : kind === "pit" ? PIT_CFG : kind === "cage" ? CAGE_EXAMPLES[cage] : DEFAULT_CFG), [kind, cage]);
  const bars = model.bars.filter(b => !b.existing).length;
  const kg = model.kg < 1000 ? model.kg.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(model.kg).toLocaleString("en-AU");
  const pick = (k: typeof kind) => <button className={"btn " + (kind === k ? "btn-primary" : "")} type="button" onClick={() => setKind(k)}>{{ floor: "Floor slab", panel: "Precast panel", pit: "Mud trap", cage: "Footing cages" }[k]}</button>;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-sm text-muted">Demo · engine {ENGINE_VERSION}</div>
          <h1 className="text-2xl font-semibold">{kind === "panel" ? "Precast panel P1" : kind === "pit" ? "Mud trap" : kind === "cage" ? "Footing cage " + cage : "Level 1 floor"}</h1>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">{pick("floor")}{pick("panel")}{pick("pit")}{pick("cage")}</div>
      </div>
      {kind === "cage" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="cage-pick">
          <span className="text-muted">Sample cage</span>
          {CAGES.map(k => <button key={k} className={"btn " + (cage === k ? "btn-primary" : "")} type="button" onClick={() => setCage(k)}>{k}</button>)}
          <span className="text-muted">{model.cage ? (model.cage as { length: number; width: number; depth: number }).length + " × " + (model.cage as { width: number }).width + " × " + (model.cage as { depth: number }).depth + " block, " + (model.cage as { cover: number }).cover + " cover" : ""}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-6 font-mono text-sm" data-testid="demo-stats">
        <span>{bars.toLocaleString("en-AU")} bars</span><span>{model.marks.length} marks</span><span>{kg} kg</span>
      </div>
      <ModelViewer model={model} />
      {model.warnings.length > 0 && (
        <details className="card text-sm" open={kind === "cage"} data-testid="demo-notes">
          <summary className="font-semibold">Checks and hold points ({model.warnings.length})</summary>
          <ol className="mt-2 list-decimal pl-5">{model.warnings.map((w, i) => <li key={i} className="mb-1">{w}</li>)}</ol>
        </details>
      )}
      <section className="card"><h2 className="mb-2 font-semibold">Bar schedule</h2><Schedule model={model} /></section>
    </div>
  );
}
