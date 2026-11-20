import { BAR_SIZES } from "./constants.ts";
import { MESH_CODES } from "./bending.ts";

// ---------- callout grammar ---------- (strict TypeScript, backlog #39)

/** One parsed drawing callout. Fields the text does not give are null; words it could not place are in notes. */
export interface Callout {
  raw: string;
  kind: "bar" | "mesh" | "thickness" | null;
  count: number | null; type: string | null; size: number | null; spacing: number | null;
  layer: string | null; position: string | null; direction: string | null; role: string | null;
  length: number | null; mesh: string | null; value: number | null;
  notes: string[]; error: string | null;
}
export interface CalloutOptions { scheme?: "TB" | "ABCD" }

// parseCallout("17N16-250 T") -> { kind: "bar", count: 17, type: "N", size: 16, spacing: 250, position: "T", ... }
// scheme "TB": single letters T/B and T1 T2 B1 B2 are positions/layers; scheme "ABCD": single letters A–D are layer ids.
function parseCallout(input: unknown, opts?: CalloutOptions): Callout {
  opts = opts || {};
  const scheme = opts.scheme || "TB";
  const raw = String(input == null ? "" : input).trim();
  const out: Callout = { raw: raw, kind: null, count: null, type: null, size: null, spacing: null, layer: null, position: null, direction: null, role: null, length: null, mesh: null, value: null, notes: [], error: null };
  if (!raw) { out.error = "empty line"; return out; }
  let s = raw.toUpperCase().replace(/[×✕]/g, "X").replace(/[–—]/g, "-").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
  s = s.replace(/^[-•*]\s*/, "").replace(/\b([NRSW]\d{1,2})S\b/g, "$1");   // "N12S" plural → N12
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{2,4})\s*(?:MM\s*)?(?:THK|THICK|THICKNESS)\b/))) { out.kind = "thickness"; out.value = +m[1]; return out; }

  const ROLES: [RegExp, string][] = [
    [/\b(?:ADDITIONAL|ADD|EXTRAS?)\b/, "extra"], [/\bTRIM(?:MERS?|MING)?\b/, "trim"], [/\bSTARTERS?\b/, "starter"],
    [/\b(?:LIGS?|LIGATURES?|TIES|STIRRUPS|FITMENTS)\b/, "lig"], [/\bDIST(?:RIBUTION)?\b/, "distribution"], [/\bEDGE BARS?\b/, "edge"],
    [/\b(?:DIAG(?:ONALS?)?|CORNER BARS?)\b/, "diagonal"], [/\bDOWELS?\b/, "dowel"], [/\b(?:HAIRPINS?|U-?BARS?)\b/, "u-bar"], [/\b(?:Z-?BARS?)\b/, "z-bar"], [/\b(?:L-?BARS?)\b/, "l-bar"]
  ];
  ROLES.forEach(r => { if (!out.role && r[0].test(s)) out.role = r[1]; });
  let rest = s;
  ROLES.forEach(r => { rest = rest.replace(r[0], " "); });

  // mesh: SL82 T, RL918 B, 3-L11TM BTM, 2 LAYERS SL82
  m = rest.match(/(?:^|\s)(?:(\d{1,2})\s*(?:-|X|NO\.?|OFF)?\s*(?:LAYERS?\s+(?:OF\s+)?)?)?(SL|RL|L)\s?(\d{1,4})\s?(TM)?(?![\dA-Z])/);
  if (m && (m[2] !== "L" || m[4])) {
    out.kind = "mesh"; out.count = m[1] ? +m[1] : null; out.type = m[2] + (m[4] || ""); out.size = +m[3]; out.mesh = m[2] + m[3] + (m[4] || "");
    if (MESH_CODES.indexOf(out.mesh) < 0) out.notes.push(out.mesh + " is not a standard mesh code");
    rest = rest.slice(0, m.index!) + " " + rest.slice(m.index! + m[0].length);
  } else {
    // bar: [count][sep]TYPE SIZE, e.g. 17N16, 2-N16, 3 NO. N16, N 12
    m = rest.match(/(?:^|[\s(])(?:(\d{1,3})\s*(?:NO\.?|OFF|-|X)?\s*)?([NRSW])\s?(\d{1,2})(?![\dA-Z])/);
    if (!m) { out.error = "no bar or mesh designation found (expected something like N12-200 T)"; return out; }
    out.kind = "bar"; out.count = m[1] ? +m[1] : null; out.type = m[2]; out.size = +m[3];
    if (BAR_SIZES[m[2] as keyof typeof BAR_SIZES].indexOf(out.size) < 0) out.error = out.type + out.size + " is not a standard " + out.type + " bar size";
    rest = rest.slice(0, m.index!) + " " + rest.slice(m.index! + m[0].length);
  }
  // length: x 3000, 3000 LONG
  if ((m = rest.match(/(?:^|\s)X\s*(\d{3,5})(?![\d])(?!\s*X\s*\d)/)) || (m = rest.match(/(\d{3,5})\s*(?:MM\s*)?(?:LONG|LG)\b/))) {
    out.length = +m[1]; rest = rest.slice(0, m.index!) + " " + rest.slice(m.index! + m[0].length);
  }
  // spacing: -200, @200, AT 200, 200 CTS
  if ((m = rest.match(/(?:^|\s)[-@]?\s*(?:AT\s+)?(\d{2,4})\s*(?:MM\s*)?(?:CTS|CRS|C\/C|CC|CENTRES|CENTERS|CENTRE|CENTER|SPACING)?(?![\d])/))) {
    out.spacing = +m[1]; rest = rest.slice(0, m.index!) + " " + rest.slice(m.index! + m[0].length);
  }
  rest = rest.replace(/\bTOP\s*(?:AND|&|\+)\s*(?:BOTTOM|BTM|BOT)\b/, " T&B ").replace(/\b(?:BOTTOM|BTM|BOT)\s*(?:AND|&|\+)\s*TOP\b/, " T&B ");
  rest = rest.replace(/\bEACH WAY\b/, " EW ").replace(/\bBOTH WAYS\b/, " EW ").replace(/\bEACH FACE\b/, " EF ").replace(/\bNEAR FACE\b/, " NF ").replace(/\bFAR FACE\b/, " FF ");
  const FILL = /^(?:BARS?|MESH|FABRIC|CTS|CRS|AT|@|-|MM|NO\.?|OFF|PROVIDE|PLACE|LAY|IN|THE|OF|TO|AND|&|WITH|\(|\))$/;
  rest.split(/[\s,]+/).filter(Boolean).forEach(tok => {
    if (FILL.test(tok)) return;
    if (/^(?:T&B|T\+B|TB|T\/B|B&T)$/.test(tok)) { out.position = "TB"; return; }
    if (/^(?:TOP|T)$/.test(tok)) { if (!out.position) out.position = "T"; return; }
    if (/^(?:BOTTOM|BTM|BOT)$/.test(tok)) { if (!out.position) out.position = "B"; return; }
    if (/^(?:T1|T2|B1|B2)$/.test(tok)) { out.layer = tok; out.position = tok[0]; return; }
    if (scheme === "ABCD" && /^[ABCD]$/.test(tok)) { out.layer = tok; out.position = tok < "C" ? "B" : "T"; return; }
    if (scheme !== "ABCD" && tok === "B") { if (!out.position) out.position = "B"; return; }
    if (/^(?:EF)$/.test(tok)) { out.position = "EF"; return; }
    if (/^(?:NF|FF)$/.test(tok)) { out.position = tok; return; }
    if (/^(?:CENTRAL|CENT|CEN|MID)$/.test(tok)) { out.position = "C"; return; }
    if (/^(?:EW|E\/W|BW|B\/W)$/.test(tok)) { out.direction = "EW"; return; }
    if (/^(?:E-W|EAST-WEST|X)$/.test(tok)) { out.direction = "X"; return; }
    if (/^(?:N-S|NS|N\/S|NORTH-SOUTH|Y)$/.test(tok)) { out.direction = "Y"; return; }
    if (/^(?:HORIZ(?:ONTAL)?|H)$/.test(tok)) { out.direction = "H"; return; }
    if (/^(?:VERT(?:ICAL)?|V)$/.test(tok)) { out.direction = "V"; return; }
    if (/^(?:LONG(?:ITUDINAL)?|LONGIT)$/.test(tok)) { out.direction = "LONG"; return; }
    if (/^(?:TRANS(?:VERSE)?)$/.test(tok)) { out.direction = "TRANS"; return; }
    out.notes.push(tok);
  });
  if (out.notes.length) out.notes = [out.notes.join(" ")];
  return out;
}

// A slab mat runs one way, and the drawing must say which (DECISIONS.md: no default direction; backlog #21).
// Returns null when the parsed direction is a plan direction (X = E-W, Y = N-S), else the error wording for the panel.
function matDirectionError(direction: string | null | undefined): string | null {
  if (direction === "X" || direction === "Y") return null;
  if (!direction) return "say which way this mat runs: E-W or N-S (no direction is assumed).";
  if (direction === "EW") return "\"each way\" covers two layers; give each layer its own direction, E-W or N-S.";
  const words: Record<string, string> = { H: "horizontal", V: "vertical", LONG: "longitudinal", TRANS: "transverse" };
  return (words[direction] || direction) + " is a wall or beam direction; a slab mat runs E-W or N-S.";
}

export { parseCallout, matDirectionError };
