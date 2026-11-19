# ADR-002 · Supabase in Sydney for the database, sign-in and files

**Date:** 2026-11-20 · **Status:** accepted (supersedes Aurora, S3 and WorkOS of the 3 Nov plan)

**Decision.** Supabase (ap-southeast-2): Postgres with row-level security on every table for tenancy, Auth with
Microsoft 365 (Azure AD) for XREO staff and email links for others, Storage with one folder per organisation.
Schema changes are SQL migrations in `supabase/migrations`, tested in PGlite (`supabase/tests`).

**Revisit if** a customer requires AWS-only hosting or needs what Supabase lacks. The exit is plain Postgres plus the
same SQL migrations.
