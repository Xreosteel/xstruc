import { redirect } from "next/navigation";
import { configured } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import { memberships } from "@/lib/org";
import { createOrganisation } from "@/app/actions";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!configured()) {
    return (
      <div className="card max-w-2xl">
        <h1 className="text-xl font-semibold">X Struc is not connected to its database yet</h1>
        <p className="mt-3 text-muted">Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (see <code>apps/web/.env.example</code>) for the Supabase project in Sydney, apply the migrations in <code>supabase/migrations</code>, and reload.</p>
        <p className="mt-3">Meanwhile the examples are in the <a className="underline" href="/demo">3D demo</a>.</p>
      </div>
    );
  }
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/sign-in");
  const orgs = await memberships(supabase, data.user.id);
  if (orgs.length) redirect("/projects");
  const { error } = await searchParams;
  return (
    <div className="card max-w-xl">
      <h1 className="text-xl font-semibold">Start your organisation</h1>
      <p className="mt-2 text-muted">You are not in an organisation yet. If you work at a company already using X Struc (XREO, for example), do not start a new one: send the email you signed in with to its owner or admin, who adds you on their Team page, then reload this page. Otherwise start your organisation here; you become its owner.</p>
      {error && <p className="mt-3 text-accent">{error}</p>}
      <form action={createOrganisation} className="mt-4 grid gap-3">
        <label><span className="label">Name</span><input className="input" name="name" placeholder="XREO" required /></label>
        <label><span className="label">Short name (letters, digits, dashes)</span><input className="input" name="short" placeholder="xreo" pattern="[a-z0-9-]{2,40}" /></label>
        <button className="btn btn-primary w-fit" type="submit">Create organisation</button>
      </form>
    </div>
  );
}
