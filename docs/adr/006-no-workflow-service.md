# ADR-006 · No workflow service at first

**Date:** 2026-11-20 · **Status:** accepted (supersedes Temporal of the 3 Nov plan)

**Decision.** Drawing parsing (Phase 3) runs in the browser (pdf.js, a DXF parser). Server jobs, when needed, use
Supabase Queues with Vercel cron.

**Revisit if** server-side jobs grow long or many-stepped.
