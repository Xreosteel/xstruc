# ADR-001 · The engine is TypeScript, ported from the prototype

**Date:** 2026-11-20 · **Status:** accepted (supersedes the Rust kernel of the 3 Nov plan)

**Context.** One developer plus AI, about 10 months to an October 2027 launch. The prototype's engine already builds
floors, panels, mesh, stairs, sheets and sections and is covered by automated checks.

**Decision.** The engine is `packages/engine`, a pure TypeScript package (today the prototype's JavaScript moved
verbatim behind a typed API; converted to strict TypeScript module by module in Phase 1). It runs in the browser
(Web Worker), on the server (approval, exports) and in the tests, and is inlined into the prototype page.

**Revisit if** profiling on real jobs shows the engine is the bottleneck; a Rust/WASM port can sit behind the same API.
