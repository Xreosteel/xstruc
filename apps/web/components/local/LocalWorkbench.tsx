"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CFG, PANEL_CFG, PIT_CFG, type ElementInput } from "@xstruc/engine";
import { runEngine, type Run } from "@/lib/engine-run";
import { findElement, findProject, KIND_NAME, removeElement, updateElement } from "@/lib/local-jobs";
import { useLocalJobs } from "@/components/useLocalJobs";
import { RunResult } from "@/components/RunResult";

/**
 * A floor or panel on this device: its inputs (as text until the input screens of backlog #41), Build, the 3D view
 * and the schedule. The inputs are kept on the device as they are typed; it builds once on opening.
 */
export function LocalWorkbench({ pid, eid }: { pid: string; eid: string }) {
  const router = useRouter();
  const { data, change } = useLocalJobs();
  const el = data ? findElement(data, pid, eid) : null;
  const project = data ? findProject(data, pid) : null;
  const [text, setText] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [saved, setSaved] = useState(true);
  const [sure, setSure] = useState(false);
  const first = useRef(true);

  useEffect(() => { if (el && text === null) setText(JSON.stringify(el.inputs, null, 2)); }, [el, text]);
  const parsed = useMemo(() => {
    if (text === null) return { inputs: null, error: null };
    try { return { inputs: JSON.parse(text) as ElementInput, error: null }; } catch (e) { return { inputs: null, error: (e as Error).message }; }
  }, [text]);

  // keep what is typed: half a second after the last key, if it reads
  useEffect(() => {
    if (!parsed.inputs || text === null) return;
    if (first.current) { first.current = false; return; }
    setSaved(false);
    const t = setTimeout(() => { change(d => updateElement(d, pid, eid, { inputs: parsed.inputs! }, new Date().toISOString())); setSaved(true); }, 500);
    return () => clearTimeout(t);
  }, [parsed.inputs, text, change, pid, eid]);

  async function build(inputs = parsed.inputs) {
    if (!inputs) return;
    const r = await runEngine(inputs);
    setRun(r);
    change(d => updateElement(d, pid, eid, { inputs, summary: r.summary }, new Date().toISOString()));
    setSaved(true);
  }
  // build once when it opens
  const built = useRef(false);
  useEffect(() => { if (el && !built.current) { built.current = true; void build(el.inputs); } });

  if (!data) return <p className="text-muted">Opening…</p>;
  if (!el || !project) return <div className="card">That floor or panel is not on this device. <Link className="underline" href="/">Back to projects</Link></div>;
  const example = el.kind === "panel" ? PANEL_CFG : el.kind === "pit" ? PIT_CFG : DEFAULT_CFG;
  const source = (el.inputs as { source?: { file: string } }).source;

  return (
    <div className="grid gap-4">
      <div>
        <Link href={"/job/" + pid} className="text-sm text-muted">← {project.name}</Link>
        <h1 className="text-2xl font-semibold">{el.name} <span className="text-base font-normal text-muted">{(KIND_NAME[el.kind] ?? el.kind).toLowerCase()}</span></h1>
        {source && <p className="text-sm text-muted" data-testid="source">Read from the drawing {source.file}</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <section className="card grid content-start gap-3">
          <span className="label">Inputs</span>
          <textarea className="input min-h-[420px] font-mono text-xs" value={text ?? ""} onChange={e => setText(e.target.value)} spellCheck={false} data-testid="inputs" />
          <p className="text-xs text-muted">The same inputs as the prototype&apos;s Model inputs panel, written out as text. Proper input screens come next.</p>
          {parsed.error && <p className="text-sm text-accent">Not readable yet: {parsed.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" onClick={() => build()} disabled={!parsed.inputs} type="button">Build</button>
            <button className="btn" type="button" onClick={() => { setText(JSON.stringify(example, null, 2)); void build(structuredClone(example)); }}>Back to the example</button>
            <span className="text-sm text-muted" data-testid="saved">{saved ? "Saved on this device" : "Saving…"}</span>
          </div>
          <div className="pt-2">
            {!sure
              ? <button className="btn" type="button" onClick={() => setSure(true)}>Delete {el.kind === "panel" ? "panel" : el.kind === "pit" ? "pit" : "floor"}</button>
              : <span className="flex flex-wrap items-center gap-2"><span className="text-accent">Delete {el.name} from this device?</span>
                  <button className="btn" type="button" onClick={() => { change(d => removeElement(d, pid, eid)); router.push("/job/" + pid); }}>Yes, delete</button>
                  <button className="btn" type="button" onClick={() => setSure(false)}>Keep it</button></span>}
          </div>
        </section>
        <section className="card grid content-start gap-3">
          {!run ? <p className="text-muted">Building…</p> : <RunResult run={run} />}
        </section>
      </div>
    </div>
  );
}
