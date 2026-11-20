import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";
import { ACCOUNTS } from "@/lib/mode";

// Runs before every page (Next.js 16 "proxy", formerly middleware). With accounts on: refreshes the Supabase session
// cookie and sends signed-out visitors to the sign-in page. Data access is still decided by row-level security, not here.
const OPEN = ["/sign-in", "/auth", "/demo"];   // /demo: the examples in 3D, no account needed
// With accounts off (the default) nobody signs in: the account screens send you to the projects on this device.
const ACCOUNT_ONLY = ["/sign-in", "/auth", "/projects", "/elements", "/team", "/api/versions"];

export async function proxy(request: NextRequest) {
  if (!ACCOUNTS) {
    const path = request.nextUrl.pathname;
    if (!ACCOUNT_ONLY.some(p => path === p || path.startsWith(p + "/"))) return NextResponse.next();
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Accounts are switched off." }, { status: 404 });
    const url = request.nextUrl.clone(); url.pathname = "/"; url.search = "";
    return NextResponse.redirect(url);
  }
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
