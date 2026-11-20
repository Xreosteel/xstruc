"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CFG, PANEL_CFG, type ElementInput } from "@xstruc/engine";
import { runEngine, type Run } from "@/lib/engine-run";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { RunResult } from "@/components/RunResult";

export interface VersionRow {
  id: string; number: number; status: string; engine_version: string; output_hash: string;
  summary: { bars?: number; marks?: number; kg?: number; warnings?: number }; inputs: ElementInput; created_at: string;
}

// Foundation version of the element screen: inputs as JSON (the prototype's input panels are ported in Phase 1),
// the engine run in the browser, its schedule, saving a draft version and approving it on the server.
export function Workbench({ element, versions, canWrite, canApprove }: {
  element: { id: string; org_id: string; kind: "floor" | "panel" };
  versions: VersionRow[]; canWrite: boolean; canApprove: boolean;
}) {
  const router = useRouter();
  const start = versions[0]?.inputs ?? (element.kind === "panel" ? PANEL_CFG : DEFAULT_CFG);
  const [text, setText] = useState(() => JSON.stringify(start, null, 2));
  const [run, setRun] = useState<Run | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  const parsed = useMemo(() => {
    try { return { inputs: JSON.parse(text) as ElementInput, error: null }; } catch (e) { return { inputs: null, error: (e as Error).message }; }
  }, [text]);

  async function build() {
    if (!parsed.inputs) return;
    setRun(await runEngine(parsed.inputs));
    setNote(null);
  }

  function save() {
    startBusy(async () => {
      if (!parsed.inputs) return;
      const r = run ?? await runEngine(parsed.inputs);
      const { error } = await supabaseBrowser().from("model_versions").insert({
        org_id: element.org_id, element_id: element.id, inputs: parsed.inputs,
        engine_version: r.engineVersion, output_hash: r.hash, summary: r.summary
      });
      setNote(error ? error.message : "Draft saved.");
      router.refresh();
    });
  }

  function approve(v: VersionRow) {
    startBusy(async () => {
      const res = await fetch("/api/versions/" + v.id + "/approve", { method: "POST" });
      const body = await res.json().catch(() => ({ error: "No answer from the server." }));
      setNote(res.ok ? "Version " + v.number + " approved." : body.error);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <section className="card grid content-start gap-3">
        <span className="label">Inputs (JSON, as the prototype's model inputs)</span>
        <textarea className="input min-h-[360px] font-mono text-xs" value={text} onChange={e => setText(e.target.value)} spellCheck={false} />
        {parsed.error && <p className="text-sm text-accent">Not valid JSON: {parsed.error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={build} disabled={!parsed.inputs} type="button">Build</button>
          {canWrite && <button className="btn" onClick={save} disabled={!parsed.inputs || busy} type="button">Save as draft version</button>}
        </div>
        {note && <p className="text-sm text-muted" role="status">{note}</p>}
        <div>
          <span className="label">Versions</span>
          {versions.length === 0 && <p className="text-sm text-muted">None saved yet.</p>}
          <ul className="grid gap-1 text-sm">
            {versions.map(v => (
              <li key={v.id} className="flex items-center gap-2">
                <span className="font-mono">v{v.number}</span>
                <span className={v.status === "draft" ? "text-muted" : "text-ok"}>{v.status}</span>
                <span className="text-muted">{v.summary?.bars ?? "?"} bars · {v.summary?.kg ?? "?"} kg · engine {v.engine_version}</span>
                {canApprove && v.status === "draft" && <button className="btn ml-auto" onClick={() => approve(v)} disabled={busy} type="button">Approve</button>}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="card grid content-start gap-3">
        {!run && <p className="text-muted">Press Build to run the engine on these inputs.</p>}
        {run && <RunResult run={run} />}
      </section>
    </div>
  );
}
