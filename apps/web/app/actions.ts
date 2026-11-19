"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

// Server actions for the forms. Each runs as the signed-in user, so row-level security decides what is allowed;
// a refused write comes back as an error message on the page.
const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (path: string, message: string): never => redirect(path + "?error=" + encodeURIComponent(message));

export async function signOut() {
  await (await supabaseServer()).auth.signOut();
  redirect("/sign-in");
}

export async function createOrganisation(form: FormData) {
  const name = text(form, "name");
  if (!name) back("/", "Give the organisation a name.");
  const { error } = await (await supabaseServer()).rpc("create_organisation", { org_name: name, org_short_name: text(form, "short") || null });
  if (error) back("/", error.message);
  redirect("/projects");
}

export async function createProject(form: FormData) {
  const name = text(form, "name"), org = text(form, "org");
  if (!name) back("/projects", "Give the project a name.");
  const { data, error } = await (await supabaseServer()).from("projects")
    .insert({ org_id: org, name, job_number: text(form, "job") || null, site_address: text(form, "site") || null })
    .select("id").single();
  if (error) back("/projects", error.message);
  revalidatePath("/projects");
  redirect("/projects/" + data!.id);
}

export async function createElement(form: FormData) {
  const project = text(form, "project"), org = text(form, "org"), name = text(form, "name");
  const kind = text(form, "kind") === "panel" ? "panel" : "floor";
  if (!name) back("/projects/" + project, "Give the element a name, e.g. Level 1 floor or P1.");
  const { data, error } = await (await supabaseServer()).from("elements")
    .insert({ org_id: org, project_id: project, kind, name }).select("id").single();
  if (error) back("/projects/" + project, error.message);
  redirect("/elements/" + data!.id);
}
