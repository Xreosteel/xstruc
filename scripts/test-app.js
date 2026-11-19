#!/usr/bin/env node
// Checks the installable app build (backlog #34) without a browser: the page document, the manifest and its icons and
// screenshots, the offline worker's file list and version, and that the artifact copy stays free of app parts.
// The browser side (install, offline reload, the new-version bar) is scripts/smoke-app.js.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { build, cdnScripts } = require("./build-app");

const ROOT = path.join(__dirname, "..");
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// PNG: width/height from IHDR. WebP: from the VP8 / VP8L / VP8X header.
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.slice(1, 4).toString() === "PNG") return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") {
    const kind = b.slice(12, 16).toString();
    if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8L") { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (/\.svg$/.test(file)) return ["any", "any"];
  return null;
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "xstruc-app-"));
let r;
try { r = build(out); } catch (e) { console.error("app: FAIL\n  build threw: " + e.message); process.exit(1); }
const fragment = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const page = fs.readFileSync(path.join(out, "index.html"), "utf8");

// the artifact copy: no manifest, so it never registers a worker it has not got
ok(!/<link[^>]*rel="manifest"/.test(fragment), "index.html (the artifact copy) must not link a manifest; the build adds it");
ok(/<title>X Struc Viewer<\/title>/.test(fragment), "index.html <title> must stay X Struc Viewer");

// the Pages page
ok(/^<!doctype html>\n<html lang="en-AU">/.test(page), "built page should start with a doctype and <html lang>");
ok(/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/.test(page), "built page has no phone viewport");
ok(page.includes('<link rel="manifest" href="manifest.webmanifest">'), "built page does not link the manifest");
ok(page.includes('<meta name="xstruc-version" content="' + r.version + '">'), "built page does not carry its version");
ok(page.includes('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'), "built page has no iPhone icon");
ok(page.endsWith(fragment), "built page should be the head followed by index.html unchanged");

// manifest
let man = {};
try { man = JSON.parse(fs.readFileSync(path.join(out, "manifest.webmanifest"), "utf8")); } catch (e) { problems.push("manifest is not JSON: " + e.message); }
ok(man.name === "X Struc" && man.short_name === "X Struc", "manifest name / short_name");
ok(man.start_url === "./" && man.scope === "./" && man.id === "./", "manifest start_url, scope and id should be ./ (the site lives under /xstruc/)");
ok(man.display === "standalone", "manifest display should be standalone");
ok(/^#[0-9a-f]{6}$/i.test(man.theme_color || "") && /^#[0-9a-f]{6}$/i.test(man.background_color || ""), "manifest colours");
const icons = man.icons || [];
const hasIcon = (size, purpose) => icons.some(i => i.sizes === size && (i.purpose || "any").split(" ").includes(purpose) && /png/.test(i.type));
ok(hasIcon("192x192", "any") && hasIcon("512x512", "any"), "manifest needs 192 and 512 PNG icons (install needs both)");
ok(hasIcon("512x512", "maskable"), "manifest needs a 512 maskable icon (Android home screen)");
const files = icons.map(i => i.src).concat((man.shortcuts || []).flatMap(s => (s.icons || []).map(i => i.src)));
icons.concat((man.shortcuts || []).flatMap(s => s.icons || []), man.screenshots || []).forEach(i => {
  const f = path.join(out, i.src);
  if (!fs.existsSync(f)) { problems.push("manifest names " + i.src + " but the build has no such file"); return; }
  const sz = imageSize(f);
  if (!sz) { problems.push(i.src + ": unknown image format"); return; }
  if (i.sizes !== "any") ok(i.sizes === sz.join("x"), i.src + " is " + sz.join("x") + ", manifest says " + i.sizes);
});
(man.screenshots || []).forEach(s => {
  const [w, h] = s.sizes.split("x").map(Number);
  ok(s.form_factor === (w > h ? "wide" : "narrow"), s.src + ": form_factor should be " + (w > h ? "wide" : "narrow"));
  ok(Math.max(w, h) / Math.min(w, h) <= 2.3, s.src + ": aspect ratio over 2.3 (Chrome drops it)");
});
ok((man.screenshots || []).some(s => s.form_factor === "wide") && (man.screenshots || []).some(s => s.form_factor === "narrow"), "one wide and one narrow screenshot (the richer install dialog)");
// every shortcut lands somewhere the page handles
const handles = { "./?floor": /\[\?&\]floor\\b/, "./?panel": /\[\?&\]panel\\b/, "./?site": /\[\?&\]site\\b/ };
(man.shortcuts || []).forEach(s => ok(handles[s.url] && handles[s.url].test(fragment), "shortcut " + s.name + " (" + s.url + ") is not handled by the page"));
ok((man.shortcuts || []).length === 3, "three shortcuts: floor, panel, site mode");

// worker
const sw = fs.readFileSync(path.join(out, "sw.js"), "utf8");
try { new vm.Script(sw, { filename: "sw.js" }); } catch (e) { problems.push("sw.js does not parse: " + e.message); }
const m = sw.match(/\/\*BUILD\*\/([\s\S]*?)\/\*BUILD\*\//);
const B = m ? JSON.parse(m[1]) : {};
ok(B.version === r.version && /^[0-9a-f]{12}$/.test(B.version), "sw.js version should be the build's");
const pre = B.precache || [];
ok(pre.includes("./") && pre.includes("manifest.webmanifest"), "worker must keep the page and the manifest");
files.forEach(f => ok(pre.includes(f), "worker does not keep " + f));
cdnScripts(fragment).forEach(u => ok(pre.includes(u), "worker does not keep " + u + " (the 3D view would not start offline)"));
ok(cdnScripts(fragment).length === 2, "expected the two pinned three.js scripts, found " + cdnScripts(fragment).length);
pre.filter(u => !/^https:/.test(u)).forEach(u => ok(u === "./" || fs.existsSync(path.join(out, u)), "worker keeps " + u + " but the build has no such file"));
// a new page is a new version (so phones pick it up), the same page is the same version (no needless downloads)
const out2 = fs.mkdtempSync(path.join(os.tmpdir(), "xstruc-app-"));
ok(build(out2, { html: fragment }).version === r.version, "same page should give the same version");
ok(build(out2, { html: fragment + "\n<!-- changed -->" }).version !== r.version, "a changed page should give a new version");
fs.rmSync(out2, { recursive: true, force: true });

// the Pages workflow publishes the build, not the bare fragment
const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
ok(/node scripts\/build-app\.js _site/.test(wf), "pages.yml should publish with scripts/build-app.js");

fs.rmSync(out, { recursive: true, force: true });
if (problems.length) { console.error("app: FAIL\n  " + problems.join("\n  ")); process.exit(1); }
console.log("app: OK (version " + r.version + ", " + pre.length + " files kept offline, " + icons.length + " icons, " + (man.screenshots || []).length + " screenshots, " + (man.shortcuts || []).length + " shortcuts)");
