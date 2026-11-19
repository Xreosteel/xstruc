# ADR-007 · Approval re-runs the engine; approved means frozen

**Date:** 2026-11-20 · **Status:** accepted

**Decision.** A saved version carries its inputs, the engine version and the SHA-256 of `canonicalOutput(model)`. The
approve route (`apps/web/app/api/versions/[id]/approve`) checks the user's role, rebuilds the version with the
server's engine and records the approval with the service role only if the engine version and hash match. The
database refuses an approved status without a matching approval and blocks any change to an approved version's
inputs, engine version or hash.
