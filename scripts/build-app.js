#!/usr/bin/env node
// Builds the installable app (backlog #34) that GitHub Pages serves: node scripts/build-app.js [outDir=_site]
//   index.html            the viewer as a full document: doctype, viewport, manifest, theme colour, icons
//   manifest.webmanifest  name, icons, shortcuts (floor / panel / site mode), screenshots
//   sw.js                 offline worker with this build's version and file list
//   icons/, screenshots/  copied from app/
// index.html in the repo stays the self-contained fragment the claude.ai artifact publishes; the app parts only exist
// here, so the artifact never asks for a manifest or a worker it does not have.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "app");

// the head the Pages copy gets in front of the fragment (the fragment's own <title>, <style> and preconnects follow)
function head(version) {
  return [
    "<!doctype html>",
    '<html lang="en-AU">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="description" content="X Struc: 3D reinforcement viewer for floor slabs and precast panels. Every bar layer by layer in fixing order, with tags, a placing sheet and a bar schedule.">',
    '<meta name="theme-color" content="#11151a">',
    '<meta name="xstruc-version" content="' + version + '">',
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
    '<link rel="icon" href="icons/icon-192.png" sizes="192x192" type="image/png">',
    '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="X Struc">',
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
    ""
  ].join("\n");
}

// the CDN scripts the page loads: kept by the worker so the 3D view works offline
function cdnScripts(html) {
  return [...html.matchAll(/<script\s+src="(https:\/\/[^"]+)"/g)].map(m => m[1]);
}

const listDir = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => !f.startsWith(".")).sort() : [];

// opts.html: build from this page text instead of index.html (the tests use it to check the version follows the page)
function build(outDir, opts) {
  opts = opts || {};
  const html = opts.html != null ? opts.html : fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  if (/^\s*<!doctype/i.test(html) || /<head[\s>]/i.test(html)) throw new Error("index.html now has its own doctype/head: update scripts/build-app.js to merge the app tags into it");
  if (!/^\s*<title>/.test(html)) throw new Error("index.html should start with its <title> (the artifact fragment)");
  const manifest = fs.readFileSync(path.join(APP, "manifest.webmanifest"), "utf8");
  JSON.parse(manifest);
  const swSrc = fs.readFileSync(path.join(APP, "sw.js"), "utf8");
  const icons = listDir(path.join(APP, "icons")), shots = listDir(path.join(APP, "screenshots"));

  const h = crypto.createHash("sha256");
  [html, manifest, swSrc].forEach(s => h.update(s));
  icons.forEach(f => h.update(fs.readFileSync(path.join(APP, "icons", f))));
  const version = h.digest("hex").slice(0, 12);

  const cdn = cdnScripts(html);
  const precache = ["./", "manifest.webmanifest"].concat(icons.map(f => "icons/" + f), cdn);
  const marker = /\/\*BUILD\*\/[\s\S]*?\/\*BUILD\*\//;
  if (!marker.test(swSrc)) throw new Error("app/sw.js lost its /*BUILD*/ markers");
  const sw = swSrc.replace(marker, "/*BUILD*/" + JSON.stringify({ version: version, precache: precache }) + "/*BUILD*/");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), head(version) + html);
  fs.writeFileSync(path.join(outDir, "manifest.webmanifest"), manifest);
  fs.writeFileSync(path.join(outDir, "sw.js"), sw);
  icons.forEach(f => fs.copyFileSync(path.join(APP, "icons", f), path.join(outDir, "icons", f)));
  if (shots.length) {
    fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
    shots.forEach(f => fs.copyFileSync(path.join(APP, "screenshots", f), path.join(outDir, "screenshots", f)));
  }
  return { outDir, version, precache, icons, shots, cdn };
}

module.exports = { build, cdnScripts };

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, "_site"));
  const r = build(out);
  console.log("app built: " + path.relative(process.cwd(), out) + " · version " + r.version + " · " + r.precache.length + " files kept offline · " + r.icons.length + " icons · " + r.shots.length + " screenshots");
}
