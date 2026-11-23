"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { decodeDxf, readDxf, readPlan, type Sheet, type StepReport } from "@xstruc/reader";
import { addElement, findProject } from "@/lib/local-jobs";
import { newId, useLocalJobs } from "@/components/useLocalJobs";
import { DrawingPreview, KIND_COLOUR, KIND_NAME } from "@/components/DrawingPreview";

const MARK: Record<StepReport["status"], { sign: string; cls: string }> = { ok: { sign: "✓", cls: "text-ok" }, check: { sign: "!", cls: "text-warn" }, error: { sign: "✕", cls: "text-accent" } };

/**
 * A floor from an engineer's drawing: the file is read on this device (nothing is uploaded) by the drawing reader,
 * which goes through the plan the way a scheduler does; the steps, what it found, what it needs and what it could
 * not use are shown beside the drawing; "Create floor" saves the inputs and opens the 3D.
 */
export function ImportDrawing({ pid }: { pid: string }) {
  const router = useRouter();
  const { data, change } = useLocalJobs();
  const [file, setFile] = useState<{ name: string; sheet: Sheet } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number>>({});
  const [name, setName] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const reading = useMemo(() => (file ? readPlan(file.sheet, { values }) : null), [file, values]);

  async function open(bytes: ArrayBuffer, fileName: string) {
    setError(null); setValues({}); setName(null); setFocus([]);
    if (!/\.dxf$/i.test(fileName)) { setFile(null); setError("Only DXF drawings for now (PDF comes next). In CAD: Save As or Export → DXF, AutoCAD 2018 or older, ASCII."); return; }
    try { setFile({ name: fileName, sheet: readDxf(decodeDxf(new Uint8Array(bytes))) }); }
    catch (e) { setFile(null); setError((e as Error).message); }
  }
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (f) await open(await f.arrayBuffer(), f.name);
  }
  async function sample() {
    const r = await fetch("/samples/level1-slab-plan.dxf");
    if (!r.ok) { setError("The sample drawing is not available."); return; }
    await open(await r.arrayBuffer(), "level1-slab-plan.dxf");
  }
  function create() {
    if (!reading?.input || !file) return;
    const eid = newId();
    const err = change(d => addElement(d, pid, { kind: "floor", name: name ?? String(reading.input!.name ?? "Floor"), inputs: { ...reading.input!, source: { file: file.name, read: new Date().toISOString() } } }, eid, new Date().toISOString()));
    if (err) setError(err); else router.push("/job/" + pid + "/" + eid);
  }

  if (!data) return <p className="text-muted">Opening…</p>;
  const project = findProject(data, pid);
  if (!project) return <div className="card">That project is not on this device. <Link className="underline" href="/">Back to projects</Link></div>;
  const counts = reading ? Object.entries(reading.found.reduce<Record<string, number>>((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {})) : [];
  const errors = reading?.issues.filter(i => i.level === "error") ?? [], checks = reading?.issues.filter(i => i.level === "check") ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <Link href={"/job/" + pid} className="text-sm text-muted">← {project.name}</Link>
        <h1 className="text-2xl font-semibold">Floor from a drawing</h1>
        <p className="text-sm text-muted">The drawing is read on this device; nothing is uploaded. The reader goes through it the way a scheduler does: grids, slab edge, openings, notes, then each reinforcement callout. It never guesses: anything the drawing does not say is asked for below.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" type="button" onClick={() => input.current?.click()}>Choose a DXF drawing</button>
        <button className="btn" type="button" onClick={sample}>Try the sample drawing</button>
        <input ref={input} type="file" accept=".dxf,application/dxf,image/vnd.dxf" className="hidden" onChange={pick} data-testid="drawing-file" />
        {file && <span className="text-sm text-muted">{file.name} · {file.sheet.entities.length.toLocaleString("en-AU")} items · {file.sheet.units.name}</span>}
      </div>
      {error && <p className="text-accent" role="alert">{error}</p>}
      {file && reading && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_1fr]">
          <section className="card grid content-start gap-4" data-testid="reading">
            <ol className="grid gap-2">
              {reading.steps.map(s => (
                <li key={s.n}>
                  <div className="flex items-baseline gap-2"><span className={"w-4 font-mono " + MARK[s.status].cls}>{MARK[s.status].sign}</span><span className="font-semibold">{s.n}. {s.title}</span></div>
                  <ul className="ml-6 text-sm text-muted">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </li>
              ))}
            </ol>
            {reading.missing.length > 0 && (
              <div className="grid gap-2 rounded-md border border-warn p-3" data-testid="missing">
                <div className="font-semibold">Not on the drawing: type these in</div>
                {reading.missing.map(m => (
                  <label key={m.key} className="grid gap-1">
                    <span className="text-sm">{m.label} ({m.unit})</span>
                    <span className="flex flex-wrap items-center gap-2">
                      {m.options?.map(o => <button key={o} type="button" className="btn" onClick={() => setValues(v => ({ ...v, [m.key]: o }))}>{o}</button>)}
                      <input className="input w-32" inputMode="numeric" name={m.key} placeholder={m.options ? "or type" : ""}
                        onKeyDown={e => { if (e.key === "Enter") { const n = parseFloat((e.target as HTMLInputElement).value); if (n > 0) setValues(v => ({ ...v, [m.key]: n })); } }}
                        onBlur={e => { const n = parseFloat(e.target.value); if (n > 0) setValues(v => ({ ...v, [m.key]: n })); }} />
                    </span>
                  </label>
                ))}
              </div>
            )}
            {errors.length > 0 && (
              <div><div className="mb-1 font-semibold text-accent">Errors ({errors.length})</div>
                <ul className="grid gap-1 text-sm">{errors.map((i, k) => <li key={k} className="cursor-default rounded px-1 hover:bg-line" onMouseEnter={() => setFocus(i.ids)} onMouseLeave={() => setFocus([])}>{i.text}</li>)}</ul></div>
            )}
            {checks.length > 0 && (
              <div><div className="mb-1 font-semibold text-warn">To check ({checks.length})</div>
                <ul className="grid gap-1 text-sm">{checks.map((i, k) => <li key={k} className="cursor-default rounded px-1 hover:bg-line" onMouseEnter={() => setFocus(i.ids)} onMouseLeave={() => setFocus([])}>{i.text}</li>)}</ul></div>
            )}
            <div className="grid gap-2 border-t border-line pt-3">
              <label><span className="label">Name</span><input className="input" value={name ?? String(reading.input?.name ?? "")} onChange={e => setName(e.target.value)} placeholder="Level 1 floor" /></label>
              <button className="btn btn-primary w-fit" type="button" disabled={!reading.input} onClick={create}>Create floor and build 3D</button>
              {!reading.input && <p className="text-sm text-muted">{reading.missing.length ? "Fill in the values above first." : "Fix the errors on the drawing first."}</p>}
            </div>
          </section>
          <section className="grid content-start gap-2">
            <DrawingPreview sheet={file.sheet} found={reading.found} focus={focus} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {counts.map(([k, n]) => <li key={k} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KIND_COLOUR[k as keyof typeof KIND_COLOUR] }} />{KIND_NAME[k as keyof typeof KIND_NAME]} {n}</li>)}
              <li className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#ffd33d]" />Point at an issue to see it</li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
