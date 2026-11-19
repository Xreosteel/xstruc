# ADR-003 · Vercel hosts the web app

**Date:** 2026-11-20 · **Status:** accepted

**Decision.** `apps/web` (Next.js) deploys to Vercel with server functions in Sydney (syd1); a preview deploy per pull
request; the service-role key only in Vercel's server environment.

**Revisit if** cost or limits bite at scale.
