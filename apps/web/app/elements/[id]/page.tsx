import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { canApprove, canWrite, memberships } from "@/lib/org";
import { Workbench, type VersionRow } from "./workbench";

export default async function Element({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const { data: el } = await supabase.from("elements").select("id, org_id, kind, name, projects(id, name)").eq("id", id).maybeSingle();
  if (!el) notFound();
  const role = (await memberships(supabase, auth.user.id)).find(m => m.org_id === el.org_id)?.role ?? "viewer";
  const { data: versions } = await supabase.from("model_versions")
    .select("id, number, status, engine_version, output_hash, summary, inputs, created_at")
    .eq("element_id", id).order("number", { ascending: false });
  const project = (Array.isArray(el.projects) ? el.projects[0] : el.projects) as { id: string; name: string } | null;
  return (
    <div className="grid gap-4">
      <div>
        {project && <Link href={"/projects/" + project.id} className="text-sm text-muted">← {project.name}</Link>}
        <h1 className="text-2xl font-semibold">{el.name} <span className="text-base font-normal text-muted">{el.kind === "panel" ? "precast panel" : "floor slab"}</span></h1>
      </div>
      <Workbench
        element={{ id: el.id, org_id: el.org_id, kind: el.kind as "floor" | "panel" }}
        versions={(versions ?? []) as VersionRow[]}
        canWrite={canWrite(role)}
        canApprove={canApprove(role)}
      />
    </div>
  );
}
