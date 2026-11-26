"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addElement, findProject, KIND_NAME, removeProject } from "@/lib/local-jobs";
import { start, STARTS } from "@/lib/examples";
import { newId, useLocalJobs } from "@/components/useLocalJobs";

/** One project on this device: its floors and panels, a new one, deleting the project. */
export function LocalProject({ id }: { id: string }) {
  const router = useRouter();
  const { data, change } = useLocalJobs();
  const [note, setNote] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  if (!data) return <p className="text-muted">Opening…</p>;
  const p = findProject(data, id);
  if (!p) return <div className="card">That project is not on this device. <Link className="underline" href="/">Back to projects</Link></div>;

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { kind, inputs } = start(String(f.get("kind"))), eid = newId();
    const err = change(d => addElement(d, id, { kind, name: String(f.get("name")), inputs }, eid, new Date().toISOString()));
    if (err) setNote(err); else router.push("/job/" + id + "/" + eid);
  }

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/" className="text-sm text-muted">← Projects</Link>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <div className="text-sm text-muted">{[p.jobNumber, p.site].filter(Boolean).join(" · ")}</div>
      </div>
      {note && <p className="text-accent" role="alert">{note}</p>}
      <div className="grid gap-2">
        {p.elements.length === 0 && <p className="text-muted">No floors or panels yet.</p>}
        {p.elements.map(e => (
          <Link key={e.id} href={"/job/" + id + "/" + e.id} className="card flex flex-wrap items-baseline gap-4 hover:border-muted">
            <span className="font-semibold">{e.name}</span>
            <span className="text-sm text-muted">{KIND_NAME[e.kind] ?? e.kind}</span>
            <span className="ml-auto font-mono text-sm text-muted">{e.summary ? e.summary.bars.toLocaleString("en-AU") + " bars · " + e.summary.kg.toLocaleString("en-AU") + " kg" : "not built yet"}</span>
          </Link>
        ))}
      </div>
      <div className="card flex max-w-xl flex-wrap items-center gap-3">
        <div className="grow"><h2 className="font-semibold">Floor from a drawing</h2><p className="text-sm text-muted">Read the engineer&apos;s slab plan (PDF or DXF) into a floor.</p></div>
        <Link className="btn btn-primary" href={"/job/" + id + "/import"}>Import a drawing</Link>
      </div>
      <form onSubmit={create} className="card grid max-w-xl gap-3">
        <h2 className="font-semibold">New floor, panel, pit or cage</h2>
        <label><span className="label">Name</span><input className="input" name="name" required placeholder="Level 1 floor, or P1" /></label>
        <label><span className="label">Kind</span>
          <select className="input" name="kind" defaultValue="floor">{STARTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </label>
        <p className="text-sm text-muted">It starts from the example (the Level 1 floor, panel P1, the mud trap of the wash pad job, or sample cage F1, F2 or F3); change its inputs on the next screen.</p>
        <button className="btn btn-primary w-fit" type="submit">Create</button>
      </form>
      <div>
        {!sure
          ? <button className="btn" type="button" onClick={() => setSure(true)}>Delete project</button>
          : <span className="flex flex-wrap items-center gap-2"><span className="text-accent">Delete {p.name} and its {p.elements.length} floor(s) / panel(s) from this device?</span>
              <button className="btn" type="button" onClick={() => { change(d => removeProject(d, id)); router.push("/"); }}>Yes, delete</button>
              <button className="btn" type="button" onClick={() => setSure(false)}>Keep it</button></span>}
      </div>
    </div>
  );
}
