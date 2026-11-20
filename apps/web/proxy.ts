import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL, configured } from "@/lib/env";

// Runs before every page (Next.js 16 "proxy", formerly middleware): refreshes the Supabase session cookie and sends
// signed-out visitors to the sign-in page. Data access is still decided by row-level security, not here.
const OPEN = ["/sign-in", "/auth", "/demo"];   // /demo: the examples in 3D, no account needed

export async function proxy(request: NextRequest) {
  if (!configured()) return NextResponse.next();   // no Supabase yet: the home page explains the setup
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  const { data } = await supabase.auth.getUser();
  if (!data.user && !OPEN.some(p => request.nextUrl.pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"] };
