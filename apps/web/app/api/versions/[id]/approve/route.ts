import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkForApproval, type StoredVersion } from "@/lib/engine-run";

// Approve a draft version (architecture v2 ADR-007). As the signed-in user: the version must be visible to them and
// they must be an owner, admin or approver of its organisation. Then the server rebuilds it with its own copy of the
// engine and records the approval with the service role only if the hash matches. The database refuses an approved
// status without a matching approval and freezes the version from then on.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data: v } = await supabase.from("model_versions").select("id, org_id, number, inputs, engine_version, output_hash, status").eq("id", id).maybeSingle();
  if (!v) return NextResponse.json({ error: "No such version." }, { status: 404 });
  const { data: allowed } = await supabase.rpc("has_role", { target_org: v.org_id, roles: ["owner", "admin", "approver"] });
  if (!allowed) return NextResponse.json({ error: "Only an owner, admin or approver can approve." }, { status: 403 });

  const check = await checkForApproval(v as StoredVersion);
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

  const admin = supabaseAdmin();
  const { error: e1 } = await admin.from("approvals").insert({
    org_id: v.org_id, version_id: v.id, approved_by: auth.user.id, engine_version: v.engine_version, output_hash: check.hash
  });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 409 });
  const { error: e2 } = await admin.from("model_versions").update({ status: "approved" }).eq("id", v.id).eq("status", "draft");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 409 });
  return NextResponse.json({ ok: true, number: v.number, hash: check.hash });
}
