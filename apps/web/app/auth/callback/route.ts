import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// Where Microsoft and the email link send the user back.
// ?code=… (the default link): swap the one-time code for a session cookie. This only works in the browser that asked
//   for the link, because that browser holds the matching secret.
// ?token_hash=…&type=… (the email template in docs/launch.md): works in any browser, on any device.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const code = p.get("code"), tokenHash = p.get("token_hash"), type = p.get("type") as EmailOtpType | null;
  const supabase = await supabaseServer();
  let message = "That sign-in link did not work. Ask for a new one.";
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", request.url));
    message = "That sign-in link has expired or was already used. Ask for a new one.";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
    message = /verifier/i.test(error.message)
      ? "Open the sign-in link in the same browser you asked for it from (or ask for a new one here)."
      : "That sign-in link has expired or was already used. Ask for a new one.";
  } else if (p.get("error_description")) {
    message = p.get("error_description")!;
  }
  return NextResponse.redirect(new URL("/sign-in?error=" + encodeURIComponent(message), request.url));
}
