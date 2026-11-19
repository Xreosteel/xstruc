import type { SupabaseClient } from "@supabase/supabase-js";

export interface Membership { org_id: string; role: string; name: string }

/** The organisations the signed-in user belongs to (row-level security returns only theirs), oldest first. */
export async function memberships(supabase: SupabaseClient, userId: string): Promise<Membership[]> {
  const { data } = await supabase.from("members").select("org_id, role, created_at, organisations(name)")
    .eq("user_id", userId).order("created_at");
  return (data ?? []).map((m: { org_id: string; role: string; organisations: { name: string } | { name: string }[] | null }) => ({
    org_id: m.org_id,
    role: m.role,
    name: Array.isArray(m.organisations) ? m.organisations[0]?.name ?? "" : m.organisations?.name ?? ""
  }));
}

export const canWrite = (role: string) => ["owner", "admin", "approver", "detailer"].includes(role);
export const canApprove = (role: string) => ["owner", "admin", "approver"].includes(role);
