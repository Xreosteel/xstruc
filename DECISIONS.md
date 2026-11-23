# X Struc decisions

Decisions Baji has made. Build to these; don't re-ask them. Newest first. A build run that needs a decision not listed here adds a question to the planning doc instead of guessing.

## 2026-11-23

- **Drawings to 3D by rules, not AI** ("dont use a claude api, make a proper engine that recognizes patterns and builds"): the drawing reader (`packages/reader`) recognises grids, slab edge, openings, notes and callouts by geometry and text rules and the engine's callout grammar; no AI service is called (research/17's suggestion service is dropped).
- **Same process as a person** ("use the same process when you receive a markup plan"): the reader goes through a plan in a scheduler's order (drawing, grids, slab edge, openings, notes, callouts, check, build) and reports each step.

## 2026-11-20

- **Build the real application now** ("proper application development … start from the beginning … proper applications architecture"). Architecture v2 in the architecture doc's **v2 · Lean build** tab.
- **Stack:** lean TypeScript: Next.js web app, the engine as a TypeScript package ported from the prototype, Supabase in Sydney (database, sign-in, files), Vercel hosting. The engine may move to Rust later only if speed demands it.
- **Repository:** the same repo (Xreosteel/xstruc), restructured as a monorepo; the prototype stays live in `apps/prototype` until the app replaces it.
- **First step:** the architecture doc and the foundation code.
- **First users:** XREO's own office and site crews first, built for many companies from day one; billing when outside firms join.
- **No sign-in for now** ("no need for sign in and such"): the web app opens straight to the projects, with no accounts, email links or organisations. **Jobs are saved on each device** (in the browser), with backup / restore files to keep a copy or move them; nothing is sent to the database. The accounts code (sign-in, organisations, roles, approvals, the Supabase project in Sydney) stays in the repo, switched off (`NEXT_PUBLIC_ACCOUNTS=1` turns it back on) until Baji wants shared jobs.

## 2026-11-16

- **Precast panels:** the viewer shows precast panels as well as floors, with a switch between them.
- **Panel faces:** the two faces are named as on a precast shop drawing, NF (near face) and FF (far face); the face cast down on the bed is stated per panel.
- **Bars or mesh per face:** each face can be reinforced with bars or with mesh, chosen per face, and the viewer must show both kinds.

## 2026-11-04

- **Primary user: site crews.** Leading hands, foremen and fixers building the reo from the model. Site-facing features lead the backlog; scheduling-office and bending-machine features follow.
- **Next site feature:** a layer-by-layer fixing view for a tablet (big type, one layer at a time, tap a bar for mark, setout and laps), then per-layer placing drawings.
- **Set-downs:** Z-bar splices across shallow set-downs, cranked at 1:6 or flatter with a 300 minimum crank (SRIA TN5).
- **Layer direction:** no default. If a mat callout does not say which way it runs (E-W / N-S), the inputs panel reports an error and asks; the model is not built with a guessed direction.
- **Shape codes:** CIA/ARC letters (S, L, LL, U, T, CC, ZL …). Schedule dimensions are to the bar extremities, cog included.
- **Hook and cog values:** AS 3600-derived (Cl 17.2.3.2 pins, Cl 13.1.2.7 hooks/cogs) as the default. A per-shop allowance table can come later as a setting.
- **Thin-slab cogs:** the longest cog that fits, flagged on the bar, the mark and the model until the engineer confirms the cog length.
- **Laps:** where a drawing's general notes give a lap table, use the engineer's numbers and flag any that differ from the AS 3600 Section 13 formula; computed laps round up to 50 mm; cd = min(cover, half clear spacing) with the governing value shown. The flat "lap, all bars" input stays the project default until a table is entered.
- **Machine files:** BVBS export only (no import) for now. Grade strings are a per-shop setting, default `500N` / `500L` / `250N`. The shops Baji knows schedule in Excel; their bending machines are not known yet.
