"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/env";

/** Supabase as the signed-in user, in the browser. Every query is still checked by row-level security. */
export const supabaseBrowser = () => createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
