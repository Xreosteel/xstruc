// Browser test of the no-sign-in app (projects kept on the device): run `pnpm --filter @xstruc/web build` first, then
// `node e2e/jobs.mjs [outDir]`. Starts `next start` (accounts off), creates a project and a floor, builds it, edits an
// input, reloads to check it was kept, checks the account screens send you home, and backs up / restores.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const out = process.argv[2] || "e2e-out";
mkdirSync(out, { recursive: true });
const port = 3500 + Math.floor(Math.random() * 300), base = "http://127.0.0.1:" + port;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
delete env.NEXT_PUBLIC_ACCOUNTS;
const server = spawn("npx", ["next", "start", "-p", String(port)], { cwd: new URL("..", import.meta.url).pathname, env, stdio: "ignore" });
const fail = async msg => { console.error("e2e jobs: FAIL\n  " + msg); server.kill(); process.exit(1); };
for (let i = 0; ; i++) { try { if ((await fetch(base + "/")).ok) break; } catch {} if (i > 60) await fail("next start did not come up"); await new Promise(r => setTimeout(r, 500)); }

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(e.message));

// straight in: no sign-in page
await page.goto(base + "/");
await page.waitForSelector("text=No projects on this device yet", { timeout: 15000 }).catch(() => fail("the home page should open on an empty project list, no sign-in"));
if (!/Saved on this device/.test(await page.textContent("header"))) await fail("the header should say jobs are saved on this device");
await page.fill("input[name=name]", "Lot 12 Salisbury");
await page.fill("input[name=job]", "J-1042");
await page.click("text=Create project");
await page.click("text=Lot 12 Salisbury");
await page.waitForURL(/\/job\/[^/]+$/);
const projectUrl = page.url();
await page.fill("input[name=name]", "Level 1 floor");
await page.click("button:has-text('Create')");
await page.waitForURL(/\/job\/[^/]+\/[^/]+$/);
const elUrl = page.url();
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data() && window.xstrucViewer.data().kind === "floor", null, { timeout: 20000 }).catch(() => fail("the new floor should build and draw on opening"));
const stats1 = await page.textContent("[data-testid=run-stats]");
console.log("built:", stats1.replace(/\s+/g, " ").slice(0, 80));
if (!/1,498/.test(stats1)) await fail("the example floor should have 1,498 bars: " + stats1);
await page.screenshot({ path: out + "/jobs-floor.png" });

// change the thickness, build, reload: kept
const t = await page.inputValue("[data-testid=inputs]");
await page.fill("[data-testid=inputs]", t.replace('"thickness": 200', '"thickness": 250'));
await page.click("button:has-text('Build')");
await page.waitForFunction(() => document.querySelector("[data-testid=saved]").textContent === "Saved on this device");
await page.waitForTimeout(700);
await page.reload();
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data(), null, { timeout: 20000 });
const kept = await page.inputValue("[data-testid=inputs]");
if (!/"thickness": 250/.test(kept)) await fail("the edited thickness should be kept through a reload");
await page.goto(base + "/");
await page.waitForSelector("text=Lot 12 Salisbury");
const list = await page.textContent("main");
if (!/J-1042/.test(list) || !/\d floor/.test(list)) await fail("the project list should show the project with its floor: " + list.slice(0, 200));

