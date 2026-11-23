// Copies the reader's sample drawing into public/ so "Try the sample drawing" works with no file of your own.
import { copyFileSync, mkdirSync } from "node:fs";
const from = new URL("../../../packages/reader/test/fixtures/level1.dxf", import.meta.url);
const dir = new URL("../public/samples/", import.meta.url);
mkdirSync(dir, { recursive: true });
copyFileSync(from, new URL("level1-slab-plan.dxf", dir));
