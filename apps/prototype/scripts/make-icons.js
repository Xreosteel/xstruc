#!/usr/bin/env node
// Draws the X Struc app icons (backlog #34) and writes them to app/icons/. Dev-only: run it when the art changes and
// commit the output; the Pages build only copies the files. Needs `sharp` (not a project dependency):
//   NODE_PATH=$(npm root -g) node scripts/make-icons.js
// The mark is an X of two deformed bars, the bottom one (layer A blue) under the top one (layer D red), on a faint mesh.
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const BG = "#11151a", GRID = "#1c242d", A = "#4f8fe8", D = "#e5534b";
// one bar from p to q: ribs drawn under the body so only their ends stand proud, like the lugs on an N bar
const bar = (p, q, c, rib, gap) =>
  (gap ? `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${BG}" stroke-width="${gap}"/>` : "") +
  `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${rib}" stroke-width="80" stroke-dasharray="10 23"/>` +
  `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c}" stroke-width="54"/>`;
// full: square, full-bleed background (maskable / apple-touch); scale: art size inside the 512 box
function art({ full, scale }) {
  const k = scale, t = 256 * (1 - k);
  const grid = [64, 128, 192, 256, 320, 384, 448].map(v => `<line x1="${v}" y1="0" x2="${v}" y2="512"/><line x1="0" y1="${v}" x2="512" y2="${v}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<defs><clipPath id="c"><rect width="512" height="512" rx="${full ? 0 : 112}"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect width="512" height="512" fill="${BG}"/><g stroke="${GRID}" stroke-width="4">${grid}</g>` +
    `<g transform="translate(${t} ${t}) scale(${k})">` +
    bar([116, 396], [396, 116], A, "#3567b3", 0) +
    bar([116, 116], [396, 396], D, "#b23a33", 98) +
    `</g></g></svg>`;
}

(async () => {
  const out = path.join(__dirname, "..", "app", "icons");
  fs.mkdirSync(out, { recursive: true });
  const any = art({ full: false, scale: 1 }), mask = art({ full: true, scale: 0.78 }), apple = art({ full: true, scale: 1 });
  fs.writeFileSync(path.join(out, "icon.svg"), any + "\n");
  const png = (svg, size, name) => sharp(Buffer.from(svg), { density: 72 * size / 512 * 2 }).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(out, name));
  await png(any, 192, "icon-192.png");
  await png(any, 512, "icon-512.png");
  await png(mask, 192, "maskable-192.png");
  await png(mask, 512, "maskable-512.png");
  await png(apple, 180, "apple-touch-icon.png");
  await png(any, 96, "shortcut-96.png");
  console.log("icons written to", path.relative(process.cwd(), out));
})();
