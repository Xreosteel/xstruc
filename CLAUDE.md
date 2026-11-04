# X Struc — instructions for every working session

X Struc is a browser-based 3D slab-and-reinforcement viewer that will grow into a SaaS that turns engineers' markup plans into bar schedules. Owner: Baji (Xreosteel). Read this file, then `DEVLOG.md` (latest entry first), then `BACKLOG.md`.

## What exists

- `index.html` — the whole app, self-contained (three.js r128 + OrbitControls from CDN, everything else inline). It renders an example Level 1 floor with layers A–D, beams, columns with starters, a set-down, a step, a balcony, openings, L/Z-bars and extras, with a fixing-order stepper, tags, an inspector and a live bar schedule.
- The model code sits between `// === MODEL START ===` and `// === MODEL END ===` inside the inline script: `DEFAULT_CFG`, `parseCallout(text, {scheme})`, `buildModel(cfg)` → `{bars, runs, chairs, sched, marks, errors, warnings, …}`. It must stay headless (no DOM, no THREE) so the scripts can run it in Node. The viewer side calls `rebuild(cfg)` which tears down and rebuilds the scene.
- `scripts/check.js` — parses the page, runs `buildModel` headlessly on several configs, asserts invariants. `scripts/test-grammar.js` — callout grammar cases. `scripts/test-shapes.js` — bending geometry against the AS 3600-derived table. `scripts/smoke.js <dir with node_modules/three>` — headless Chromium run of the page (install `three@0.128.0` in a scratch dir first; the CDN is not reachable from the test container). **`npm test` must pass before every commit; run the smoke test when the viewer code changes.**
- Design docs (claude.ai docs, read them with the Artifact/docs tools, not WebFetch):
  - Architecture: https://claude.ai/artifact/D7Jf59XywqkZmL8UK7xeGm
  - Notation reference (Australian reo callouts, schedules, abbreviations): https://claude.ai/artifact/Di9ePutHNpoTtwQ5ZC3bsX
- Published viewer (artifact, keep this URL): https://claude.ai/artifact/AyxtiYDBagzRjSgJ3sQgM8

## Rules for a scheduled run

1. **One backlog item per run.** Take the top unchecked item in `BACKLOG.md`. If it can't be finished in one run, split it into sub-items in place and finish the first.
2. **Don't guess engineering.** Anything that needs an engineer's decision (a detail, a lap value not in a cited table, a convention) goes under "Parked" in the backlog with a one-line question. Use what the drawings/standards say and cite the source in a code comment.
3. **Check before commit.** `node scripts/check.js` (and `node scripts/test-grammar.js` once it exists) must pass. If the page gets a new script section, make sure the whole inline script still parses (check.js does this).
4. **Keep the page self-contained and publishable.** One `index.html`; external scripts only from cdnjs / jsDelivr / unpkg pinned to exact versions; no downloads or `window.open` (blocked in the artifact viewer); `<title>` stays `X Struc Viewer`.
5. **Commit and push** to `main` with a message like `feat: callout grammar (#2)` referencing the backlog number. Commit messages end with the attribution lines the session is given.
6. **Republish the viewer** to the artifact URL above: first `Artifact` read of that URL (a publish to an unread artifact is refused), then publish `index.html` with `url` set to it. Never create a second artifact and never delete it.
7. **Write the devlog entry** (`DEVLOG.md`, newest first): date, item done, what changed, check output line, anything parked, what the next run should take. Tick the item in `BACKLOG.md`.
8. **Stop early rather than push broken work.** If the item can't be made to pass the check, leave the code uncommitted, write a devlog entry describing the blocker, and end.
9. **Don't change** bar sizes/spacings/laps of the example without a backlog item saying so; don't rename layers A–D; don't reorder the fixing sequence.

## Conventions

- Units: millimetres in the model, metres in the scene (`W(x, y, z)` converts). z = 0 at the main slab soffit; x east, y north.
- Layers: A bottom 1st, B bottom 2nd, C top 3rd, D top 4th (Australian B1/B2/T2/T1). Outer layers A and D run the same way; inner layers B and C run the same way.
- Every bar has `pts` (polyline, mm), `size`, `type` (`N` or `R`), `layer`, `shape`, `run`, `setout`, `note`; `len` and `kg` are derived in `addBar`. Bars with `existing: true` are context only and stay out of the schedule.
- Every run has `label` (short tag text), `callout` (drawing-style wording) and either `dist` (distribution line) or `tagPos` for its tag anchor.
- Keep the UI copy plain and in placing-drawing language (count, size, spacing, layer).
