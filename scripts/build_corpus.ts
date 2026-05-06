#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * build_corpus.ts — Convert raw Linear A corpus data → .linearA inscription files.
 *
 * Input:  corpus/raw/linearA_raw.txt  (JS Map format from mwenge/lineara.xyz)
 * Output: corpus/inscriptions/*.linearA
 *         corpus/inscription.index.yaml
 *
 * Signs are Unicode Linear A characters (U+10600–U+1077F), treated as opaque IDs.
 * No phonetic values assigned at any layer.
 */

const REPO_ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const RAW_FILE  = `${REPO_ROOT}corpus/raw/linearA_raw.txt`;
const OUT_DIR   = `${REPO_ROOT}corpus/inscriptions`;
const INDEX_OUT = `${REPO_ROOT}corpus/inscription.index.yaml`;

const SITE_NAMES: Record<string, string> = {
  HT: "Hagia Triada",
  KH: "Khania",
  ZA: "Zakros",
  KN: "Knossos",
  PH: "Phaistos",
  AP: "Akrotiri Papadiokampos",
  AR: "Arkhanes",
  IO: "Iouktas",
  MA: "Malia",
  PE: "Petras",
  PR: "Prasa",
  PS: "Pseira",
  PY: "Pyrgos",
  TL: "Tylissos",
};

export interface RawInscription {
  id: string;
  site: string;
  type: string;
  words: string[][];  // each inner array = one sign group, each string = one Unicode sign char
}

/** Linear A Unicode block: U+10600–U+1077F */
function isLinearAChar(cp: number): boolean {
  return cp >= 0x10600 && cp <= 0x1077F;
}

/** Word dividers and punctuation to skip.
 *
 * A token should be skipped if:
 *   - it is the Aegean word separator (U+10101 or U+10100)
 *   - it is a decimal number string like "197"
 *   - ALL of its Unicode characters fall outside the Linear A block
 *     (catches Aegean numeral tokens like "𐄙𐄘𐄍" which are U+10100–U+1013F)
 */
function shouldSkipToken(s: string): boolean {
  if (s === "\n") return true;
  if (/^\d+$/.test(s)) return true;           // commodity count like "197"
  if (s === "𐄁" || s === "𐄀") return true;   // U+10101, U+10100

  const chars = [...s];
  // If every char is outside the Linear A block, skip the whole token
  if (chars.every(c => !isLinearAChar(c.codePointAt(0) ?? 0))) return true;

  return false;
}

/**
 * Parse the JS Map format:
 *   var inscriptions = new Map([ ["KEY", {...}], ... ]);
 * Returns array of normalized inscription objects.
 */
export function parseRawCorpus(raw: string): RawInscription[] {
  // Strip JS wrapper: "var inscriptions = new Map(" prefix and ");" suffix
  const mapStart = raw.indexOf("new Map(");
  if (mapStart === -1) {
    console.error("Cannot find 'new Map(' in corpus file. Unexpected format.");
    Deno.exit(1);
  }
  // Find the opening [ after "new Map("
  const arrStart = raw.indexOf("[", mapStart);

  // The file may have multiple Map declarations (e.g. var inscriptions + var lexicon).
  // Find the end of the FIRST Map by locating the next top-level "var " declaration
  // after mapStart, then searching backward for "])" to find the proper close.
  const nextVarIdx = raw.indexOf("\nvar ", mapStart + 10);
  // Search backward from nextVarIdx (or end of file) for the "])" that closes the array
  const searchTo = nextVarIdx !== -1 ? nextVarIdx : raw.length;
  const arrEnd = raw.lastIndexOf("])", searchTo);
  if (arrStart === -1 || arrEnd === -1) {
    console.error("Cannot find Map array bounds in corpus file.");
    Deno.exit(1);
  }
  // arrEnd points to ']' in '])' — slice to include just the closing ']'
  let jsonStr = raw.slice(arrStart, arrEnd + 1);

  // Fix JS-isms that are not valid JSON:
  // 1. Trailing commas before ] or }
  jsonStr = jsonStr.replace(/,(\s*[\]}])/g, "$1");
  // 2. JS Unicode escapes \u{XXXXX} → JSON surrogate pair \uHHHH\uHHHH
  jsonStr = jsonStr.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_match, hex) => {
    const cp = parseInt(hex, 16);
    if (cp <= 0xFFFF) return `\\u${cp.toString(16).padStart(4, "0")}`;
    // Encode as UTF-16 surrogate pair
    const offset = cp - 0x10000;
    const high = 0xD800 + (offset >> 10);
    const low  = 0xDC00 + (offset & 0x3FF);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  });

  let entries: [string, Record<string, unknown>][];
  try {
    entries = JSON.parse(jsonStr) as [string, Record<string, unknown>][];
  } catch (e) {
    console.error("Failed to parse corpus Map array as JSON:", (e as Error).message);
    console.error("First 300 chars of extracted JSON:", jsonStr.slice(0, 300));
    Deno.exit(1);
  }

  const result: RawInscription[] = [];

  for (const [key, obj] of entries) {
    const id = String(obj["name"] ?? key);
    const siteMatch = id.match(/^([A-Z]{2,3})/);
    const site = siteMatch ? siteMatch[1] : "XX";
    const type = String(obj["support"] ?? obj["type"] ?? "tablet").toLowerCase();

    // Use "words" field — skip transliteratedWords (has Linear B phonetic values)
    const rawWords = obj["words"];
    if (!Array.isArray(rawWords)) continue;

    const groups: string[][] = [];
    for (const token of rawWords as unknown[]) {
      if (typeof token !== "string") continue;
      if (shouldSkipToken(token)) continue;

      // Each Unicode character in the token is one sign.
      // Only include chars in the Linear A block.
      const signs = [...token].filter(c => isLinearAChar(c.codePointAt(0) ?? 0));
      if (signs.length > 0) groups.push(signs);
    }

    if (groups.length === 0) continue;
    result.push({ id, site, type, words: groups });
  }

  return result;
}

