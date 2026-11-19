"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// XREO staff sign in with their Microsoft 365 accounts; anyone else gets an email link (architecture v2 §9).
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const redirectTo = () => window.location.origin + "/auth/callback";

  async function microsoft() {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: redirectTo() } });
    if (error) setNote(error.message);
  }
  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    setNote(error ? error.message : "Check your email for the sign-in link.");
  }

  return (
    <div className="card mx-auto mt-10 max-w-md">
      <h1 className="text-xl font-semibold">Sign in to X Struc</h1>
      <button className="btn btn-primary mt-5 w-full justify-center" onClick={microsoft} type="button">Sign in with Microsoft 365</button>
      <div className="my-5 text-center text-sm text-muted">or get a link by email</div>
      <form onSubmit={emailLink} className="grid gap-3">
        <label><span className="label">Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <button className="btn w-full justify-center" type="submit">Email me a sign-in link</button>
      </form>
      {note && <p className="mt-4 text-sm text-muted" role="status">{note}</p>}
    </div>
  );
}
