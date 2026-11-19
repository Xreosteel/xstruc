import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canWrite, memberships } from "@/lib/org";
import { createElement } from "@/app/actions";

export default async function Project({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const { data: project } = await supabase.from("projects").select("id, org_id, name, job_number, site_address").eq("id", id).maybeSingle();
  if (!project) notFound();   // not there, or not this user's organisation: row-level security returns nothing either way
  const role = (await memberships(supabase, auth.user.id)).find(m => m.org_id === project.org_id)?.role ?? "viewer";
  const { data: elements } = await supabase.from("elements").select("id, kind, name, model_versions(number, status)")
    .eq("project_id", id).order("created_at");
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <div>
        <Link href="/projects" className="text-sm text-muted">← Projects</Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <div className="text-sm text-muted">{[project.job_number, project.site_address].filter(Boolean).join(" · ")}</div>
      </div>
      {error && <p className="text-accent">{error}</p>}
      <div className="grid gap-2">
        {(elements ?? []).length === 0 && <p className="text-muted">No floors or panels yet.</p>}
        {(elements ?? []).map(e => {
          const versions = (e.model_versions ?? []) as { number: number; status: string }[];
          const last = versions.sort((a, b) => b.number - a.number)[0];
          return (
            <Link key={e.id} href={"/elements/" + e.id} className="card flex items-baseline gap-4 hover:border-muted">
              <span className="font-semibold">{e.name}</span>
              <span className="text-sm text-muted">{e.kind === "panel" ? "Precast panel" : "Floor slab"}</span>
              <span className="ml-auto text-sm text-muted">{last ? "version " + last.number + " · " + last.status : "no versions yet"}</span>
            </Link>
          );
        })}
      </div>
      {canWrite(role) && (
        <form action={createElement} className="card grid max-w-xl gap-3">
          <h2 className="font-semibold">New floor or panel</h2>
          <input type="hidden" name="org" value={project.org_id} />
          <input type="hidden" name="project" value={project.id} />
          <label><span className="label">Name</span><input className="input" name="name" required placeholder="Level 1 floor, or P1" /></label>
          <label><span className="label">Kind</span>
            <select className="input" name="kind" defaultValue="floor"><option value="floor">Floor slab</option><option value="panel">Precast panel</option></select>
          </label>
          <button className="btn btn-primary w-fit" type="submit">Create</button>
        </form>
      )}
    </div>
  );
}
