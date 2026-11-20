import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { memberships } from "@/lib/org";
import { ROLES, ROLE_TEXT } from "@/lib/team";
import { addMember, changeRole, removeMember } from "./actions";

export default async function Team({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/sign-in");
  const orgs = await memberships(supabase, auth.user.id);
  if (!orgs.length) redirect("/");
  const org = orgs[0];
  const admin = org.role === "owner" || org.role === "admin";
  // the members row-level security lets this user see (their own organisation's), with emails looked up for those ids only
  const { data: rows } = await supabase.from("members").select("user_id, role, created_at").eq("org_id", org.org_id).order("created_at");
  const emails = new Map<string, string>();
  try {
    const a = supabaseAdmin();
    for (const r of rows ?? []) { const { data } = await a.auth.admin.getUserById(r.user_id); if (data.user?.email) emails.set(r.user_id, data.user.email); }
  } catch { /* no service key: show ids */ }
  const { error, ok } = await searchParams;
  return (
    <div className="grid gap-6">
      <div>
        <div className="text-sm text-muted">{org.name} · you are {org.role}</div>
        <h1 className="text-2xl font-semibold">Team</h1>
      </div>
      {error && <p className="text-accent" role="alert">{error}</p>}
      {ok && <p className="text-ok" role="status">{ok}</p>}
      <div className="card grid gap-2">
        {(rows ?? []).map(r => (
          <div key={r.user_id} className="flex flex-wrap items-center gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
            <span className="min-w-[16rem]">{emails.get(r.user_id) ?? r.user_id}{r.user_id === auth.user!.id ? " (you)" : ""}</span>
            {admin && r.user_id !== auth.user!.id ? (
              <>
                <form action={changeRole} className="flex items-center gap-2">
                  <input type="hidden" name="org" value={org.org_id} /><input type="hidden" name="user" value={r.user_id} />
                  <select className="input w-auto" name="role" defaultValue={r.role}>{ROLES.map(x => <option key={x} value={x}>{x}</option>)}</select>
                  <button className="btn" type="submit">Change</button>
                </form>
                <form action={removeMember}>
                  <input type="hidden" name="org" value={org.org_id} /><input type="hidden" name="user" value={r.user_id} />
                  <button className="btn" type="submit">Remove</button>
                </form>
              </>
            ) : <span className="font-mono text-sm text-muted">{r.role}</span>}
          </div>
        ))}
      </div>
      {admin && (
        <form action={addMember} className="card grid max-w-xl gap-3">
          <h2 className="font-semibold">Add a colleague</h2>
          <p className="text-sm text-muted">They sign in to X Struc once with their email (they will see “Start your organisation”: they should not start one). Then add that email here.</p>
          <input type="hidden" name="org" value={org.org_id} />
          <label><span className="label">Email they signed in with</span><input className="input" name="email" type="email" required /></label>
          <label><span className="label">Role</span>
            <select className="input" name="role" defaultValue="detailer">{ROLES.filter(r => r !== "owner" || org.role === "owner").map(r => <option key={r} value={r}>{ROLE_TEXT[r]}</option>)}</select>
          </label>
          <button className="btn btn-primary w-fit" type="submit">Add to {org.name}</button>
        </form>
      )}
    </div>
  );
}
