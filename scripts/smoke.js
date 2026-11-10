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

  // geometry editing (#7a): the example's openings and balcony are rows in the panel; edit, add, break and remove rows
  const g0 = await page.evaluate(() => ({ rows: document.querySelectorAll("#openRows .orow").length, names: [...document.querySelectorAll("#openRows .orow input[data-k=name]")].map(e => e.value),
    x0: document.querySelector("#openRows .orow:nth-child(2) input[data-k=x0]").value, bProj: document.getElementById("inBproj").value, bDown: document.getElementById("inBdown").value, holes: window.xstruc.model().HOLES.length }));
  console.log("geometry rows:", JSON.stringify(g0));
  await page.fill("#openRows .orow:nth-child(2) input[data-k=x1]", "4200");   // the 600 riser becomes a 1,200 × 600 duct
  await page.fill("#openRows .orow:nth-child(2) input[data-k=name]", "duct");
  await page.waitForTimeout(700);
  const g1 = await stats();
  g1.hole = await page.evaluate(() => { const h = window.xstruc.model().HOLES[1]; return h && [h.id, h.x1 - h.x0, h.label]; });
  console.log("after widening the riser:", JSON.stringify(g1.hole), g1.bars);
  await page.click("#btnAddOpen"); await page.waitForTimeout(700);
  const g2 = await stats();
  g2.rows = await page.$$eval("#openRows .orow", els => els.length); g2.holes = await page.evaluate(() => window.xstruc.model().HOLES.map(h => h.id));
  console.log("after add:", JSON.stringify(g2.holes), JSON.stringify(g2.errs));
  await page.fill("#openRows .orow:nth-child(3) input[data-k=x0]", "-100");   // outside the slab: an error on that row, scene kept
  await page.waitForTimeout(700);
  const g3 = await stats();
  g3.invalid = await page.getAttribute("#openRows .orow:nth-child(3)", "data-invalid"); g3.open = await page.$eval("#inputs", el => el.open);
  console.log("after a bad row:", JSON.stringify(g3.errs), "invalid", g3.invalid);
  await page.screenshot({ path: path.join(outDir, "smoke-14-geometry-rows.png") });
  await page.click("#openRows .orow:nth-child(3) .del"); await page.waitForTimeout(700);
  const g4 = await stats(); g4.rows = await page.$$eval("#openRows .orow", els => els.length);
  await page.fill("#inBproj", "2400"); await page.fill("#inBdown", "0"); await page.waitForTimeout(700);
  const g5 = await stats();
  g5.balc = await page.evaluate(() => { const M = window.xstruc.model(), r = M.runs.find(x => x.label.indexOf("CANTILEVER") >= 0); return [M.BALC.proj, M.BALC.down, r.bars[0].shape, r.bars.length]; });
  console.log("after balcony edit:", JSON.stringify(g5.balc), g5.bars);
  await page.fill("#inBx1", "5000"); await page.waitForTimeout(700);   // 4,200 to 5,000 = 800 wide: an error, scene kept
  const g6 = await stats(); g6.invalid = await page.getAttribute("#inBx1", "aria-invalid");
  console.log("after a bad balcony:", JSON.stringify(g6.errs));
  await page.click("#btnReset"); await page.waitForTimeout(800);
  const g7 = await stats(); g7.rows = await page.$$eval("#openRows .orow", els => els.length); g7.bDown = await page.inputValue("#inBdown");

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
  // #9b: click the main mat's tag → the run is selected and its bar marks show; zoom in to read the paper text
  const tgA = await page.evaluate(() => {
    const S = window.xstruc.sheet(), t = S.tags.find(x => x.dist && x.text.indexOf("N16-200") >= 0), xy = window.xstruc.sheetXY(t.x, t.y), r = document.getElementById("sheet").getBoundingClientRect();
    return { tags: S.tags.length, run: t.run, text: t.text, cx: r.left + xy[0], cy: r.top + xy[1], laps: S.laps.length, dl: S.distLines.length, strip: S.strip.callouts.length };
  });
  await page.mouse.click(tgA.cx, tgA.cy); await page.waitForTimeout(200);
  Object.assign(tgA, await page.evaluate(() => { const st = window.xstruc.state; return { selRun: st.selRun && st.selRun.id, marks: (window.xstruc.sheet().runMarks[st.selRun ? st.selRun.id : ""] || []).length }; }));
  tgA.insp = (await page.textContent("#inspector")).replace(/\s+/g, " ").slice(0, 120);
  console.log("sheet A tags:", JSON.stringify(tgA));
  await page.screenshot({ path: path.join(outDir, "smoke-10-sheet-tags-A.png") });
  await page.mouse.move(tgA.cx, tgA.cy);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(60); }
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(outDir, "smoke-10-sheet-zoom-A.png") });
  await page.mouse.click(tgA.cx, tgA.cy, { clickCount: 2 }); await page.waitForTimeout(200);   // double-click: back to fit
  await page.evaluate(id => window.xstruc.selectBar(id), shA.id);   // the 3D-return checks below follow the clicked bar
  await page.click("#steps .step[data-step='6']"); await page.waitForTimeout(300);   // layer D: cogged top bars
  const shD = await page.evaluate(() => { const S = window.xstruc.sheet(); return { solid: S.solid.join(""), cogs: S.bars.filter(x => !x.ghost).reduce((s, x) => s + x.cogs.length, 0), selKept: window.xstruc.state.sel && window.xstruc.state.sel.id, tags: S.tags.length, laps: S.laps.length, overlap: S.tags.filter(t => t.overlap).length }; });
  console.log("sheet D:", JSON.stringify(shD));
  await page.screenshot({ path: path.join(outDir, "smoke-9-sheet-D.png") });
  // #9c: a schedule row highlights its mark on the sheet: the sheet steps to the mark's layer and labels every bar of it
  const mkHi = await page.evaluate(() => {
    const M = window.xstruc.model(), mk = M.marks.find(m => m.layer === "C" && m.qty >= 4), st = window.xstruc.state;
    document.querySelector("#sched tr[data-mark='" + mk.mark + "']").click();
    const S = window.xstruc.sheet(), labels = S.runMarks ? Object.values(S.runMarks).flat().filter(l => l.mark === mk.mark) : [];
    return { mark: mk.mark, qty: mk.qty, layer: mk.layer, step: st.step, all: st.all, sheetLayer: S.layer, mark_state: st.mark, labels: labels.length, drawn: window.xstruc.drawnMarks(), insp: document.getElementById("inspector").textContent.replace(/\s+/g, " ").slice(0, 400) };
  });
  console.log("sheet mark highlight:", JSON.stringify(mkHi));
  await page.screenshot({ path: path.join(outDir, "smoke-11-sheet-mark.png") });
  await page.click("#sched tr[data-mark='" + mkHi.mark + "']"); await page.waitForTimeout(100);   // clear the highlight
  await page.evaluate(id => window.xstruc.selectBar(id), shA.id);   // the 3D-return checks below follow the clicked bar
  await page.click("#steps .step[data-step='6']"); await page.waitForTimeout(300);
  await page.click(".side [data-cam=iso]"); await page.waitForTimeout(300);
  const shOff = await page.evaluate(() => ({ on: window.xstruc.state.sheet, view: document.getElementById("view").offsetParent !== null, canvas: document.getElementById("sheet").offsetParent !== null, sel: window.xstruc.state.sel && window.xstruc.state.sel.id }));
  console.log("sheet off:", JSON.stringify(shOff));
  await page.click("#all");

  // #9c: print layout — the sheet alone at a standard scale on A3 landscape; printPrep is what beforeprint calls
  await page.click("#steps .step[data-step='2']"); await page.waitForTimeout(200);   // layer A, 3D view
  const pr = await page.evaluate(() => {
    const wasSheet = window.xstruc.state.sheet;
    window.xstruc.printPrep(true);
    const st = document.querySelector(".stage"), S = window.xstruc.sheet(), p = window.xstruc.printing(), s = window.xstruc.sheetScale(), pxmm = 96 / 25.4;
    const vis = el => !!el && el.offsetParent !== null;
    return { wasSheet: wasSheet, on: window.xstruc.state.sheet, cls: document.documentElement.classList.contains("print"), stageW: st.clientWidth, stageH: st.clientHeight, den: p && p.den, fits: p && p.fits, paper: p && p.paper,
      scaleOK: Math.abs(s - pxmm / p.den) < 1e-9, drawnW: (S.bounds.x1 - S.bounds.x0) * s, drawnH: (S.bounds.y1 - S.bounds.y0) * s, layer: S.layer,
      hidden: [".top", ".side", ".inspect", "#hud", ".legend"].map(q => !vis(document.querySelector(q))).every(Boolean), canvasPx: document.getElementById("sheet").width };
  });
  console.log("print layout:", JSON.stringify(pr));
  await page.locator(".stage").screenshot({ path: path.join(outDir, "smoke-12-print-A3.png") });
  // Chromium's PDF capture also fires beforeprint / afterprint: the printed page is the real test of the layout
  await page.evaluate(() => window.xstruc.printPrep(false));
  const pdfPath = path.join(outDir, "smoke-12-print-A3.pdf");
  await page.pdf({ path: pdfPath, format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  const prOff = await page.evaluate(() => ({ on: window.xstruc.state.sheet, cls: document.documentElement.classList.contains("print"), printing: !!window.xstruc.printing(), stageW: document.querySelector(".stage").clientWidth, view: document.getElementById("view").offsetParent !== null }));
  console.log("print off:", JSON.stringify(prOff), "pdf bytes:", fs.statSync(pdfPath).size);
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
    // #9c: the Sheet chip shows this layer's placing sheet; a tap on a bar opens its card; two fingers pinch-zoom
    await page.click("#sitecard [data-close]"); await page.waitForTimeout(100);
    await page.click("#btnSiteSheet"); await page.waitForTimeout(400);
    const sh = await page.evaluate(() => {
      const S = window.xstruc.sheet(), cv = document.getElementById("sheet"), rect = cv.getBoundingClientRect(), btn = document.getElementById("btnSiteSheet").getBoundingClientRect();
      const it = S.bars.find(x => !x.ghost && x.bar.run.kind === "main" && x.bar.line === 3 && !x.bar.lapPrev), p = it.pts, mid = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], xy = window.xstruc.sheetXY(mid[0], mid[1]);
      return { on: window.xstruc.state.sheet, canvas: cv.offsetParent !== null, view: document.getElementById("view").offsetParent !== null, solid: S.solid.join(""), ghost: S.ghost.join(""), tags: S.tags.length, pressed: document.getElementById("btnSiteSheet").getAttribute("aria-pressed"), btnPx: Math.min(btn.width, btn.height),
        cw: cv.clientWidth, ch: cv.clientHeight, id: it.bar.id, mark: it.bar.mark, cx: rect.left + xy[0], cy: rect.top + xy[1], s0: window.xstruc.sheetScale() };
    });
    await page.mouse.click(sh.cx + 9, sh.cy); await page.waitForTimeout(200);   // along the bar (at fit zoom the next bar line is only ~4 px away on a tablet; a fixer pinches in first)
    sh.sel = await page.evaluate(() => window.xstruc.state.sel && window.xstruc.state.sel.id);
    sh.card = await page.$eval("#sitecard", c => (c.classList.contains("sel") && c.offsetParent !== null ? "shown: " : "hidden: ") + c.textContent.replace(/\s+/g, " ").trim().slice(0, 120));
    await page.screenshot({ path: path.join(outDir, "smoke-13-site-sheet-" + vp.width + ".png") });
    // pinch: two synthetic touch pointers move apart to twice their distance about the stage centre
    sh.pinch = await page.evaluate(() => {
      const cv = document.getElementById("sheet"), r = cv.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, s0 = window.xstruc.sheetScale();
      const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, buttons: 1 }));
      ev("pointerdown", 1, cx - 60, cy); ev("pointerdown", 2, cx + 60, cy);
      for (let k = 1; k <= 6; k++) { ev("pointermove", 1, cx - 60 - 10 * k, cy); ev("pointermove", 2, cx + 60 + 10 * k, cy); }
      ev("pointerup", 1, cx - 120, cy); ev("pointerup", 2, cx + 120, cy);
      return { ratio: window.xstruc.sheetScale() / s0, selKept: window.xstruc.state.sel && window.xstruc.state.sel.id };
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(outDir, "smoke-13-site-pinch-" + vp.width + ".png") });
    await page.click("#sitectl [data-cam=iso]"); await page.waitForTimeout(300);   // the 3D chip leaves the sheet
    sh.off = await page.evaluate(() => !window.xstruc.state.sheet && document.getElementById("view").offsetParent !== null && document.getElementById("btnSiteSheet").getAttribute("aria-pressed") === "false");
    r.sheet = sh;
    console.log("site sheet:", JSON.stringify(sh));
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
    const s = r.sheet;
    if (!s.on || !s.canvas || s.view || s.pressed !== "true" || s.solid !== "A" || s.ghost !== "BM" || s.tags < 5) p("Sheet chip did not show the layer A sheet: " + JSON.stringify(s));
    if (s.btnPx < 44) p("Sheet chip is " + s.btnPx + "px < 44");
    if (s.cw < 500 || s.ch < 300) p("site sheet canvas only " + s.cw + " × " + s.ch);
    if (s.sel !== s.id || !/^shown: /.test(s.card) || !/Cut length/.test(s.card)) p("tapping a bar on the site sheet did not open its card (" + s.sel + " vs " + s.id + "): " + s.card);
    if (!(s.pinch.ratio > 1.8 && s.pinch.ratio < 2.2) || s.pinch.selKept !== s.id) p("pinch did not zoom ×2 about the fingers (" + s.pinch.ratio + ") or lost the selection");
    if (!s.off) p("3D chip did not leave the sheet");
  });
  // #9c: schedule-mark highlight on the sheet and the print layout
  if (mkHi.all || mkHi.step !== 5 || mkHi.sheetLayer !== mkHi.layer || mkHi.mark_state !== mkHi.mark) problems.push("a schedule row should step the sheet to the mark's layer: " + JSON.stringify(mkHi));
  if (mkHi.labels < 1 || mkHi.drawn !== mkHi.labels || !mkHi.insp.includes("Bar mark " + mkHi.mark) || !/labelled on the sheet/.test(mkHi.insp)) problems.push("mark highlight did not draw the mark's labels on the sheet: " + JSON.stringify(mkHi));
  const pxmm = 96 / 25.4;
  if (pr.wasSheet || !pr.on || !pr.cls || !pr.hidden) problems.push("print prep did not switch to the sheet alone: " + JSON.stringify(pr));
  if (Math.abs(pr.stageW - 400 * pxmm) > 3 || Math.abs(pr.stageH - 277 * pxmm) > 3) problems.push("print stage is not A3 landscape less 10 mm margins (" + pr.stageW + " × " + pr.stageH + " px)");
  if (pr.paper !== "A3" || !pr.fits || ![10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000].includes(pr.den) || !pr.scaleOK) problems.push("print scale is not a standard scale that fits: " + JSON.stringify(pr));
  if (pr.drawnW > pr.stageW || pr.drawnH > pr.stageH - 50) problems.push("printed sheet overflows the page at 1:" + pr.den);
  if (pr.layer !== "A" || pr.canvasPx < 2 * pr.stageW) problems.push("print should draw the current layer at ≥ 2× resolution: " + JSON.stringify(pr));
  if (prOff.on || prOff.cls || prOff.printing || !prOff.view || prOff.stageW > 400 * pxmm - 100) problems.push("after printing the stage was not restored: " + JSON.stringify(prOff));
  if (fs.statSync(pdfPath).size < 20000) problems.push("printed PDF is suspiciously small");
  if (!/Bar line ?(?:[\d,]+ [NS] of|on) grid [A-Z] · bar line \d+ of \d+ @ \d+/.test(insp.bar) || !/Runs ?W end [\d,]+ [EW] of grid \d/.test(insp.bar) || !/lap zone [\d,]+ [EW] of grid (\d) to [\d,]+ [EW] of grid \1/.test(insp.bar)) problems.push("desktop inspector lacks grid setout / lap zone: " + insp.bar.slice(0, 300));
  if (!/First line ?[\d,]+ [EW] of grid \d \(/.test(insp.run) || !/Last line/.test(insp.run)) problems.push("run inspector lacks first/last line from grids: " + insp.run.slice(0, 200));
  siteRuns.forEach(r => { if (!/lap zone [\d,]+ [EW] of grid \d to/.test(r.card)) problems.push("site " + r.vp + ": bar card lap zone is not from a grid: " + r.card); });
  // 2D placing sheet
  if (!sh.on || !sh.canvas || sh.view || sh.pressed !== "true" || sh.cw < 300) problems.push("sheet did not replace the 3D stage: " + JSON.stringify(sh));
  if (sh.solid !== "BMABCHCDST" || sh.bars < 1000 || sh.dims !== 0 || !/ALL LAYERS/.test(sh.title)) problems.push("finished-floor sheet wrong: " + JSON.stringify(sh));
  if (shA.solid !== "A" || shA.ghost !== "BM" || shA.ink < 100 || shA.dims < 2 || !/LAYER A/.test(shA.title)) problems.push("layer A sheet wrong: " + JSON.stringify(shA));
  if (shA.sel !== shA.id || !shA.insp.includes(shA.mark)) problems.push("clicking a bar on the sheet did not select it (" + shA.sel + " vs " + shA.id + "): " + shA.insp);
  if (tgA.tags < 5 || tgA.dl < 1 || tgA.laps < 1 || tgA.strip < 3) problems.push("layer A sheet lacks tags / distribution lines / lap zones / callout strip: " + JSON.stringify(tgA));
  if (tgA.selRun !== tgA.run || tgA.marks < 5 || !tgA.insp.includes("N16-200")) problems.push("clicking the main mat tag did not select its run and show its marks: " + JSON.stringify(tgA));
  if (shD.tags < 5 || shD.laps < 1 || shD.overlap) problems.push("layer D sheet tags / lap zones wrong: " + JSON.stringify(shD));
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
  // geometry editing (#7a)
  if (g0.rows !== 2 || g0.names.join() !== "STAIR VOID,RISER" || g0.x0 !== "3000" || g0.bProj !== "1800" || g0.bDown !== "50" || g0.holes !== 2) problems.push("example geometry rows not pre-filled: " + JSON.stringify(g0));
  if (!g1.hole || g1.hole[0] !== "DUCT" || g1.hole[1] !== 1200 || g1.hole[2] !== "DUCT 1,200 × 600" || g1.bars === s4.bars || g1.errs.some(e => /^Opening/.test(e))) problems.push("editing the riser row did not rebuild as a 1,200 duct: " + JSON.stringify([g1.hole, g1.bars, g1.errs]));
  if (g2.rows !== 3 || g2.holes.join() !== "STAIR VOID,DUCT,OPENING 3" || g2.errs.some(e => /^Opening/.test(e))) problems.push("Add opening did not add a built row: " + JSON.stringify(g2));
  if (!g3.errs.some(e => /^Opening 3 \(OPENING 3\): must sit at least 300 inside/.test(e)) || g3.invalid !== "true" || !g3.open || g3.bars !== g2.bars) problems.push("a bad row should be an error on that row and keep the scene: " + JSON.stringify(g3));
  if (g4.rows !== 2 || g4.errs.some(e => /^Opening/.test(e)) || g4.bars !== g2.bars && g4.bars !== g1.bars) problems.push("removing the bad row did not rebuild cleanly: " + JSON.stringify(g4));
  if (!g5.balc || g5.balc[0] !== 2400 || g5.balc[1] !== 0 || g5.balc[2] !== "cog" || g5.bars === g4.bars) problems.push("balcony edit did not rebuild (2,400 projection, no set-down, straight cantilever bars): " + JSON.stringify(g5.balc));
  if (!g6.errs.some(e => /^Balcony: too narrow/.test(e)) || g6.invalid !== "true" || g6.bars !== g5.bars) problems.push("an 800 balcony should be an error that keeps the scene: " + JSON.stringify(g6));
  if (g7.rows !== 2 || g7.bDown !== "50" || g7.bars !== s0.bars) problems.push("reset did not restore the example rows: " + JSON.stringify(g7));
  if (problems.length) { console.error("smoke: FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("smoke: OK (screenshots in " + outDir + ")");
})().catch(e => { console.error("smoke: FAIL\n" + e.stack); process.exit(1); });
