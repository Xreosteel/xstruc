// Supabase settings. NEXT_PUBLIC_ values are inlined into the browser bundle (they are public by design; the
// database's row-level security is what protects the data). The service key is read only in server code.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const configured = (): boolean => Boolean(SUPABASE_URL && SUPABASE_KEY);
