"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findUserIdByEmail, isRole } from "@/lib/team";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (message: string, ok = false): never => redirect("/team?" + (ok ? "ok=" : "error=") + encodeURIComponent(message));

export async function addMember(form: FormData) {
  const org = text(form, "org"), email = text(form, "email"), role = text(form, "role");
  if (!/^\S+@\S+\.\S+$/.test(email)) back("Enter the email address they signed in with.");
  if (!isRole(role)) back("Pick a role.");
  let userId: string | null = null;
  try { userId = await findUserIdByEmail(supabaseAdmin().auth.admin, email); } catch (e) { back("Could not look up users: " + (e as Error).message); }
  if (!userId) back(email + " has not signed in yet. Ask them to open X Struc and sign in with that email once, then add them here.");
  // written as the signed-in user: row-level security allows owners and admins only, and only owners can add an owner
  const { error } = await (await supabaseServer()).from("members").insert({ org_id: org, user_id: userId, role });
  if (error) back(/duplicate key/.test(error.message) ? email + " is already in the team." : error.message);
  revalidatePath("/team");
  back(email + " added as " + role + ".", true);
}

export async function changeRole(form: FormData) {
  const org = text(form, "org"), user = text(form, "user"), role = text(form, "role");
  if (!isRole(role)) back("Pick a role.");
  const { error, count } = await (await supabaseServer()).from("members").update({ role }, { count: "exact" }).eq("org_id", org).eq("user_id", user);
  if (error) back(error.message);
  if (!count) back("You cannot change that member's role.");
  revalidatePath("/team");
  back("Role changed to " + role + ".", true);
}

export async function removeMember(form: FormData) {
  const org = text(form, "org"), user = text(form, "user");
  const { error, count } = await (await supabaseServer()).from("members").delete({ count: "exact" }).eq("org_id", org).eq("user_id", user);
  if (error) back(error.message);
  if (!count) back("You cannot remove that member.");
  revalidatePath("/team");
  back("Member removed.", true);
}
