# ADR-004 · One monorepo, the prototype kept live

**Date:** 2026-11-20 · **Status:** accepted

**Decision.** `Xreosteel/xstruc` becomes a pnpm + Turborepo monorepo and keeps its history. The prototype moves to
`apps/prototype` and stays live (GitHub Pages, the claude.ai artifact) until `apps/web` replaces it; its page is built
with the engine inlined from `packages/engine`, byte for byte the page it was before the move.
