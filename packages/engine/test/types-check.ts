// Compiled by `tsc --noEmit` in the package's typecheck script: the public API as a TypeScript caller sees it.
import { buildModel, canonicalOutput, DEFAULT_CFG, PANEL_CFG, ENGINE_VERSION, type Model, type PanelInput } from "../src/index.js";

const floor: Model = buildModel(DEFAULT_CFG);
const panelCfg: PanelInput = { ...PANEL_CFG, W: 5400 };
const panel: Model = buildModel(panelCfg);
const hashInput: string = canonicalOutput(panel);
const total: number = floor.kg + panel.kg;
const firstMark: string | undefined = floor.marks[0]?.mark;
const version: string = ENGINE_VERSION;
export { hashInput, total, firstMark, version };
