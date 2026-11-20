"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { addProject, backupText, mergeBackup, parseBackup } from "@/lib/local-jobs";
import { newId, useLocalJobs } from "@/components/useLocalJobs";

/** The start screen with no accounts: the projects kept on this device, a new project, backup and restore. */
export function LocalHome() {
  const { data, change, notKept } = useLocalJobs();
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    const err = change(d => addProject(d, { name: String(f.get("name")), jobNumber: String(f.get("job") ?? ""), site: String(f.get("site") ?? "") }, newId(), new Date().toISOString()));
    if (err) setNote({ text: err, bad: true }); else { setNote(null); form.reset(); }
  }

  function backup() {
    if (!data) return;
    const blob = new Blob([backupText(data, new Date().toISOString())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "xstruc-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setNote({ text: "Backup saved to your downloads. Restore it on another device to carry the jobs over." });
  }

  async function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const b = parseBackup(await f.text());
    if (!b.ok) { setNote({ text: b.error, bad: true }); return; }
    let added = 0, replaced = 0;
    change(d => { const m = mergeBackup(d, b.data); added = m.added; replaced = m.replaced; return m.data; });
    setNote({ text: "Restored: " + added + " project(s) added" + (replaced ? ", " + replaced + " replaced by the backup's copy" : "") + "." });
  }

  if (!data) return <p className="text-muted">Opening your jobs…</p>;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted">Kept in this browser on this device. Nothing is sent anywhere; use Backup to keep a copy or move them to another device.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button className="btn" type="button" onClick={backup} disabled={!data.projects.length}>Backup</button>
          <button className="btn" type="button" onClick={() => file.current?.click()}>Restore</button>
          <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={restore} data-testid="restore-file" />
        </div>
      </div>
      {notKept && <p className="text-warn" role="alert">This browser is not keeping data (a private window, or storage is full or blocked), so these jobs will be lost when the page closes. Use Backup.</p>}
      {note && <p className={note.bad ? "text-accent" : "text-ok"} role="status">{note.text}</p>}
      <div className="grid gap-2">
        {data.projects.length === 0 && (
          <div className="card text-muted">No projects on this device yet. Start one below, or look at the examples in the <Link className="underline" href="/demo">demo</Link>.</div>
        )}
        {data.projects.map(p => (
          <Link key={p.id} href={"/job/" + p.id} className="card flex flex-wrap items-baseline gap-4 hover:border-muted">
            <span className="font-semibold">{p.name}</span>
            <span className="text-sm text-muted">{[p.jobNumber, p.site].filter(Boolean).join(" · ")}</span>
            <span className="ml-auto text-sm text-muted">{p.elements.length ? p.elements.length + " floor(s) / panel(s)" : "empty"}</span>
          </Link>
        ))}
      </div>
      <form onSubmit={create} className="card grid max-w-xl gap-3">
        <h2 className="font-semibold">New project</h2>
        <label><span className="label">Name</span><input className="input" name="name" required placeholder="Lot 12, Salisbury" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label><span className="label">Job number</span><input className="input" name="job" placeholder="optional" /></label>
          <label><span className="label">Site address</span><input className="input" name="site" placeholder="optional" /></label>
        </div>
        <button className="btn btn-primary w-fit" type="submit">Create project</button>
      </form>
    </div>
  );
}
