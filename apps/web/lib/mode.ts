import { configured } from "@/lib/env";

// Accounts (sign-in, organisations, the shared database, approvals) are switched off unless NEXT_PUBLIC_ACCOUNTS=1
// and Supabase is configured. Off is the default: X Struc opens straight to the jobs, and each device keeps its own
// (Baji, 2026-11-20: "no need for sign in"; saving: "on each device").
export const ACCOUNTS = process.env.NEXT_PUBLIC_ACCOUNTS === "1" && configured();
