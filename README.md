# X Struc

3D slab and reinforcement viewer, built towards a SaaS that turns engineers' markup plans into verified 3D reo models and fabrication-ready bar schedules (Australian notation, AS 3600 / AS/NZS 4671).

**Live prototype:** https://claude.ai/artifact/AyxtiYDBagzRjSgJ3sQgM8 (private; share from the page's Share menu)

## Run it

Open `index.html` in a browser. Everything is in that one file; three.js loads from a CDN.

```
npm test        # headless model check (scripts/check.js)
node scripts/check.js --marks   # also print the bar schedule
```

## How development works

This repo is developed by scheduled Claude runs every 6 hours plus manual sessions. Each run takes the top item of `BACKLOG.md`, builds it, runs the check, pushes, republishes the viewer and writes `DEVLOG.md`. The rules are in `CLAUDE.md`.

## Docs

- Architecture: https://claude.ai/artifact/D7Jf59XywqkZmL8UK7xeGm
- Australian reinforcement notation reference: https://claude.ai/artifact/Di9ePutHNpoTtwQ5ZC3bsX
