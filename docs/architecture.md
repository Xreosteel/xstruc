# X Struc architecture

The architecture lives in the claude.ai doc **X Struc — Production System Architecture**, tab **v2 · Lean build**
(20 Nov 2026): https://claude.ai/artifact/D7Jf59XywqkZmL8UK7xeGm. The 3 Nov plan is its second tab, kept for its
research. Read the doc with the Claude Docs tools, not WebFetch. This file is the short version for the repo.

- **Stack:** TypeScript everywhere. Next.js on Vercel (Sydney), Supabase in Sydney (Postgres with row-level
  security, Auth with Microsoft 365 sign-in, Storage), the engine as a TypeScript package.
- **Repo:** `apps/web` (the application), `apps/prototype` (the single-page viewer and installable app, live on
  GitHub Pages and the claude.ai artifact until the app replaces it), `packages/engine` (the reinforcement engine,
  single source of truth, inlined into the prototype at build), `packages/viewer` (Phase 1), `supabase/` (migrations
  and their tests), `docs/adr/` (decision records).
- **Rules:** packages never import from apps; the engine imports nothing (no DOM, no three.js, no network, no
  clock, no randomness); only `apps/web` talks to Supabase; every table has `org_id` and row-level security.
- **Approval:** a draft model version is approved only when the server rebuilds it with the same engine version and
  gets the same SHA-256 of `canonicalOutput(model)`; approved versions are frozen by the database.
- **Phases:** 0 foundation (Nov to Dec 2026) · 1 model and review (Jan to Mar 2027) · 2 site (Mar to Apr) ·
  3 drawing input (Apr to Jul) · 4 precast and outputs (Jul to Aug) · 5 SaaS launch (Sep to Oct 2027).
