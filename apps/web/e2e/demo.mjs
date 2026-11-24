// Browser test of the web app's 3D demo (backlog #40): builds nothing itself; run `pnpm --filter @xstruc/web build`
// first, then `node e2e/demo.mjs [outDir]`. Starts `next start`, opens /demo in headless Chromium (software WebGL),
// and checks the floor draws, the fixing steps move, a click on a bar opens its card, the panel draws, no errors.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const out = process.argv[2] || "e2e-out";
mkdirSync(out, { recursive: true });
const port = 3200 + Math.floor(Math.random() * 300);
const server = spawn("npx", ["next", "start", "-p", String(port)], { cwd: new URL("..", import.meta.url).pathname, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
const fail = async msg => { console.error("e2e demo: FAIL\n  " + msg); server.kill(); process.exit(1); };
for (let i = 0; ; i++) { try { if ((await fetch("http://127.0.0.1:" + port + "/demo")).ok) break; } catch {} if (i > 60) await fail("next start did not come up"); await new Promise(r => setTimeout(r, 500)); }

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(e.message));
await page.goto("http://127.0.0.1:" + port + "/demo");
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data(), null, { timeout: 20000 }).catch(() => fail("the viewer did not load the model"));
await page.waitForTimeout(800);
// painted pixels: the canvas is not just the background colour
const painted = () => page.evaluate(() => {
  const c = document.querySelector("[data-testid=viewer] canvas"), g = document.createElement("canvas");
  g.width = c.width; g.height = c.height; const x = g.getContext("2d"); x.drawImage(c, 0, 0);
  const d = x.getImageData(0, 0, g.width, g.height).data; let n = 0;
  for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i] - 0x11) + Math.abs(d[i + 1] - 0x15) + Math.abs(d[i + 2] - 0x1a) > 40) n++;
  return n / (d.length / 16);
});
const floorInk = await painted();
const info = await page.evaluate(() => { const d = window.xstrucViewer.data(); return { kind: d.kind, order: d.order, bars: d.bars.length, stats: document.querySelector("[data-testid=demo-stats]").textContent }; });
console.log("floor:", JSON.stringify({ ...info, ink: +floorInk.toFixed(3) }));
if (info.kind !== "floor" || info.order.length < 6 || floorInk < 0.03) await fail("the floor should draw its layers (ink " + floorInk + ")");
await page.screenshot({ path: out + "/demo-floor.png" });

// fixing steps
await page.click("[aria-label='Next step']"); await page.click("[aria-label='Next step']");
const step2 = await page.textContent("[data-testid=step-label]");
if (!/^Step 2 of \d+ · Layer A/.test(step2)) await fail("Next twice should show step 2, layer A: " + step2);
await page.waitForTimeout(300);
const marks = await page.evaluate(() => ({ grids: document.querySelectorAll(".xs-grid").length, tags: [...document.querySelectorAll(".xs-tag")].map(t => t.textContent) }));
console.log("step 2 labels:", JSON.stringify({ grids: marks.grids, tags: marks.tags.slice(0, 4), n: marks.tags.length }));
if (marks.grids !== 14 || !marks.tags.some(t => /N16-200/.test(t))) await fail("step 2 should show 14 grid bubbles and layer A's tags");
await page.screenshot({ path: out + "/demo-floor-step2.png" });
await page.click("text=All");

// click a top bar: its card opens
const pt = await page.evaluate(() => { const v = window.xstrucViewer, d = v.data(); const b = d.bars.find(b => b.layer === "D" && !b.existing && b.len > 4000); return v.screenOf(b); });
await page.mouse.click(pt.x, pt.y);
await page.waitForSelector("[data-testid=bar-card]", { timeout: 5000 }).catch(() => fail("clicking a bar should open its card"));
const card = await page.textContent("[data-testid=bar-card]");
console.log("card:", card.slice(0, 120));
if (!/Cut length/.test(card)) await fail("the bar card should show the cut length");
await page.screenshot({ path: out + "/demo-floor-bar.png" });

// plan view and the panel
await page.click("text=Plan"); await page.waitForTimeout(300);
await page.click("text=Precast panel");
await page.waitForFunction(() => window.xstrucViewer.data().kind === "panel");
await page.waitForTimeout(500);
const panel = await page.evaluate(() => ({ order: window.xstrucViewer.data().order, stats: document.querySelector("[data-testid=demo-stats]").textContent, label: document.querySelector("[data-testid=step-label]").textContent }));
const panelInk = await painted();
console.log("panel:", JSON.stringify({ ...panel, ink: +panelInk.toFixed(3) }));
if (!/^85 bars/.test(panel.stats) || panel.order[0] !== "FF1" || !/Finished panel/.test(panel.label) || panelInk < 0.02) await fail("the panel should draw (85 bars, FF1 first)");
await page.screenshot({ path: out + "/demo-panel.png" });

// the mud trap: base and ramp, walls, internal wall, in its fixing order; step to the wall verticals
await page.click("text=Mud trap");
await page.waitForFunction(() => window.xstrucViewer.data().kind === "pit");
await page.waitForTimeout(500);
const pitData = await page.evaluate(() => ({ order: window.xstrucViewer.data().order, concrete: window.xstrucViewer.data().concrete.length, stats: document.querySelector("[data-testid=demo-stats]").textContent, label: document.querySelector("[data-testid=step-label]").textContent }));
const pitInk = await painted();
console.log("pit:", JSON.stringify({ ...pitData, ink: +pitInk.toFixed(3) }));
if (!/^716 bars/.test(pitData.stats) || pitData.order.join(",") !== "K,A,B,W,C,D,H,I,U" || pitData.concrete !== 8 || !/Finished pit/.test(pitData.label) || pitInk < 0.02) await fail("the mud trap should draw (716 bars, 9 steps, 8 concrete pieces)");
await page.screenshot({ path: out + "/demo-pit.png" });
for (let i = 0; i < 4; i++) await page.click("[aria-label='Next step']");
await page.waitForTimeout(300);
if (!/Wall verticals/.test(await page.textContent("[data-testid=step-label]"))) await fail("step 4 of the mud trap should be the wall verticals: " + await page.textContent("[data-testid=step-label]"));
await page.screenshot({ path: out + "/demo-pit-walls.png" });

if (errors.length) await fail("console errors: " + errors.join(" | "));
await browser.close(); server.kill();
console.log("e2e demo: OK (floor, panel and mud trap drawn, steps, bar card)");
