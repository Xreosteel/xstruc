import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canWrite, memberships } from "@/lib/org";
import { createProject } from "@/app/actions";

export default async function Projects({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const orgs = await memberships(supabase, auth.user.id);
  if (!orgs.length) redirect("/");
  const org = orgs[0];
  const { data: projects } = await supabase.from("projects").select("id, name, job_number, site_address, created_at")
    .eq("org_id", org.org_id).order("created_at", { ascending: false });
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <div>
        <div className="text-sm text-muted">{org.name} · {org.role}</div>
        <h1 className="text-2xl font-semibold">Projects</h1>
      </div>
      {error && <p className="text-accent">{error}</p>}
      <div className="grid gap-2">
        {(projects ?? []).length === 0 && <p className="text-muted">No projects yet.</p>}
        {(projects ?? []).map(p => (
          <Link key={p.id} href={"/projects/" + p.id} className="card flex items-baseline gap-4 hover:border-muted">
            <span className="font-semibold">{p.name}</span>
            {p.job_number && <span className="font-mono text-sm text-muted">{p.job_number}</span>}
            {p.site_address && <span className="text-sm text-muted">{p.site_address}</span>}
          </Link>
        ))}
      </div>
      {canWrite(org.role) && (
        <form action={createProject} className="card grid max-w-xl gap-3">
          <h2 className="font-semibold">New project</h2>
          <input type="hidden" name="org" value={org.org_id} />
          <label><span className="label">Project name</span><input className="input" name="name" required placeholder="Salisbury warehouse" /></label>
          <label><span className="label">Job number</span><input className="input" name="job" placeholder="J-1001" /></label>
          <label><span className="label">Site address</span><input className="input" name="site" /></label>
          <button className="btn btn-primary w-fit" type="submit">Create project</button>
        </form>
      )}
    </div>
  );
}
