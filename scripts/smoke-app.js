#!/usr/bin/env node
// Browser smoke test of the installable app (backlog #34): builds it, serves it on localhost under /xstruc/ like GitHub
// Pages, and in headless Chromium checks that Chrome finds it installable, that typed inputs come back after a reload,
// that it opens and builds the model with the server stopped and the network off, and that a new deploy shows the
// "new version" bar and Reload brings it in. The CDN is not reachable from the test container, so three.js is served
// from a local copy at the CDN's own URLs (the worker sees the same cross-origin requests it would in the field).
// Usage: node scripts/smoke-app.js <dir containing node_modules/three> [outDir] [--screenshots]
//   --screenshots also writes app/screenshots/wide.webp and narrow.webp for the manifest (needs `sharp`).
"use strict";
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";   // route the worker's own fetches too (older Playwright)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");
const { build } = require("./build-app");

const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
const SHOTS = process.argv.includes("--screenshots");
const threeDir = path.resolve(args[0] || ".");
const outDir = path.resolve(args[1] || threeDir);
const CDN = {
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js": path.join(threeDir, "node_modules/three/build/three.min.js"),
  "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js": path.join(threeDir, "node_modules/three/examples/js/controls/OrbitControls.js")
};
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp" };

function serve(dir, port) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (!u.pathname.startsWith("/xstruc/")) { res.writeHead(404); return res.end(); }
    let f = path.join(dir, decodeURIComponent(u.pathname.slice("/xstruc/".length)) || "index.html");
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "max-age=600" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(port, "127.0.0.1", () => ok(srv)));
}
const stop = srv => new Promise(ok => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(() => ok()); });
const fail = msg => { console.error("smoke-app: FAIL\n  " + msg); process.exit(1); };

