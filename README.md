# X Struc

3D slab and reinforcement viewer, built towards a SaaS that turns engineers' markup plans into verified 3D reo models and fabrication-ready bar schedules (Australian notation, AS 3600 / AS/NZS 4671).

**Live viewer:** https://xreosteel.github.io/xstruc/ (public, deployed from `main` by GitHub Actions) · claude.ai artifact: https://claude.ai/artifact/AyxtiYDBagzRjSgJ3sQgM8 (private; share from the page's Share menu)

## Install it as an app

Open https://xreosteel.github.io/xstruc/ and press **Install app** at the top (Chrome, Edge, Android), or in Safari on an iPhone / iPad tap **Share › Add to Home Screen** (on a Mac: **File › Add to Dock**). It gets its own icon and window, opens with no signal once it has been opened online, keeps what you typed on that device, and offers **Reload** when a new version is out.

## Run it

Open `index.html` in a browser. Everything is in that one file; three.js loads from a CDN.

```
npm test        # model, grammar, shapes, panel and app-build checks
node scripts/check.js --marks   # also print the bar schedule
node scripts/build-app.js _site # the installable app as GitHub Pages serves it
```

## How development works

This repo is developed by scheduled Claude runs every 6 hours plus manual sessions. Each run takes the top item of `BACKLOG.md`, builds it, runs the check, pushes, republishes the viewer and writes `DEVLOG.md`. The rules are in `CLAUDE.md`.

## Docs

- Architecture: https://claude.ai/artifact/D7Jf59XywqkZmL8UK7xeGm
- Australian reinforcement notation reference: https://claude.ai/artifact/Di9ePutHNpoTtwQ5ZC3bsX
