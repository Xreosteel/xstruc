import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { ACCOUNTS } from "@/lib/mode";
import { supabaseServer } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

export const metadata: Metadata = {
  title: "X Struc",
  description: "Reinforcement models, placing drawings and bar schedules from engineers' drawings."
};
export const viewport: Viewport = { themeColor: "#11151a", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let email: string | null = null;
  if (ACCOUNTS) {
    const { data } = await (await supabaseServer()).auth.getUser();
    email = data.user?.email ?? null;
  }
  return (
    <html lang="en-AU">
      <body className="min-h-screen font-sans">
        <header className="flex items-center gap-4 border-b border-line px-5 py-3">
          <Link href="/" className="text-lg font-semibold tracking-wide">X STRUC</Link>
          <nav className="flex gap-4 text-sm text-muted">
            {!ACCOUNTS && <Link href="/">Projects</Link>}
            {email && <Link href="/projects">Projects</Link>}
            {email && <Link href="/team">Team</Link>}
            <Link href="/demo">Demo</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted">
            {!ACCOUNTS && <span>Saved on this device</span>}
            {email && <span>{email}</span>}
            {email && <form action={signOut}><button className="btn" type="submit">Sign out</button></form>}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-5 py-6">{children}</main>
      </body>
    </html>
  );
}
