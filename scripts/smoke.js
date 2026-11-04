#!/usr/bin/env node
// Browser smoke test: loads index.html in headless Chromium with a LOCAL copy of three.js (the CDN is not
// reachable from the test container), asserts no console errors, exercises the inputs panel and the stepper,
// and writes screenshots. Usage: node scripts/smoke.js <dir containing node_modules/three> [outDir]
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const threeDir = path.resolve(process.argv[2] || ".");
  const outDir = path.resolve(process.argv[3] || threeDir);
  const src = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const local = src
    .replace("https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "file://" + path.join(threeDir, "node_modules/three/build/three.min.js"))
    .replace("https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js", "file://" + path.join(threeDir, "node_modules/three/examples/js/controls/OrbitControls.js"))
    .replace(/<link rel="stylesheet"[^>]*fonts\.googleapis[^>]*>/, "");
  const page_html = path.join(outDir, "smoke-page.html");
  fs.writeFileSync(page_html, "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head><body style=\"margin:0\">" + local + "</body></html>");

  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], logs = [];
  page.on("console", msg => { logs.push(msg.type() + ": " + msg.text()); if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", err => errors.push("pageerror: " + err.message));
  await page.goto("file://" + page_html);
  await page.waitForTimeout(1500);

  const stats = async () => ({ bars: await page.textContent("#stBars"), marks: await page.textContent("#stMarks"), kg: await page.textContent("#stMass"), steps: await page.$$eval("#steps .step", els => els.length), tags: await page.$$eval("#tags .tag:not([hidden])", els => els.length), errs: await page.$$eval("#inErrs li", els => els.map(e => e.textContent)) });
  const s0 = await stats();
  console.log("loaded:", JSON.stringify(s0));
  await page.screenshot({ path: path.join(outDir, "smoke-1-default.png") });

  // stepper
  await page.click("#next"); await page.click("#next"); await page.click("#next"); await page.waitForTimeout(300);
  console.log("step label:", await page.textContent("#steplabel"));
  await page.screenshot({ path: path.join(outDir, "smoke-2-step2.png") });
  await page.click("#all");

  // plan view
  await page.click(".side [data-cam=plan]"); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "smoke-3-plan.png") });
  await page.click(".side [data-cam=iso]");

  // inputs: change spacing and thickness live
  await page.fill("#inCallouts", "N16-200 A E-W\nN12-200 B N-S\nN12-150 C N-S\nN12-150 D E-W\nSL82 T");
  await page.waitForTimeout(700);
  const s1 = await stats();
  console.log("after bad line:", JSON.stringify(s1.errs));
  // a mat without E-W / N-S is an error in the panel, not a guessed direction (#21); the scene keeps the last good model
  await page.fill("#inCallouts", "N16-200 A\nN12-200 B N-S\nN12-150 C N-S\nN12-150 D E-W");
  await page.waitForTimeout(700);
  const sDir = await stats();
  sDir.invalid = await page.getAttribute("#inCallouts", "aria-invalid");
  sDir.open = await page.$eval("#inputs", el => el.open);
  console.log("after undirected mat:", JSON.stringify(sDir.errs), "aria-invalid", sDir.invalid);
  await page.screenshot({ path: path.join(outDir, "smoke-8-direction-error.png") });
  await page.fill("#inCallouts", "N20-200 A E-W\nN16-200 B N-S\nN16-150 C N-S\nN16-150 D E-W");
  await page.fill("#inThk", "250");
  await page.waitForTimeout(800);
  const s2 = await stats();
  console.log("after edit:", JSON.stringify(s2));
  await page.screenshot({ path: path.join(outDir, "smoke-4-edited.png") });

  // plain slab preset, then reset
  await page.click("#btnPlain"); await page.waitForTimeout(600);
  const s3 = await stats();
  console.log("plain:", JSON.stringify(s3));
  await page.screenshot({ path: path.join(outDir, "smoke-5-plain.png") });
  await page.click("#btnReset"); await page.waitForTimeout(800);
  const s4 = await stats();
  console.log("reset:", JSON.stringify(s4));

  // click a schedule row
  await page.click("#sched tr:nth-child(5)"); await page.waitForTimeout(200);
  console.log("inspector:", (await page.textContent("#inspector")).slice(0, 80).replace(/\s+/g, " "));

  // desktop inspector: a lapped mat bar shows its bar line, both ends and lap zone from the nearest grids (#20)
  const insp = await page.evaluate(() => {
    const M = window.xstruc.model(), b = M.bars.find(x => x.layer === "D" && x.run.kind === "main" && x.lapPrev && x.line % 2 === 0);
    window.xstruc.selectBar(b.id);
    const t = document.getElementById("inspector").textContent.replace(/\s+/g, " ");
    const r = M.runs.find(x => x.kind === "main" && x.layer === "C"); window.xstruc.selectRun(r.id);
    return { bar: t, run: document.getElementById("inspector").textContent.replace(/\s+/g, " ") };
  });
  console.log("inspector bar:", insp.bar.slice(0, 300));
  await page.screenshot({ path: path.join(outDir, "smoke-7-inspector.png") });

  // 2D placing sheet (#9a): the stage swaps to a canvas, the stepper picks the layer, a click on a drawn bar selects it
  await page.click("#all"); await page.click("#tgSheet"); await page.waitForTimeout(400);
  const sh = await page.evaluate(() => {
    const vis = el => !!el && el.offsetParent !== null, S = window.xstruc.sheet();
    return { on: window.xstruc.state.sheet, canvas: vis(document.getElementById("sheet")), view: vis(document.getElementById("view")), pressed: document.getElementById("tgSheet").getAttribute("aria-pressed"), solid: S.solid.join(""), bars: S.bars.length, dims: S.dims.length, title: S.title[0], cw: document.getElementById("sheet").clientWidth };
  });
  console.log("sheet all:", JSON.stringify(sh));
  await page.screenshot({ path: path.join(outDir, "smoke-9-sheet-all.png") });
  await page.click("#steps .step[data-step='2']"); await page.waitForTimeout(300);   // layer A
  const shA = await page.evaluate(() => {
    const S = window.xstruc.sheet(), M = window.xstruc.model();
    const it = S.bars.find(x => !x.ghost && x.bar.run.kind === "main" && x.bar.line === 3 && !x.bar.lapPrev);   // a layer-A mat bar, third line
    const p = it.pts, mid = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], xy = window.xstruc.sheetXY(mid[0], mid[1]);
    const r = document.getElementById("sheet").getBoundingClientRect();
    return { solid: S.solid.join(""), ghost: S.ghost.join(""), ink: S.bars.filter(x => !x.ghost).length, dims: S.dims.length, cogs: S.bars.reduce((s, x) => s + x.cogs.length, 0), id: it.bar.id, mark: it.bar.mark, cx: r.left + xy[0], cy: r.top + xy[1], title: S.title[0] };
  });
  await page.mouse.click(shA.cx, shA.cy); await page.waitForTimeout(200);
  shA.sel = await page.evaluate(() => window.xstruc.state.sel && window.xstruc.state.sel.id);
  shA.insp = (await page.textContent("#inspector")).replace(/\s+/g, " ").slice(0, 120);
  console.log("sheet A:", JSON.stringify(shA));
  await page.screenshot({ path: path.join(outDir, "smoke-9-sheet-A.png") });
  await page.click("#steps .step[data-step='6']"); await page.waitForTimeout(300);   // layer D: cogged top bars
  const shD = await page.evaluate(() => { const S = window.xstruc.sheet(); return { solid: S.solid.join(""), cogs: S.bars.filter(x => !x.ghost).reduce((s, x) => s + x.cogs.length, 0), selKept: window.xstruc.state.sel && window.xstruc.state.sel.id }; });
  console.log("sheet D:", JSON.stringify(shD));
  await page.screenshot({ path: path.join(outDir, "smoke-9-sheet-D.png") });
  await page.click(".side [data-cam=iso]"); await page.waitForTimeout(300);
  const shOff = await page.evaluate(() => ({ on: window.xstruc.state.sheet, view: document.getElementById("view").offsetParent !== null, canvas: document.getElementById("sheet").offsetParent !== null, sel: window.xstruc.state.sel && window.xstruc.state.sel.id }));
  console.log("sheet off:", JSON.stringify(shOff));
  await page.click("#all");

  // site mode (tablet fixing view) at 1024 × 768 landscape and portrait
  const siteRuns = [];
  for (const vp of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(vp); await page.click("#all"); await page.waitForTimeout(300);
    await page.click("#btnSite"); await page.waitForTimeout(600);
    const r = { vp: vp.width + "x" + vp.height };
    Object.assign(r, await page.evaluate(() => {
      const vis = el => !!el && el.offsetParent !== null;
      const btns = [...document.querySelectorAll("#sitebar button, #sitectl button")].filter(vis);
      return {
        on: document.documentElement.classList.contains("site"),
        sideHidden: !vis(document.querySelector(".side")), inspectHidden: !vis(document.querySelector(".inspect")),
        barVisible: vis(document.getElementById("sitebar")), chips: document.querySelectorAll("#siteChips .chip-step").length,
        now: document.getElementById("siteNow").textContent.replace(/\s+/g, " ").trim(),
        tagPx: Math.min(...[...document.querySelectorAll("#tags .tag:not([hidden])")].map(t => parseFloat(getComputedStyle(t).fontSize)).concat([99])),
        minBtn: Math.min(...btns.map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))),
        stageH: document.querySelector(".stage").clientHeight, stageW: document.querySelector(".stage").clientWidth,
        overflow: document.documentElement.scrollHeight > window.innerHeight + 2 || document.documentElement.scrollWidth > window.innerWidth + 2
      };
    }));
    await page.click("#siteNext"); await page.waitForTimeout(300);
    Object.assign(r, await page.evaluate(() => {
      const M = window.xstruc.model(), st = window.xstruc.state;
      const b = M.bars.find(x => x.layer === "A" && !x.existing && x.lapNext);
      window.xstruc.selectBar(b.id);
      const c = document.getElementById("sitecard");
      return { step: st.step, all: st.all, cardShown: c.classList.contains("sel") && c.offsetParent !== null, card: c.textContent.replace(/\s+/g, " ").trim().slice(0, 220), cardW: c.getBoundingClientRect().width, cardBottom: Math.round(c.getBoundingClientRect().bottom), stageBottom: Math.round(document.querySelector(".stage").getBoundingClientRect().bottom) };
    }));
    await page.screenshot({ path: path.join(outDir, "smoke-6-site-" + vp.width + ".png") });
    await page.click("#sitecard [data-close]"); await page.waitForTimeout(100);
    r.cardClosed = await page.$eval("#sitecard", c => !c.classList.contains("sel"));
    r.panel = await page.$eval("#sitecard", c => c.textContent.replace(/\s+/g, " ").trim().slice(0, 100));
    // tap a run tag
    r.runCard = await page.evaluate(() => { const t = document.querySelector("#tags .tag.cur:not([hidden])") || document.querySelector("#tags .tag:not(.bar):not([hidden])"); if (!t) return "no tag"; t.click(); return document.getElementById("sitecard").textContent.replace(/\s+/g, " ").trim().slice(0, 120); });
    await page.click("#btnSiteExit"); await page.waitForTimeout(300);
    r.off = await page.evaluate(() => !document.documentElement.classList.contains("site") && document.querySelector(".side").offsetParent !== null);
    console.log("site:", JSON.stringify(r));
    siteRuns.push(r);
  }

  await browser.close();
  const problems = [];
  siteRuns.forEach(r => {
    const p = m => problems.push("site " + r.vp + ": " + m);
    if (!r.on || !r.sideHidden || !r.inspectHidden || !r.barVisible) p("site mode did not strip the UI (" + JSON.stringify({ on: r.on, side: r.sideHidden, insp: r.inspectHidden, bar: r.barVisible }) + ")");
    if (r.chips !== 9) p("expected 9 step chips, got " + r.chips);
    if (r.tagPx < 18) p("tag font " + r.tagPx + "px < 18");
    if (r.minBtn < 44) p("smallest touch target " + r.minBtn + "px < 44");
    if (r.overflow) p("page scrolls at this size");
    if (r.stageH < 380) p("stage only " + r.stageH + "px tall");
    if (r.step !== 2 || r.all) p("Next from beam cages should land on layer A (step 2), got " + r.step + "/" + r.all);
    if (!r.cardShown || !/Cut length/.test(r.card) || !/grid/.test(r.card) || !/lap/i.test(r.card)) p("bar card missing cut length / grid setout / laps: " + r.card);
    if (r.cardBottom > r.stageBottom) p("bar card overflows the stage");
    if (!r.cardClosed) p("bar card did not close");
    if (!/Place now/.test(r.panel)) p("side panel did not return to the run list: " + r.panel);
    if (!/Callout|Bar lines/.test(r.runCard)) p("run card not shown: " + r.runCard);
    if (!r.off) p("exit did not restore the full UI");
  });
  if (!/Bar line ?(?:[\d,]+ [NS] of|on) grid [A-Z] · bar line \d+ of \d+ @ \d+/.test(insp.bar) || !/Runs ?W end [\d,]+ [EW] of grid \d/.test(insp.bar) || !/lap zone [\d,]+ [EW] of grid (\d) to [\d,]+ [EW] of grid \1/.test(insp.bar)) problems.push("desktop inspector lacks grid setout / lap zone: " + insp.bar.slice(0, 300));
  if (!/First line ?[\d,]+ [EW] of grid \d \(/.test(insp.run) || !/Last line/.test(insp.run)) problems.push("run inspector lacks first/last line from grids: " + insp.run.slice(0, 200));
  siteRuns.forEach(r => { if (!/lap zone [\d,]+ [EW] of grid \d to/.test(r.card)) problems.push("site " + r.vp + ": bar card lap zone is not from a grid: " + r.card); });
  // 2D placing sheet
  if (!sh.on || !sh.canvas || sh.view || sh.pressed !== "true" || sh.cw < 300) problems.push("sheet did not replace the 3D stage: " + JSON.stringify(sh));
  if (sh.solid !== "BMABCHCDST" || sh.bars < 1000 || sh.dims !== 0 || !/ALL LAYERS/.test(sh.title)) problems.push("finished-floor sheet wrong: " + JSON.stringify(sh));
  if (shA.solid !== "A" || shA.ghost !== "BM" || shA.ink < 100 || shA.dims < 2 || !/LAYER A/.test(shA.title)) problems.push("layer A sheet wrong: " + JSON.stringify(shA));
  if (shA.sel !== shA.id || !shA.insp.includes(shA.mark)) problems.push("clicking a bar on the sheet did not select it (" + shA.sel + " vs " + shA.id + "): " + shA.insp);
  if (shD.solid !== "D" || shD.cogs < 10) problems.push("layer D sheet should show cog ticks: " + JSON.stringify(shD));
  if (shD.selKept !== shA.id) problems.push("stepping to layer D should keep the selection (not visible, but kept by 3D rules): got " + shD.selKept);
  if (shOff.on || !shOff.view || shOff.canvas || shOff.sel !== shA.id) problems.push("3D button did not restore the stage with the selection kept: " + JSON.stringify(shOff));
  if (errors.length) problems.push("console errors:\n  " + errors.join("\n  "));
  if (+s0.bars.replace(/\D/g, "") < 800) problems.push("default model has too few bars: " + s0.bars);
  if (s0.steps !== 8) problems.push("expected 8 steps, got " + s0.steps);
  if (!s1.errs.some(e => /mesh/.test(e))) problems.push("mesh line did not produce an error");
  if (!/^Line 1 \(N16-200 A\): say which way this mat runs: E-W or N-S/.test(sDir.errs[0] || "") || sDir.errs.some(e => /No mat for layer A/.test(e))) problems.push("undirected mat did not produce the direction error (alone, without a 'no mat' warning): " + JSON.stringify(sDir.errs));
  if (sDir.invalid !== "true" || !sDir.open) problems.push("direction error did not mark the callouts field invalid / open the inputs panel");
  if (sDir.bars !== s0.bars) problems.push("undirected mat rebuilt the scene (" + sDir.bars + " vs " + s0.bars + "); it should keep the last good model");
  if (s2.kg === s0.kg) problems.push("editing inputs did not rebuild the model");
  if (+s3.bars.replace(/\D/g, "") > 400) problems.push("plain slab has too many bars: " + s3.bars);
  if (s4.bars !== s0.bars) problems.push("reset did not restore the example (" + s4.bars + " vs " + s0.bars + ")");
  if (problems.length) { console.error("smoke: FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("smoke: OK (screenshots in " + outDir + ")");
})().catch(e => { console.error("smoke: FAIL\n" + e.stack); process.exit(1); });