// a floor from a drawing: the sample plan is read step by step and built
await page.goto(projectUrl);
await page.click("text=Import a drawing");
await page.waitForURL(/\/import$/);
await page.click("text=Try the sample drawing");
await page.waitForSelector("[data-testid=reading]", { timeout: 15000 }).catch(() => fail("the sample drawing should be read"));
const reading = await page.textContent("[data-testid=reading]");
for (const want of ["2. Find the grid lines", "4 grid lines across (1, 2, 3, 4)", "BALCONY on the north edge", "Opening STAIR VOID", "Set-down WET AREA", "Slab thickness: 200 mm", "Layer A (B1): N16-200 E-W", "Layer D (T1): N12-150 E-W", "1,085 bars"]) {
  if (!reading.includes(want)) await fail("the reading should say \"" + want + "\": " + reading.slice(0, 600));
}
const drawn = await page.evaluate(() => document.querySelectorAll("[data-testid=drawing] *").length);
if (drawn < 50) await fail("the drawing should be drawn beside the reading (" + drawn + " shapes)");
await page.hover("text=TRIMMERS T&B\" (trim bars)");
await page.screenshot({ path: out + "/import-level1.png" });
await page.click("text=Create floor and build 3D");
await page.waitForURL(/\/job\/[^/]+\/[^/]+$/);
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data() && window.xstrucViewer.data().kind === "floor", null, { timeout: 20000 }).catch(() => fail("the floor from the drawing should build"));
const imported = await page.textContent("[data-testid=run-stats]");
if (!/1,085/.test(imported) || !/level1-slab-plan\.dxf/.test(await page.textContent("[data-testid=source]"))) await fail("the floor from the drawing should have 1,085 bars and name its drawing: " + imported);
await page.screenshot({ path: out + "/import-built.png" });
// a PDF plan in a consultant's style (no grids, callouts on their distribution lines, TOP & BOT): read in the browser
await page.goto(projectUrl + "/import");
await page.click("text=Try a sample PDF");
await page.waitForSelector("[data-testid=reading]", { timeout: 20000 }).catch(() => fail("the sample PDF should be read in the browser"));
let pdfReading = await page.textContent("[data-testid=reading]");
for (const want of ["No grid lines", "Slab 13,500 × 7,500", "long narrow strip", "bars N-S (up the sheet), written on its distribution line", "Outer layers (T1 on top, B1 underneath)"]) {
  if (!pdfReading.includes(want)) await fail("the PDF reading should say \"" + want + "\": " + pdfReading.slice(0, 900));
}
if (!/scale from the sheet \(1:50\)/.test(await page.textContent("main"))) await fail("the PDF's scale should come from the sheet");
await page.click("[data-testid=pages] button:has-text('▶')");
await page.waitForFunction(() => /looks like sections and details/.test(document.querySelector("[data-testid=reading]")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => fail("page 2 should be named a sections sheet"));
await page.click("[data-testid=pages] button:has-text('◀')");
await page.waitForFunction(() => /Page 1 of 2/.test(document.querySelector("[data-testid=pages]")?.textContent ?? ""));
for (const [k, v] of [["thickness", "300"], ["cover", "50"], ["fc", "32"], ["lap", "500"]]) { await page.fill("input[name=" + k + "]", v); await page.press("input[name=" + k + "]", "Enter"); }
await page.click("[data-testid=missing] button:has-text('N-S bars')");
await page.waitForFunction(() => !document.querySelector("[data-testid=missing]"));
pdfReading = await page.textContent("[data-testid=reading]");
if (!/Layer A \(B1\): N12-200 N-S/.test(pdfReading) || !/300 bars, 2,005 kg/.test(pdfReading)) await fail("with the values and the outer layers given the pad should build: " + pdfReading.slice(-500));
await page.screenshot({ path: out + "/import-pdf.png" });
await page.click("text=Create floor and build 3D");
await page.waitForURL(/\/job\/[^/]+\/[^/]+$/);
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data() && window.xstrucViewer.data().kind === "floor", null, { timeout: 20000 }).catch(() => fail("the pad from the PDF should build"));
if (!/300/.test(await page.textContent("[data-testid=run-stats]"))) await fail("the pad should have 300 bars");
await page.screenshot({ path: out + "/import-pdf-built.png" });

// a drawing with problems: the values it lacks are asked for, and its errors stop the build
await page.goto(projectUrl + "/import");
await page.setInputFiles("[data-testid=drawing-file]", new URL("../../../packages/reader/test/fixtures/problems.dxf", import.meta.url).pathname);
await page.waitForSelector("[data-testid=missing]");
const prob = await page.textContent("[data-testid=reading]");
if (!/Slab thickness \(mm\)/.test(prob) || !/say which way this mat runs/.test(prob) || !(await page.isDisabled("text=Create floor and build 3D"))) await fail("problems.dxf should ask for the thickness, list the direction error and not build");
await page.click("[data-testid=missing] button:has-text('30')");
await page.fill("input[name=thickness]", "200"); await page.press("input[name=thickness]", "Enter");
await page.waitForFunction(() => !document.querySelector("[data-testid=missing]"));
if (!(await page.isDisabled("text=Create floor and build 3D"))) await fail("errors in the callouts should still stop the build");

// account screens go home
for (const p of ["/sign-in", "/projects", "/team"]) {
  const r = await page.goto(base + p);
  if (new URL(page.url()).pathname !== "/" || !r.ok()) await fail(p + " should send you to the projects, not " + page.url());
}
const api = await fetch(base + "/api/versions/x/approve", { method: "POST" });
if (api.status !== 404) await fail("the approval route should be off with accounts off (" + api.status + ")");

// backup, wipe, restore
await page.waitForSelector("text=Lot 12 Salisbury");
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Backup')")]);
const file = out + "/jobs-backup.json";
await dl.saveAs(file);
const back = JSON.parse(readFileSync(file, "utf8"));
if (back.app !== "X Struc" || back.projects.length !== 1 || back.projects[0].elements[0].inputs.thickness !== 250 || back.projects[0].elements.length !== 3) await fail("the backup should hold the project, its edited floor and the two floors from drawings");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector("text=No projects on this device yet");
await page.setInputFiles("[data-testid=restore-file]", file);
await page.waitForSelector("text=Restored: 1 project(s) added");
await page.goto(elUrl);
await page.waitForFunction(() => window.xstrucViewer && window.xstrucViewer.data(), null, { timeout: 20000 }).catch(() => fail("the restored floor should open"));
await page.screenshot({ path: out + "/jobs-restored.png" });

if (errors.length) await fail("console errors: " + errors.join(" | "));
await browser.close(); server.kill();
console.log("e2e jobs: OK (no sign-in, project and floor kept on the device, floors read from a DXF and a PDF drawing, account screens off, backup and restore)");
