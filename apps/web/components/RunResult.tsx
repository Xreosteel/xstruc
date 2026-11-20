"use client";
import type { Run } from "@/lib/engine-run";
import { ModelViewer } from "@/components/ModelViewer";
import { Schedule } from "@/components/Schedule";

/** What a build gives: the totals, errors and warnings, the 3D view and the bar schedule. */
export function RunResult({ run }: { run: Run }) {
  const s = run.summary, m = run.model;
  return (
    <>
      <div className="flex flex-wrap gap-6 font-mono" data-testid="run-stats">
        <div><div className="label">Bars</div>{s.bars.toLocaleString("en-AU")}</div>
        <div><div className="label">Marks</div>{s.marks}</div>
        <div><div className="label">Steel kg</div>{s.kg.toLocaleString("en-AU")}</div>
        {s.meshSheets > 0 && <div><div className="label">Mesh sheets</div>{s.meshSheets}</div>}
        <div><div className="label">Engine</div>{run.engineVersion}</div>
      </div>
      {m.errors.length > 0 && <ul className="list-disc pl-5 text-sm text-accent" role="alert">{m.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {m.warnings.length > 0 && <details className="text-sm text-warn"><summary>{m.warnings.length} warning(s)</summary><ul className="list-disc pl-5">{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      {m.errors.length === 0 && <ModelViewer model={m} height={460} />}
      <Schedule model={m} />
    </>
  );
}
