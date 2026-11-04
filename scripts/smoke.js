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
  await page.click("[data-cam=plan]"); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, "smoke-3-plan.png") });
  await page.click("[data-cam=iso]");

  // inputs: change spacing and thickness live
  await page.fill("#inCallouts", "N16-200 A E-W\nN12-200 B N-S\nN12-150 C N-S\nN12-150 D E-W\nSL82 T");
  await page.waitForTimeout(700);
  const s1 = await stats();
  console.log("after bad line:", JSON.stringify(s1.errs));
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

  await browser.close();
  const problems = [];
  if (errors.length) problems.push("console errors:\n  " + errors.join("\n  "));
  if (+s0.bars.replace(/\D/g, "") < 800) problems.push("default model has too few bars: " + s0.bars);
  if (s0.steps !== 8) problems.push("expected 8 steps, got " + s0.steps);
  if (!s1.errs.some(e => /mesh/.test(e))) problems.push("mesh line did not produce an error");
  if (s2.kg === s0.kg) problems.push("editing inputs did not rebuild the model");
  if (+s3.bars.replace(/\D/g, "") > 400) problems.push("plain slab has too many bars: " + s3.bars);
  if (s4.bars !== s0.bars) problems.push("reset did not restore the example (" + s4.bars + " vs " + s0.bars + ")");
  if (problems.length) { console.error("smoke: FAIL\n" + problems.join("\n")); process.exit(1); }
  console.log("smoke: OK (screenshots in " + outDir + ")");
})().catch(e => { console.error("smoke: FAIL\n" + e.stack); process.exit(1); });
