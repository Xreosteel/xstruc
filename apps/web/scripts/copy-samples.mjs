// Copies what the import screen needs into public/: the reader's sample drawings ("Try a sample"), and pdf.js's
// worker, which reads PDFs off the page's main thread.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const here = (p) => new URL(p, import.meta.url);
mkdirSync(here("../public/samples/"), { recursive: true });
copyFileSync(here("../../../packages/reader/test/fixtures/level1.dxf"), here("../public/samples/level1-slab-plan.dxf"));
copyFileSync(here("../../../packages/reader/test/fixtures/washpad.pdf"), here("../public/samples/example-pad-plan.pdf"));
const require = createRequire(import.meta.url);
mkdirSync(here("../public/pdfjs/"), { recursive: true });
copyFileSync(require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"), here("../public/pdfjs/pdf.worker.min.mjs"));