(async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "xstruc-siteA-"));
  const A = build(dirA);
  const port = 8800 + Math.floor(Math.random() * 400), base = "http://127.0.0.1:" + port + "/xstruc/";
  let srv = await serve(dirA, port);

  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const routeCdn = async () => {
    for (const u of Object.keys(CDN)) await ctx.route(u, r => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(CDN[u]) }));
    await ctx.route(/fonts\.googleapis\.com/, r => r.fulfill({ status: 200, contentType: "text/css", headers: { "Access-Control-Allow-Origin": "*" }, body: "" }));
    await ctx.route(/fonts\.gstatic\.com/, r => r.abort());
  };
  await routeCdn();
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  const stats = () => page.evaluate(() => ({ bars: document.querySelector("#stBars").textContent, mode: window.xstruc.mode(), line: document.querySelector("#slabline").textContent,
    version: (document.querySelector('meta[name="xstruc-version"]') || {}).content, app: window.xstruc.app.on, controlled: !!navigator.serviceWorker.controller,
    errs: [...document.querySelectorAll("#inErrs li:not(.warn)")].map(e => e.textContent), offline: !document.querySelector("#offChip").hidden, update: !document.querySelector("#appUpdate").hidden }));

  // 1. first visit: the worker installs, keeps the files and takes the page over without a reload
  await page.goto(base);
  await page.waitForFunction(() => window.xstruc && navigator.serviceWorker.controller, null, { timeout: 20000 }).catch(() => fail("the offline worker did not take over the page"));
  const s1 = await stats();
  console.log("first visit:", JSON.stringify(s1));
  const FLOOR = s1.bars;   // the example floor's bar count, whatever the example holds today
  if (!/^[\d,]+$/.test(FLOOR) || FLOOR === "0" || !s1.app || s1.version !== A.version || !/Example floor/.test(s1.line)) fail("first visit should build the example floor as the app, version " + A.version);
  const kept = await page.evaluate(async () => { const ks = await caches.keys(); const c = await caches.open(ks.find(k => k !== "xstruc-fonts")); return { caches: ks, files: (await c.keys()).map(r => r.url) }; });
  console.log("kept:", kept.caches.join(", "), "·", kept.files.length, "files");
  if (kept.files.length !== A.precache.length) fail("worker kept " + kept.files.length + " files, expected " + A.precache.length + ": " + kept.files.join(" "));

  // 2. Chrome's own installability verdict and the manifest as Chrome parsed it
  const cdp = await ctx.newCDPSession(page);
  const man = await cdp.send("Page.getAppManifest");
  const inst = await cdp.send("Page.getInstallabilityErrors").catch(e => ({ installabilityErrors: [{ errorId: "cdp: " + e.message }] }));
  console.log("manifest errors:", JSON.stringify(man.errors), "installability:", JSON.stringify(inst.installabilityErrors));
  if ((man.errors || []).length) fail("Chrome reports manifest errors: " + JSON.stringify(man.errors));
  if ((inst.installabilityErrors || []).length) fail("Chrome says not installable: " + JSON.stringify(inst.installabilityErrors));

  // 3. inputs kept on the device: edit the floor, switch to the panel, reload, and both come back
  await page.fill("#inThk", "250"); await page.waitForTimeout(800);
  await page.click("#modePanel"); await page.waitForTimeout(600);
  const PANEL = await page.textContent("#stBars");
  await page.fill("#pnName", "P7"); await page.waitForTimeout(800);
  await page.reload(); await page.waitForFunction(() => window.xstruc && window.xstruc.model());
  const s3 = await page.evaluate(() => ({ mode: window.xstruc.mode(), name: document.querySelector("#pnName").value, thk: document.querySelector("#inThk").value, P: window.xstruc.model().name, line: document.querySelector("#slabline").textContent }));
  console.log("after reload:", JSON.stringify(s3));
  if (s3.mode !== "panel" || s3.name !== "P7" || s3.thk !== "250" || s3.P !== "P7" || !/Custom panel/.test(s3.line)) fail("inputs were not kept across a reload");
  await page.goto(base + "?floor"); await page.waitForFunction(() => window.xstruc && window.xstruc.model());
  const s3b = await page.evaluate(() => ({ mode: window.xstruc.mode(), T: window.xstruc.model().T, line: document.querySelector("#slabline").textContent }));
  console.log("?floor:", JSON.stringify(s3b));
  if (s3b.mode !== "floor" || s3b.T !== 250 || !/Custom floor/.test(s3b.line)) fail("?floor should open the kept floor");
  await page.click("#btnReset"); await page.waitForTimeout(600);
  await page.click("#modePanel"); await page.waitForTimeout(400); await page.click("#btnPanelReset"); await page.waitForTimeout(400);
  await page.click("#modeFloor"); await page.waitForTimeout(600);
  // a kept floor with an error: the scene shows the example and the error is listed against the kept inputs
  await page.fill("#inThk", "20"); await page.waitForTimeout(800);
  await page.reload(); await page.waitForFunction(() => window.xstruc && window.xstruc.model());
  const s3c = await stats();
  console.log("kept with an error:", JSON.stringify({ bars: s3c.bars, errs: s3c.errs }));
  if (s3c.bars !== FLOOR || !s3c.errs.length || errors.some(e => /pageerror/.test(e))) fail("a kept input with an error should show the example scene and list the error");
  await page.click("#btnReset"); await page.waitForTimeout(600);

  if (SHOTS) {
    await page.evaluate(() => { document.querySelector(".side").scrollTop = 0; document.querySelector(".inspect").scrollTop = 0; }); await page.waitForTimeout(800);
    const sharp = require("sharp");
    const shotsDir = path.join(__dirname, "..", "app", "screenshots");
    fs.mkdirSync(shotsDir, { recursive: true });
    await sharp(await page.screenshot()).webp({ quality: 78 }).toFile(path.join(shotsDir, "wide.webp"));
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    for (const u of Object.keys(CDN)) await phone.route(u, r => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(CDN[u]) }));
    await phone.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const pp = await phone.newPage(); await pp.goto(base + "?panel"); await pp.waitForFunction(() => window.xstruc && window.xstruc.model()); await pp.waitForTimeout(1500);
    await sharp(await pp.screenshot()).webp({ quality: 78 }).toFile(path.join(shotsDir, "narrow.webp"));
    await phone.close();
    console.log("screenshots written to app/screenshots (rebuild the app to include them)");
  }

  // 4. offline: server stopped, CDN routes gone, network off; the app must still open and build the floor
  await stop(srv); await ctx.unrouteAll({ behavior: "ignoreErrors" }); await ctx.setOffline(true);
  const before = errors.length;
  await page.reload(); await page.waitForFunction(() => window.xstruc && window.xstruc.model(), null, { timeout: 15000 }).catch(() => fail("the app did not open offline"));
  await page.waitForTimeout(500);
  // Chromium's offline emulation does not carry navigator.onLine across a reload; flip it so the page hears "offline"
  await ctx.setOffline(false); await ctx.setOffline(true); await page.waitForTimeout(200);
  const s4 = await stats();
  console.log("offline:", JSON.stringify(s4));
  if (s4.bars !== FLOOR || !s4.offline) fail("offline the app should build the floor (" + FLOOR + " bars) and show the Offline chip");
  await page.click("#modePanel"); await page.waitForTimeout(600);
  const s4p = await stats();
  if (s4p.bars !== PANEL) fail("offline the panel should build too (" + PANEL + " bars), got " + s4p.bars);
  await page.click("#modeFloor"); await page.waitForTimeout(400);
  if (errors.length > before) fail("console errors offline: " + errors.slice(before).join(" | "));
  await page.screenshot({ path: path.join(outDir, "smoke-app-offline.png") });

  // 5. a new deploy: same files, new version; back online the bar offers it and Reload brings it in
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "xstruc-siteB-"));
  const B = build(dirB, { html: fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8") + "\n<!-- next deploy -->\n" });
  srv = await serve(dirB, port); await routeCdn(); await ctx.setOffline(false);
  await page.evaluate(() => window.xstruc.app.registration.update());
  await page.waitForFunction(() => !document.querySelector("#appUpdate").hidden, null, { timeout: 20000 }).catch(() => fail("the new-version bar did not appear"));
  const s5a = await stats();
  console.log("update offered:", JSON.stringify({ version: s5a.version, update: s5a.update }));
  await page.screenshot({ path: path.join(outDir, "smoke-app-update.png") });
  await Promise.all([page.waitForEvent("load", { timeout: 20000 }), page.click("#btnAppReload")]).catch(() => fail("Reload did not reload the page"));
  await page.waitForFunction(() => window.xstruc && window.xstruc.model());
  const s5 = await stats();
  console.log("after Reload:", JSON.stringify({ version: s5.version, bars: s5.bars, update: s5.update }));
  if (s5.version !== B.version || s5.bars !== FLOOR || s5.update) fail("after Reload the page should be version " + B.version);
  const left = await page.evaluate(() => caches.keys());
  if (left.some(k => k === "xstruc-" + A.version)) fail("the old version's files were not cleared: " + left.join(", "));

  if (errors.length) fail("console errors: " + errors.join(" | "));
  await browser.close(); await stop(srv);
  [dirA, dirB].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  console.log("smoke-app: OK (installable, inputs kept, offline floor + panel, update " + A.version + " → " + B.version + ")");
})().catch(e => fail(e.stack));
