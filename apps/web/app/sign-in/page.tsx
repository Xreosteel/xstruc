"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Microsoft 365 sign-in shows once it is set up in Supabase (NEXT_PUBLIC_MICROSOFT_SIGN_IN=1); everyone can use an
// email link (architecture v2 §9).
const MICROSOFT = process.env.NEXT_PUBLIC_MICROSOFT_SIGN_IN === "1";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const redirectTo = () => window.location.origin + "/auth/callback";

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) setNote(error);
  }, []);

  async function microsoft() {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "azure", options: { scopes: "email", redirectTo: redirectTo() } });
    if (error) setNote(error.message);
  }
  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } });
    setSending(false);
    setNote(error
      ? (/rate limit/i.test(error.message) ? "Too many sign-in emails just now. Wait a few minutes and try again." : error.message)
      : "Check your email (and junk folder) for the sign-in link from Supabase Auth. Open it on this device, in this browser.");
  }

  return (
    <div className="card mx-auto mt-10 max-w-md">
      <h1 className="text-xl font-semibold">Sign in to X Struc</h1>
      {MICROSOFT && (
        <>
          <button className="btn btn-primary mt-5 w-full justify-center" onClick={microsoft} type="button">Sign in with Microsoft 365</button>
          <div className="my-5 text-center text-sm text-muted">or get a link by email</div>
        </>
      )}
      <form onSubmit={emailLink} className={"grid gap-3" + (MICROSOFT ? "" : " mt-5")}>
        <label><span className="label">Email</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <button className={"btn w-full justify-center" + (MICROSOFT ? "" : " btn-primary")} type="submit" disabled={sending}>{sending ? "Sending…" : "Email me a sign-in link"}</button>
      </form>
      {note && <p className="mt-4 text-sm text-muted" role="status">{note}</p>}
    </div>
  );
}