/** Format inscription ID as a safe filename slug */
function idToFilename(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** Write a single .linearA file */
function formatLinearAFile(insc: RawInscription): string {
  const signCount = insc.words.reduce((s, g) => s + g.length, 0);
  const siteName = SITE_NAMES[insc.site] ?? insc.site;
  const lines: string[] = [
    `# Linear A Inscription — ${insc.id}`,
    `# Site:    ${siteName} (${insc.site})`,
    `# Type:    ${insc.type}`,
    `# Groups:  ${insc.words.length}`,
    `# Signs:   ${signCount}`,
    ``,
  ];

  for (const group of insc.words) {
    lines.push(group.join("."));
  }

  lines.push(``);
  lines.push(`# ── Sign list (flat) ────────────────────────────────────────────────────────`);
  lines.push(insc.words.map(g => g.join(".")).join(" "));
  lines.push(``);

  return lines.join("\n");
}

async function main() {
  const raw = await Deno.readTextFile(RAW_FILE).catch(() => {
    console.error(`Cannot read ${RAW_FILE}. Run: deno task corpus:fetch`);
    Deno.exit(1);
  });

  console.log(`Parsing corpus (${raw.length} bytes)...`);
  const inscriptions = parseRawCorpus(raw);
  console.log(`  Parsed ${inscriptions.length} inscriptions`);

  await Deno.mkdir(OUT_DIR, { recursive: true });

  let written = 0;
  for (const insc of inscriptions) {
    const filename = `${idToFilename(insc.id)}.linearA`;
    const content = formatLinearAFile(insc);
    await Deno.writeTextFile(`${OUT_DIR}/${filename}`, content);
    written++;
  }
  console.log(`  Wrote ${written} .linearA files to ${OUT_DIR}/`);

  // Build site aggregates
  const sites: Record<string, { name: string; count: number; signs: number }> = {};
  for (const insc of inscriptions) {
    if (!sites[insc.site]) {
      sites[insc.site] = { name: SITE_NAMES[insc.site] ?? insc.site, count: 0, signs: 0 };
    }
    sites[insc.site].count++;
    sites[insc.site].signs += insc.words.reduce((s, g) => s + g.length, 0);
  }

  const totalSigns = inscriptions.reduce((s, i) => s + i.words.reduce((ss, g) => ss + g.length, 0), 0);
  const yaml: string[] = [
    `# Linear A Inscription Index`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# Source: corpus/raw/linearA_raw.txt`,
    `# Total inscriptions: ${inscriptions.length}`,
    `# Total signs: ${totalSigns}`,
    ``,
    `sites:`,
  ];
  for (const [code, data] of Object.entries(sites).sort()) {
    yaml.push(`  ${code}: { name: "${data.name}", inscriptions: ${data.count}, signs: ${data.signs} }`);
  }
  yaml.push(``);
  yaml.push(`inscriptions:`);
  for (const insc of inscriptions) {
    const signCount = insc.words.reduce((s, g) => s + g.length, 0);
    const filename = `${idToFilename(insc.id)}.linearA`;
    yaml.push(`  - id: "${insc.id}"`);
    yaml.push(`    site: ${insc.site}`);
    yaml.push(`    type: ${insc.type}`);
    yaml.push(`    groups: ${insc.words.length}`);
    yaml.push(`    signs: ${signCount}`);
    yaml.push(`    file: inscriptions/${filename}`);
  }

  await Deno.writeTextFile(INDEX_OUT, yaml.join("\n") + "\n");
  console.log(`  Wrote inscription index to ${INDEX_OUT}`);
  console.log(`\nCorpus built. NEXT: deno task corpus:analyze`);
}

main();
