# X Struc

3D slab and reinforcement viewer, built towards a SaaS that turns engineers' markup plans into verified 3D reo models and fabrication-ready bar schedules (Australian notation, AS 3600 / AS/NZS 4671).

**Live viewer:** https://xreosteel.github.io/xstruc/ (public, deployed from `main` by GitHub Actions) · claude.ai artifact: https://claude.ai/artifact/AyxtiYDBagzRjSgJ3sQgM8 (private; share from the page's Share menu)

## Install it as an app

Open https://xreosteel.github.io/xstruc/ and press **Install app** at the top (Chrome, Edge, Android), or in Safari on an iPhone / iPad tap **Share › Add to Home Screen** (on a Mac: **File › Add to Dock**). It gets its own icon and window, opens with no signal once it has been opened online, keeps what you typed on that device, and offers **Reload** when a new version is out.

## The repo

A pnpm + Turborepo monorepo (architecture v2: `docs/architecture.md`, `docs/adr/`):

| Folder | What |
|---|---|
| `apps/web` | The application: Next.js on Vercel, Supabase in Sydney (sign-in, projects, floors and panels, versions, approval) |
| `apps/prototype` | The single-page viewer and installable app above, live until the application replaces it |
| `packages/engine` | The reinforcement engine (bars, mesh, marks, schedules, placing sheets, sections): one copy, used by both |
| `supabase` | Database migrations (row-level security, approvals, audit log) and their tests |

## Run it

```
corepack enable                  # once, for pnpm
pnpm install
pnpm test                        # every package: engine, prototype checks, web, database (PGlite)
pnpm build                       # apps/prototype/dist/index.html and the web app
pnpm --filter @xstruc/web dev    # the application on http://localhost:3000 (copy apps/web/.env.example to .env.local)
node apps/prototype/scripts/check.js --marks   # print the example's bar schedule
```

## How development works

This repo is developed by scheduled Claude runs every 6 hours plus manual sessions. Each run takes the top item of `BACKLOG.md`, builds it, runs the check, pushes, republishes the viewer and writes `DEVLOG.md`. The rules are in `CLAUDE.md`.

## Docs

- Architecture: https://claude.ai/artifact/D7Jf59XywqkZmL8UK7xeGm
- Australian reinforcement notation reference: https://claude.ai/artifact/Di9ePutHNpoTtwQ5ZC3bsX
