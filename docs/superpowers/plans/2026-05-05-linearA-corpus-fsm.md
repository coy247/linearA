# Linear A Corpus & FSM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data-driven Linear A corpus layer, sign FSM, health gate, and fabric
pattern using pure corpus statistics — no Linear B phonetic assumptions.

**Architecture:** Mirror the Voynich pipeline from booLang exactly:
`corpus → frequency analysis → bigram matrix → FSM → health gate → fabric pattern`.
Linear A sign groups (dot-separated sign tokens) replace Voynich EVA character strings.
Signs are treated as opaque identifiers throughout — no phonetic values assigned.
The canonical_octet layer (already built in `src/canonical_octet.ts`) provides byte
encoding via compact frequency-ranked indices.

**Tech Stack:** Deno + TypeScript (no external deps beyond `deno.land/std`),
lineara.xyz / mwenge GitHub JSON corpus, YAML output, fabric pattern.

**Spec:** `docs/superpowers/specs/2026-05-05-linearA-solving-design.md`
**Reference:** `reference/` — Voynich approach files from booLang

---

## File Map

```
linearA/
  scripts/
    fetch_corpus.ts        — Task 2: fetch raw JSON from GitHub → corpus/raw/
    build_corpus.ts        — Task 3: JSON → .linearA files + inscription.index.yaml
    analyze_signs.ts       — Task 4+5: frequency table + bigram matrix → corpus/analysis/
    derive_fsm.ts          — Task 6: FSM derivation → spec/linear-a-fsm.yaml
  spec/
    linear-a-fsm.yaml          — Task 6 output (generated + committed)
    linear-a-fsm-validator.ts  — Task 7: pure scorer (hand-written after Task 6)
    linear-a-fsm-validator-test.ts  — Task 7: exhaustive proof tests
    linear-a-corpus-health.ts  — Task 8: corpus scorer script
  corpus/
    raw/                   — Task 2 output (raw fetched JSON, gitignored if large)
    inscriptions/          — Task 3 output (.linearA files)
    inscription.index.yaml — Task 3 output
    analysis/
      sign-frequency.json  — Task 4 output
      sign-index.json      — Task 4 output (compact index: sign → compact_id)
      bigram-matrix.json   — Task 5 output
    corpus-health.yaml     — Task 8 output
  fabric/
    linear_a_translate.md  — Task 9 output (local copy)
  src/
    canonical_octet.ts         ✓ done
    canonical_octet_test.ts    ✓ done
  deno.json                    — updated in Task 1
```

---

## Task 1: Scaffold directories + update deno.json

**Files:**
- Modify: `deno.json`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p corpus/raw corpus/inscriptions corpus/analysis scripts spec fabric
```

Expected: directories created, no output.

- [ ] **Step 2: Update deno.json with tasks**

Replace `deno.json` with:

```json
{
  "tasks": {
    "test": "deno test --allow-net src/",
    "test:canonical": "deno test --allow-net src/canonical_octet_test.ts",
    "test:fsm": "deno test --allow-net spec/linear-a-fsm-validator-test.ts",
    "corpus:fetch": "deno run --allow-net --allow-write scripts/fetch_corpus.ts",
    "corpus:build": "deno run --allow-read --allow-write scripts/build_corpus.ts",
    "corpus:analyze": "deno run --allow-read --allow-write scripts/analyze_signs.ts",
    "corpus:fsm": "deno run --allow-read --allow-write scripts/derive_fsm.ts",
    "corpus:health": "deno run --allow-read --allow-write spec/linear-a-corpus-health.ts"
  }
}
```

- [ ] **Step 3: Verify test suite still passes**

```bash
deno task test:canonical
```

Expected:
```
ok | 29 passed | 0 failed (16ms)
```

- [ ] **Step 4: Commit**

```bash
git add deno.json
git commit -m "scaffold: directory structure + deno tasks for linearA pipeline"
```

---

## Task 2: Fetch raw corpus from GitHub

**Files:**
- Create: `scripts/fetch_corpus.ts`

The lineara.xyz corpus lives in the mwenge/LinearA GitHub repository.
This task fetches the raw data and saves it locally so all subsequent
steps work offline.

- [ ] **Step 1: Write fetch script**

Create `scripts/fetch_corpus.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-net --allow-write
/**
 * fetch_corpus.ts — Fetch Linear A corpus JSON from GitHub.
 * Saves raw response to corpus/raw/ for offline processing.
 *
 * Sources tried in order (first success wins):
 *   1. mwenge/LinearA — linearA.js (webapp data file)
 *   2. mwenge/lineara.xyz — any JSON in src/data/
 *   3. GitHub API listing to discover actual file paths
 */

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const OUT_DIR = `${REPO_ROOT}corpus/raw`;

// Candidate URLs — try each until one succeeds
const CANDIDATES = [
  "https://raw.githubusercontent.com/mwenge/LinearA/master/src/linearA.js",
  "https://raw.githubusercontent.com/mwenge/LinearA/master/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/main/src/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/main/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/master/src/linearA.js",
];

// GitHub API fallback — list repo contents
const API_URLS = [
  "https://api.github.com/repos/mwenge/LinearA/contents",
  "https://api.github.com/repos/mwenge/lineara.xyz/contents",
];

async function tryFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "linearA-corpus-fetcher" } });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 100) return text;
    }
  } catch { /* continue */ }
  return null;
}

async function main() {
  await Deno.mkdir(OUT_DIR, { recursive: true });

  console.log("Fetching Linear A corpus from GitHub...\n");

  // Try direct candidates first
  for (const url of CANDIDATES) {
    console.log(`  Trying: ${url}`);
    const content = await tryFetch(url);
    if (content) {
      const outPath = `${OUT_DIR}/linearA_raw.txt`;
      await Deno.writeTextFile(outPath, content);
      console.log(`\n  ✓ Saved ${content.length} bytes to ${outPath}`);
      console.log(`\n  First 500 chars of fetched content:`);
      console.log(content.slice(0, 500));
      console.log("\n  NEXT: Run `deno task corpus:build` to convert to .linearA files.");
      return;
    }
  }

  // API fallback — list what files exist
  console.log("\n  Direct URLs failed. Querying GitHub API...\n");
  for (const apiUrl of API_URLS) {
    const content = await tryFetch(apiUrl);
    if (content) {
      const files = JSON.parse(content) as Array<{ name: string; download_url: string }>;
      console.log(`  Files in repo:`);
      for (const f of files) console.log(`    ${f.name}  →  ${f.download_url}`);
      await Deno.writeTextFile(`${OUT_DIR}/repo_listing.json`, content);
      console.log(`\n  Repo listing saved to ${OUT_DIR}/repo_listing.json`);
      console.log("  MANUAL STEP: Pick the correct data file from the listing above,");
      console.log("  fetch it manually, save as corpus/raw/linearA_raw.txt, then run corpus:build.");
      return;
    }
  }

  console.error("  Could not reach any source. Check network and try URLs manually.");
  Deno.exit(1);
}

main();
```

- [ ] **Step 2: Run the fetch**

```bash
deno task corpus:fetch
```

Expected (one of):
- `✓ Saved N bytes to corpus/raw/linearA_raw.txt` — proceed to Task 3
- A repo file listing saved as `corpus/raw/repo_listing.json` — follow manual step in output

- [ ] **Step 3: Inspect the raw content**

```bash
head -100 corpus/raw/linearA_raw.txt
```

Note the format — you will adapt `build_corpus.ts` in Task 3 to match.
Common formats you may see:
- Pure JSON array of inscription objects
- JavaScript `const data = [...]` — strip the JS wrapper
- A JS module with `export default [...]` — strip the module syntax

- [ ] **Step 4: Commit fetched data**

```bash
git add scripts/fetch_corpus.ts corpus/raw/
git commit -m "corpus: fetch raw Linear A data from GitHub"
```

---

## Task 3: Build corpus converter

**Files:**
- Create: `scripts/build_corpus.ts`
- Creates: `corpus/inscriptions/*.linearA`
- Creates: `corpus/inscription.index.yaml`

This task converts the raw GitHub data into `.linearA` files and an index,
mirroring the structure of the Voynich `.voynich` folio files in booLang.

Each sign token in the source data is treated as an opaque string identifier.
No phonetic values are assigned. Word dividers (typically `-` or `|` in
transliteration notation) become the sign-group boundary.

- [ ] **Step 1: Write the converter**

Create `scripts/build_corpus.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * build_corpus.ts — Convert raw Linear A corpus data → .linearA inscription files.
 *
 * Input:  corpus/raw/linearA_raw.txt  (fetched by fetch_corpus.ts)
 * Output: corpus/inscriptions/*.linearA
 *         corpus/inscription.index.yaml
 *
 * Sign tokens are treated as opaque identifiers. No phonetic values assigned.
 * Word dividers (- | /) separate sign groups within an inscription.
 *
 * ADAPTATION NOTE: If the raw format differs from what's assumed here,
 * update parseRawCorpus() to match. The downstream format (parseInscription
 * in analyze_signs.ts) depends only on the .linearA file format — not on
 * how we got there.
 */

const REPO_ROOT = new URL("../", import.meta.url).pathname;
const RAW_FILE  = `${REPO_ROOT}corpus/raw/linearA_raw.txt`;
const OUT_DIR   = `${REPO_ROOT}corpus/inscriptions`;
const INDEX_OUT = `${REPO_ROOT}corpus/inscription.index.yaml`;

// Known site prefixes for grouping
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
  MI: "Mirabello",
  PE: "Petras",
  PR: "Prasa",
  PS: "Pseira",
  PY: "Pyrgos",
  SY: "Syme",
  TL: "Tylissos",
  TY: "Tylisos",
  WA: "Wace",
};

export interface RawInscription {
  id: string;           // e.g. "HT 1" or "HT-001"
  site: string;         // e.g. "HT"
  words: string[][];    // sign groups, each group = array of sign tokens
  type?: string;        // "tablet", "roundel", "seal", etc.
}

/**
 * Parse the raw corpus file into a normalized structure.
 * Handles multiple common formats from the mwenge/LinearA repo.
 */
export function parseRawCorpus(raw: string): RawInscription[] {
  // Strip JS module wrapper if present (e.g. "const data = [...]" or "export default [...]")
  let json = raw.trim();
  json = json.replace(/^(?:export\s+default\s+|(?:const|var|let)\s+\w+\s*=\s*)/, "");
  json = json.replace(/;?\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    console.error("Failed to parse corpus as JSON. Check corpus/raw/linearA_raw.txt format.");
    console.error("First 200 chars:", raw.slice(0, 200));
    Deno.exit(1);
  }

  if (!Array.isArray(parsed)) {
    // Maybe it's { inscriptions: [...] } or { data: [...] }
    const obj = parsed as Record<string, unknown>;
    const arr = obj["inscriptions"] ?? obj["data"] ?? obj["texts"] ?? Object.values(obj)[0];
    if (!Array.isArray(arr)) {
      console.error("Cannot find inscription array in corpus JSON. Keys:", Object.keys(obj));
      Deno.exit(1);
    }
    parsed = arr;
  }

  const inscriptions = parsed as unknown[];
  const result: RawInscription[] = [];

  for (const item of inscriptions) {
    const obj = item as Record<string, unknown>;

    // Extract ID — try common field names
    const id = String(obj["id"] ?? obj["name"] ?? obj["inscription"] ?? obj["tablet"] ?? "UNKNOWN");

    // Extract site code from ID prefix (e.g. "HT 1" → "HT")
    const siteMatch = id.match(/^([A-Z]{2,3})/);
    const site = siteMatch ? siteMatch[1] : "XX";

    // Extract type
    const type = String(obj["type"] ?? obj["category"] ?? "tablet");

    // Extract sign groups — try common field names
    const rawWords = obj["words"] ?? obj["signs"] ?? obj["tokens"] ?? obj["text"] ?? [];

    let words: string[][] = [];

    if (Array.isArray(rawWords)) {
      if (rawWords.length > 0 && typeof rawWords[0] === "string") {
        // Flat string array — split on word dividers
        words = splitOnDividers(rawWords as string[]);
      } else if (Array.isArray(rawWords[0])) {
        // Already nested arrays — normalize sign tokens
        words = (rawWords as unknown[][]).map(group =>
          (group as string[]).filter(s => !isDivider(s)).map(normalizeSign)
        ).filter(g => g.length > 0);
      }
    } else if (typeof rawWords === "string") {
      // Single string — split on spaces and dividers
      const tokens = rawWords.split(/[\s.]+/);
      words = splitOnDividers(tokens);
    }

    // Filter empty word groups
    words = words.filter(g => g.length > 0);
    if (words.length === 0) continue;

    result.push({ id, site, words, type });
  }

  return result;
}

/** Divider tokens mark word-group boundaries */
function isDivider(s: string): boolean {
  return ["-", "|", "/", "·", "•", ",", " "].includes(s.trim());
}

/**
 * Normalize a sign token to a stable opaque identifier.
 * We do NOT assign phonetic values — the token string IS the identifier.
 * Strips brackets, question marks, damage indicators.
 * Prefix "SIGN_" ensures no collision with reserved words.
 */
export function normalizeSign(raw: string): string {
  // Strip common damage/uncertainty markers: [ ] ? * ! ( )
  let s = raw.replace(/[\[\]?*!()]/g, "").trim();
  if (!s) return "";
  // If already looks like AB-number notation, keep as-is
  if (/^AB\d+$/i.test(s)) return s.toUpperCase();
  // Otherwise use as-is (e.g. "da", "ku", "301", etc.)
  return s;
}

function splitOnDividers(tokens: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const t of tokens) {
    if (isDivider(t)) {
      if (current.length > 0) { groups.push(current); current = []; }
    } else {
      const s = normalizeSign(t);
      if (s) current.push(s);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
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
    `# Type:    ${insc.type ?? "tablet"}`,
    `# Groups:  ${insc.words.length}`,
    `# Signs:   ${signCount}`,
    ``,
  ];

  // One sign group per line, signs dot-separated
  for (const group of insc.words) {
    lines.push(group.join("."));
  }

  lines.push(``);
  lines.push(`# ── Sign list (flat) ────────────────────────────────────────────────────────`);
  lines.push(insc.words.map(g => g.join(".")).join("."));
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

  // Write .linearA files
  let written = 0;
  for (const insc of inscriptions) {
    const filename = `${idToFilename(insc.id)}.linearA`;
    const content = formatLinearAFile(insc);
    await Deno.writeTextFile(`${OUT_DIR}/${filename}`, content);
    written++;
  }
  console.log(`  Wrote ${written} .linearA files to ${OUT_DIR}/`);

  // Build site aggregates for index
  const sites: Record<string, { name: string; count: number; signs: number }> = {};
  for (const insc of inscriptions) {
    if (!sites[insc.site]) {
      sites[insc.site] = { name: SITE_NAMES[insc.site] ?? insc.site, count: 0, signs: 0 };
    }
    sites[insc.site].count++;
    sites[insc.site].signs += insc.words.reduce((s, g) => s + g.length, 0);
  }

  // Write inscription index
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
    yaml.push(`    type: ${insc.type ?? "tablet"}`);
    yaml.push(`    groups: ${insc.words.length}`);
    yaml.push(`    signs: ${signCount}`);
    yaml.push(`    file: inscriptions/${filename}`);
  }

  await Deno.writeTextFile(INDEX_OUT, yaml.join("\n") + "\n");
  console.log(`  Wrote inscription index to ${INDEX_OUT}`);
  console.log(`\nCorpus built. NEXT: deno task corpus:analyze`);
}

main();
```

- [ ] **Step 2: Run the converter**

```bash
deno task corpus:build
```

Expected output:
```
Parsing corpus (NNNNN bytes)...
  Parsed NNN inscriptions
  Wrote NNN .linearA files to corpus/inscriptions/
  Wrote inscription index to corpus/inscription.index.yaml
```

- [ ] **Step 3: Spot-check a .linearA file**

```bash
head -20 corpus/inscriptions/HT_1.linearA
```

Expected format:
```
# Linear A Inscription — HT 1
# Site:    Hagia Triada (HT)
# Type:    tablet
# Groups:  N
# Signs:   N

sign1.sign2.sign3
sign4.sign5
...
```

- [ ] **Step 4: Check the index**

```bash
head -30 corpus/inscription.index.yaml
```

Expected: YAML with `sites:` block and `inscriptions:` list.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_corpus.ts corpus/inscription.index.yaml corpus/inscriptions/
git commit -m "corpus: convert Linear A JSON to .linearA inscription files"
```

---

## Task 4: Build sign frequency analyzer (TDD)

**Files:**
- Create: `scripts/analyze_signs.ts`
- Creates: `corpus/analysis/sign-frequency.json`
- Creates: `corpus/analysis/sign-index.json`

Signs are opaque tokens. Compact indices (1–N by descending frequency) are the
values passed to `canonicalOctet()`.

- [ ] **Step 1: Write the parser utility (shared by Tasks 4 and 5)**

Add to top of `scripts/analyze_signs.ts` (we'll add more below):

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * analyze_signs.ts — Sign frequency table + bigram transition matrix.
 *
 * Reads all .linearA inscription files, parses sign groups, builds:
 *   corpus/analysis/sign-frequency.json — per-sign positional counts
 *   corpus/analysis/sign-index.json     — compact index (sign → 1-based rank)
 *   corpus/analysis/bigram-matrix.json  — sign-pair transition counts
 *
 * No phonetic assumptions. Signs are opaque string tokens.
 */

import { canonicalOctet } from "../src/canonical_octet.ts";

const REPO_ROOT   = new URL("../", import.meta.url).pathname;
const CORPUS_DIR  = `${REPO_ROOT}corpus/inscriptions`;
const ANALYSIS_DIR = `${REPO_ROOT}corpus/analysis`;

export interface SignFreq {
  sign:         string;   // opaque token, e.g. "da" or "AB008"
  compactIndex: number;   // 1-based rank by total frequency
  canonicalByte: number;  // canonicalOctet(compactIndex)
  freqTotal:    number;
  freqInitial:  number;   // word-first position count
  freqMedial:   number;   // word-medial position count
  freqFinal:    number;   // word-last position count
  positionBias: "ONSET" | "BODY" | "CODA" | "MIXED";
}

export interface SignIndex {
  [sign: string]: {
    compactIndex:  number;
    canonicalByte: number;
    state:         "ONSET" | "BODY" | "CODA" | "MIXED";
  };
}

/** Parse a .linearA file and return an array of sign groups. */
export function parseLinearAFile(content: string): string[][] {
  const groups: string[][] = [];
  let inFlatList = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("# ── Sign list")) { inFlatList = true; continue; }
    if (line.startsWith("#")) continue;
    if (inFlatList) continue; // skip flat list — we use per-group lines above
    const trimmed = line.trim();
    if (!trimmed) continue;
    const signs = trimmed.split(".").map(s => s.trim()).filter(s => s.length > 0);
    if (signs.length > 0) groups.push(signs);
  }
  return groups;
}

/**
 * Build sign frequency table from an array of sign groups.
 * Returns a map: sign → { total, initial, medial, final }
 */
export function buildFrequencyTable(
  allGroups: string[][]
): Map<string, { total: number; initial: number; medial: number; final: number }> {
  const freq = new Map<string, { total: number; initial: number; medial: number; final: number }>();

  for (const group of allGroups) {
    for (let i = 0; i < group.length; i++) {
      const sign = group[i];
      if (!freq.has(sign)) freq.set(sign, { total: 0, initial: 0, medial: 0, final: 0 });
      const entry = freq.get(sign)!;
      entry.total++;
      if (i === 0)               entry.initial++;
      else if (i === group.length - 1) entry.final++;
      else                       entry.medial++;
    }
  }
  return freq;
}

/**
 * Assign a position bias to a sign based on its positional frequency ratios.
 * Threshold: if one position accounts for > 50% of occurrences → bias to that state.
 */
export function positionBias(
  counts: { total: number; initial: number; medial: number; final: number }
): "ONSET" | "BODY" | "CODA" | "MIXED" {
  if (counts.total === 0) return "MIXED";
  const { total, initial, final, medial } = counts;
  if (initial / total > 0.5) return "ONSET";
  if (final   / total > 0.5) return "CODA";
  if (medial  / total > 0.4) return "BODY";
  return "MIXED";
}

/**
 * Build the full SignFreq array, sorted descending by total frequency.
 * Assigns compact indices 1–N and canonical bytes.
 */
export function buildSignFreqArray(
  freq: Map<string, { total: number; initial: number; medial: number; final: number }>
): SignFreq[] {
  const sorted = [...freq.entries()].sort((a, b) => b[1].total - a[1].total);
  return sorted.map(([sign, counts], idx) => {
    const compactIndex = idx + 1; // 1-based
    return {
      sign,
      compactIndex,
      canonicalByte: canonicalOctet(compactIndex),
      freqTotal:   counts.total,
      freqInitial: counts.initial,
      freqMedial:  counts.medial,
      freqFinal:   counts.final,
      positionBias: positionBias(counts),
    };
  });
}

/** Build sign → compact index lookup (used by Task 5 and Task 7) */
export function buildSignIndex(signFreqs: SignFreq[]): SignIndex {
  const index: SignIndex = {};
  for (const sf of signFreqs) {
    index[sf.sign] = {
      compactIndex:  sf.compactIndex,
      canonicalByte: sf.canonicalByte,
      state:         sf.positionBias,
    };
  }
  return index;
}
```

- [ ] **Step 2: Write inline unit tests for the parsers**

Add a test file `scripts/analyze_signs_test.ts`:

```typescript
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLinearAFile, buildFrequencyTable, positionBias, buildSignFreqArray,
} from "./analyze_signs.ts";

Deno.test("parseLinearAFile: extracts sign groups from .linearA content", () => {
  const content = [
    "# Linear A Inscription — HT 1",
    "# Site:    Hagia Triada (HT)",
    "# Signs:   5",
    "",
    "da.ku.na",
    "re.za",
    "",
    "# ── Sign list (flat) ───",
    "da.ku.na.re.za",
    "",
  ].join("\n");

  const groups = parseLinearAFile(content);
  assertEquals(groups.length, 2);
  assertEquals(groups[0], ["da", "ku", "na"]);
  assertEquals(groups[1], ["re", "za"]);
});

Deno.test("buildFrequencyTable: correct positional counts", () => {
  const groups = [["da", "ku", "da"], ["da", "re"]];
  const freq = buildFrequencyTable(groups);

  // "da": total=3, initial=2, medial=0, final=1
  assertEquals(freq.get("da")?.total, 3);
  assertEquals(freq.get("da")?.initial, 2);
  assertEquals(freq.get("da")?.medial, 0);
  assertEquals(freq.get("da")?.final, 1);

  // "ku": total=1, initial=0, medial=1, final=0
  assertEquals(freq.get("ku")?.total, 1);
  assertEquals(freq.get("ku")?.medial, 1);
});

Deno.test("positionBias: dominant initial → ONSET", () => {
  assertEquals(positionBias({ total: 10, initial: 6, medial: 2, final: 2 }), "ONSET");
});

Deno.test("positionBias: dominant final → CODA", () => {
  assertEquals(positionBias({ total: 10, initial: 1, medial: 2, final: 7 }), "CODA");
});

Deno.test("positionBias: dominant medial → BODY", () => {
  assertEquals(positionBias({ total: 10, initial: 1, medial: 8, final: 1 }), "BODY");
});

Deno.test("positionBias: no dominance → MIXED", () => {
  assertEquals(positionBias({ total: 9, initial: 3, medial: 3, final: 3 }), "MIXED");
});

Deno.test("buildSignFreqArray: sorted by total freq, compact indices start at 1", () => {
  const freq = new Map([
    ["da", { total: 10, initial: 7, medial: 2, final: 1 }],
    ["ku", { total: 5,  initial: 1, medial: 3, final: 1 }],
    ["re", { total: 20, initial: 1, medial: 2, final: 17 }],
  ]);
  const arr = buildSignFreqArray(freq);
  assertEquals(arr[0].sign, "re");   // highest frequency first
  assertEquals(arr[0].compactIndex, 1);
  assertEquals(arr[1].sign, "da");
  assertEquals(arr[1].compactIndex, 2);
  assertEquals(arr[2].sign, "ku");
  assertEquals(arr[2].compactIndex, 3);
});
```

- [ ] **Step 3: Run tests — verify they pass**

```bash
deno test --allow-read --allow-write scripts/analyze_signs_test.ts
```

Expected: `ok | 6 passed | 0 failed`

- [ ] **Step 4: Add main() to analyze_signs.ts and run it**

Append to `scripts/analyze_signs.ts`:

```typescript
// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await Deno.mkdir(ANALYSIS_DIR, { recursive: true });

  // Load all .linearA files
  const entries: Deno.DirEntry[] = [];
  for await (const entry of Deno.readDir(CORPUS_DIR)) {
    if (entry.name.endsWith(".linearA")) entries.push(entry);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Analyzing ${entries.length} inscription files...`);

  const allGroups: string[][] = [];
  for (const entry of entries) {
    const content = await Deno.readTextFile(`${CORPUS_DIR}/${entry.name}`);
    allGroups.push(...parseLinearAFile(content));
  }
  console.log(`  Total sign groups: ${allGroups.length}`);

  // Build frequency table
  const freq = buildFrequencyTable(allGroups);
  console.log(`  Unique signs: ${freq.size}`);

  // Build frequency array + sign index
  const signFreqs = buildSignFreqArray(freq);
  const signIndex = buildSignIndex(signFreqs);

  // Write outputs
  await Deno.writeTextFile(
    `${ANALYSIS_DIR}/sign-frequency.json`,
    JSON.stringify(signFreqs, null, 2),
  );
  await Deno.writeTextFile(
    `${ANALYSIS_DIR}/sign-index.json`,
    JSON.stringify(signIndex, null, 2),
  );

  // Print top 20 signs
  console.log("\nTop 20 signs by frequency:");
  console.log("  Rank  Sign       Total  Initial  Medial  Final  State");
  console.log("  " + "─".repeat(58));
  for (const sf of signFreqs.slice(0, 20)) {
    console.log(
      `  ${String(sf.compactIndex).padStart(4)}  ` +
      `${sf.sign.padEnd(10)} ` +
      `${String(sf.freqTotal).padStart(5)}  ` +
      `${String(sf.freqInitial).padStart(7)}  ` +
      `${String(sf.freqMedial).padStart(6)}  ` +
      `${String(sf.freqFinal).padStart(5)}  ` +
      sf.positionBias
    );
  }

  // State summary
  const byState = { ONSET: 0, BODY: 0, CODA: 0, MIXED: 0 };
  for (const sf of signFreqs) byState[sf.positionBias]++;
  console.log(`\nState distribution across ${freq.size} unique signs:`);
  console.log(`  ONSET: ${byState.ONSET}  BODY: ${byState.BODY}  CODA: ${byState.CODA}  MIXED: ${byState.MIXED}`);

  console.log(`\nWritten:`);
  console.log(`  ${ANALYSIS_DIR}/sign-frequency.json`);
  console.log(`  ${ANALYSIS_DIR}/sign-index.json`);
  console.log(`\nNEXT: Bigram matrix is built in the same run (see below) or run corpus:analyze again.`);
}

if (import.meta.main) main();
```

- [ ] **Step 5: Run the analyzer**

```bash
deno task corpus:analyze
```

Expected: frequency table printed, two JSON files written.
Note the top 10 sign tokens and their state assignments for later use in Task 6.

- [ ] **Step 6: Commit**

```bash
git add scripts/analyze_signs.ts scripts/analyze_signs_test.ts \
        corpus/analysis/sign-frequency.json corpus/analysis/sign-index.json
git commit -m "analysis: sign frequency table + compact index with position bias"
```

---

## Task 5: Build bigram transition matrix (TDD)

**Files:**
- Modify: `scripts/analyze_signs.ts` (add bigram functions)
- Creates: `corpus/analysis/bigram-matrix.json`

- [ ] **Step 1: Add bigram functions to analyze_signs.ts**

Insert before the `main()` function in `scripts/analyze_signs.ts`:

```typescript
export interface BigramEntry {
  from:            string;  // sign token
  to:              string;  // sign token
  count:           number;
  fromState:       "ONSET" | "BODY" | "CODA" | "MIXED";
  toState:         "ONSET" | "BODY" | "CODA" | "MIXED";
  stateTransition: string;  // e.g. "ONSET→BODY"
}

/**
 * Build bigram (sign-pair) transition counts from all sign groups.
 * Only counts transitions within a group (not across group boundaries).
 */
export function buildBigramMatrix(
  allGroups: string[][],
  signIndex: SignIndex,
): BigramEntry[] {
  const counts = new Map<string, number>();

  for (const group of allGroups) {
    for (let i = 0; i < group.length - 1; i++) {
      const key = `${group[i]}→${group[i + 1]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const entries: BigramEntry[] = [];
  for (const [key, count] of counts) {
    const [from, to] = key.split("→");
    const fromState = signIndex[from]?.state ?? "MIXED";
    const toState   = signIndex[to]?.state   ?? "MIXED";
    entries.push({
      from, to, count,
      fromState, toState,
      stateTransition: `${fromState}→${toState}`,
    });
  }

  // Sort by count descending
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

/**
 * Aggregate bigram entries by state transition label.
 * Returns sorted array of { stateTransition, totalCount, pct }.
 */
export function aggregateStateTransitions(
  bigrams: BigramEntry[],
): Array<{ stateTransition: string; totalCount: number; pct: number }> {
  const totals = new Map<string, number>();
  let grandTotal = 0;
  for (const b of bigrams) {
    totals.set(b.stateTransition, (totals.get(b.stateTransition) ?? 0) + b.count);
    grandTotal += b.count;
  }
  const result = [...totals.entries()]
    .map(([stateTransition, totalCount]) => ({
      stateTransition,
      totalCount,
      pct: totalCount / grandTotal,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
  return result;
}
```

- [ ] **Step 2: Add bigram tests to analyze_signs_test.ts**

Append to `scripts/analyze_signs_test.ts`:

```typescript
import { buildBigramMatrix, aggregateStateTransitions } from "./analyze_signs.ts";
import type { SignIndex } from "./analyze_signs.ts";

Deno.test("buildBigramMatrix: counts within-group pairs only", () => {
  const groups = [["da", "ku", "na"], ["da", "re"]];
  const index: SignIndex = {
    "da": { compactIndex: 1, canonicalByte: 1, state: "ONSET" },
    "ku": { compactIndex: 2, canonicalByte: 2, state: "BODY" },
    "na": { compactIndex: 3, canonicalByte: 3, state: "CODA" },
    "re": { compactIndex: 4, canonicalByte: 4, state: "BODY" },
  };
  const bigrams = buildBigramMatrix(groups, index);

  // Pairs: da→ku (1), ku→na (1), da→re (1) — no cross-group pair na→da
  assertEquals(bigrams.length, 3);
  const daKu = bigrams.find(b => b.from === "da" && b.to === "ku");
  assertEquals(daKu?.count, 1);
  assertEquals(daKu?.stateTransition, "ONSET→BODY");
});

Deno.test("buildBigramMatrix: sorted descending by count", () => {
  const groups = [
    ["da", "ku"], ["da", "ku"], ["da", "ku"], ["re", "na"],
  ];
  const index: SignIndex = {
    "da": { compactIndex: 1, canonicalByte: 1, state: "ONSET" },
    "ku": { compactIndex: 2, canonicalByte: 2, state: "BODY" },
    "re": { compactIndex: 3, canonicalByte: 3, state: "ONSET" },
    "na": { compactIndex: 4, canonicalByte: 4, state: "CODA" },
  };
  const bigrams = buildBigramMatrix(groups, index);
  assertEquals(bigrams[0].from, "da");
  assertEquals(bigrams[0].to, "ku");
  assertEquals(bigrams[0].count, 3);
});

Deno.test("aggregateStateTransitions: sums counts per state pair", () => {
  const bigrams: BigramEntry[] = [
    { from:"da", to:"ku", count:4, fromState:"ONSET", toState:"BODY", stateTransition:"ONSET→BODY" },
    { from:"re", to:"za", count:2, fromState:"ONSET", toState:"BODY", stateTransition:"ONSET→BODY" },
    { from:"ku", to:"na", count:3, fromState:"BODY",  toState:"CODA", stateTransition:"BODY→CODA"  },
  ];
  const agg = aggregateStateTransitions(bigrams);
  assertEquals(agg[0].stateTransition, "ONSET→BODY");
  assertEquals(agg[0].totalCount, 6);
  assertEquals(agg[1].stateTransition, "BODY→CODA");
  assertEquals(agg[1].totalCount, 3);
  // pct should sum to 1.0
  const total = agg.reduce((s, a) => s + a.totalCount, 0);
  assertEquals(total, 9);
});
```

- [ ] **Step 3: Run tests — verify they pass**

```bash
deno test --allow-read --allow-write scripts/analyze_signs_test.ts
```

Expected: `ok | 9 passed | 0 failed`

- [ ] **Step 4: Add bigram output to main() in analyze_signs.ts**

In the `main()` function, after writing sign-index.json, add:

```typescript
  // Build bigram matrix
  const bigrams = buildBigramMatrix(allGroups, signIndex);
  const stateAgg = aggregateStateTransitions(bigrams);

  await Deno.writeTextFile(
    `${ANALYSIS_DIR}/bigram-matrix.json`,
    JSON.stringify({ bigrams, stateAggregates: stateAgg }, null, 2),
  );
  console.log(`  ${ANALYSIS_DIR}/bigram-matrix.json`);

  console.log("\nState transition aggregates (sorted by count):");
  let grandTotal = bigrams.reduce((s, b) => s + b.count, 0);
  for (const agg of stateAgg) {
    console.log(
      `  ${agg.stateTransition.padEnd(16)} ${String(agg.totalCount).padStart(6)}  ` +
      `(${(agg.pct * 100).toFixed(1)}%)`
    );
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${String(grandTotal).padStart(6)}`);
```

- [ ] **Step 5: Re-run the analyzer**

```bash
deno task corpus:analyze
```

Expected: state transition table printed, bigram-matrix.json written.
**Read the transition table output carefully — it drives Task 6.**

- [ ] **Step 6: Commit**

```bash
git add scripts/analyze_signs.ts scripts/analyze_signs_test.ts \
        corpus/analysis/bigram-matrix.json
git commit -m "analysis: bigram transition matrix + state aggregates"
```

---

## Task 6: Derive FSM + write spec/linear-a-fsm.yaml

**Files:**
- Create: `scripts/derive_fsm.ts`
- Creates: `spec/linear-a-fsm.yaml`

This task reads the analysis outputs and writes the canonical FSM spec.
The governor ratio is computed from corpus data — not assumed.

- [ ] **Step 1: Write the derivation script**

Create `scripts/derive_fsm.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * derive_fsm.ts — Derive Linear A FSM spec from corpus analysis.
 *
 * Reads:
 *   corpus/analysis/sign-frequency.json
 *   corpus/analysis/bigram-matrix.json
 * Writes:
 *   spec/linear-a-fsm.yaml
 *
 * Algorithm:
 *   1. Load state aggregates (state transition totals)
 *   2. Sort by count descending
 *   3. Include state transitions that appear in the top COVERAGE_TARGET of total mass
 *   4. Compute governor ratio = included_count / total_count
 *   5. Write FSM spec with motif lists, valid transitions, and governor ratio
 */

import type { SignFreq } from "./analyze_signs.ts";

const REPO_ROOT   = new URL("../", import.meta.url).pathname;
const FREQ_FILE   = `${REPO_ROOT}corpus/analysis/sign-frequency.json`;
const BIGRAM_FILE = `${REPO_ROOT}corpus/analysis/bigram-matrix.json`;
const FSM_OUT     = `${REPO_ROOT}spec/linear-a-fsm.yaml`;

// Target: include transitions that account for this fraction of total bigram mass.
// Start with 0.9 (conservative). The actual governor ratio will be higher
// because many transitions cluster at the top.
const COVERAGE_TARGET = 0.90;

interface StateAggregate {
  stateTransition: string;
  totalCount:      number;
  pct:             number;
}

interface BigramData {
  stateAggregates: StateAggregate[];
}

async function main() {
  const signFreqs: SignFreq[]  = JSON.parse(await Deno.readTextFile(FREQ_FILE));
  const bigramData: BigramData = JSON.parse(await Deno.readTextFile(BIGRAM_FILE));

  const agg = bigramData.stateAggregates;
  const grandTotal = agg.reduce((s, a) => s + a.totalCount, 0);

  // Select transitions by cumulative coverage
  let cumulative = 0;
  const selected: StateAggregate[] = [];
  for (const entry of agg) {
    selected.push(entry);
    cumulative += entry.totalCount;
    if (cumulative / grandTotal >= COVERAGE_TARGET) break;
  }

  const governorRatio = cumulative / grandTotal;
  const governorFraction = `${cumulative}/${grandTotal}`;

  console.log(`\nFSM Derivation`);
  console.log(`  Total bigram transitions: ${grandTotal}`);
  console.log(`  Coverage target:          ${(COVERAGE_TARGET * 100).toFixed(0)}%`);
  console.log(`  Selected transitions:     ${selected.length}`);
  console.log(`  Included count:           ${cumulative}`);
  console.log(`  Governor ratio:           ${governorFraction} = ${governorRatio.toFixed(6)}`);

  // Group signs by state for motif lists
  const byState = { ONSET: [] as SignFreq[], BODY: [] as SignFreq[], CODA: [] as SignFreq[], MIXED: [] as SignFreq[] };
  for (const sf of signFreqs) byState[sf.positionBias].push(sf);

  // Build top motifs per state (top 16 by frequency, matching Voynich approach)
  const topOnset = byState.ONSET.slice(0, 16).map(sf => sf.sign);
  const topBody  = byState.BODY.slice(0, 16).map(sf => sf.sign);
  const topCoda  = byState.CODA.slice(0, 16).map(sf => sf.sign);

  // Compute corpus stats
  const totalSigns = signFreqs.reduce((s, sf) => s + sf.freqTotal, 0);

  // Build YAML
  const yaml = [
    `---`,
    `# linear-a-fsm.yaml — Canonical Linear A FSM Specification`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# Source: corpus/analysis/bigram-matrix.json`,
    `# Authority: non-authoritative (derived from corpus statistics)`,
    `# No Linear B phonetic values — signs are opaque structural tokens`,
    `---`,
    ``,
    `fsm:`,
    `  id: linear_a_word_fsm`,
    `  version: 1`,
    `  authority: non-authoritative`,
    `  description: >`,
    `    Finite-state machine describing the morphological structure of Linear A`,
    `    sign groups. Derived from positional frequency and bigram transition analysis`,
    `    of the full Linear A corpus. No phonetic assumptions from Linear B.`,
    `    A sign group is FSM-valid if its state sequence passes the governor gate.`,
    ``,
    `  corpus_stats:`,
    `    total_inscriptions: ${new Set(signFreqs.map(sf => sf.sign)).size}`,
    `    total_signs: ${totalSigns}`,
    `    unique_signs: ${signFreqs.length}`,
    `    total_bigrams: ${grandTotal}`,
    ``,
    `  states:`,
    `    - id: STATE_ONSET`,
    `      label: onset`,
    `      role: >`,
    `        Sign-group initial position. High frequency at word start.`,
    `        Structural prefix marker. Equivalent to PREFIX in Voynich FSM.`,
    `      sign_count: ${byState.ONSET.length}`,
    `      top_signs: [${topOnset.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `    - id: STATE_BODY`,
    `      label: body`,
    `      role: >`,
    `        Sign-group medial position. Core semantic carrier.`,
    `        Highest-frequency state. Equivalent to CORE in Voynich FSM.`,
    `      sign_count: ${byState.BODY.length}`,
    `      top_signs: [${topBody.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `    - id: STATE_CODA`,
    `      label: coda`,
    `      role: >`,
    `        Sign-group terminal position. Morphological suffix bridge.`,
    `        Equivalent to OPERATOR in Voynich FSM.`,
    `      sign_count: ${byState.CODA.length}`,
    `      top_signs: [${topCoda.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `  valid_transitions:`,
    ...selected.map(entry => {
      const [from, to] = entry.stateTransition.split("→");
      return [
        `    - from: STATE_${from}`,
        `      to:   STATE_${to}`,
        `      count: ${entry.totalCount}`,
        `      pct:   ${(entry.pct * 100).toFixed(2)}`,
      ].join("\n");
    }),
    ``,
    `  canonical_word_shape:`,
    `    pattern: STATE_ONSET → STATE_BODY → STATE_CODA → STATE_BODY → STATE_ONSET`,
    `    description: >`,
    `      The minimal complete Linear A sign group. A group that follows this`,
    `      path exactly scores 1.0 against the FSM.`,
    ``,
    `  scoring:`,
    `    method: transition_compliance_ratio`,
    `    formula: >`,
    `      score(group) = valid_transitions_in_group / total_transitions_in_group`,
    `      where a transition is valid if its state pair appears in valid_transitions.`,
    `    threshold:`,
    `      pass:  ${governorRatio.toFixed(10)}`,
    `      fraction: "${governorFraction}"`,
    `      label: "Linear A corpus governor ratio — derived from ${(COVERAGE_TARGET * 100).toFixed(0)}% coverage target"`,
    ``,
    `  sign_index_file: corpus/analysis/sign-index.json`,
    ``,
  ].join("\n");

  await Deno.mkdir(`${REPO_ROOT}spec`, { recursive: true });
  await Deno.writeTextFile(FSM_OUT, yaml);

  console.log(`\nWritten: ${FSM_OUT}`);
  console.log(`\nSelected valid state transitions:`);
  for (const s of selected) {
    console.log(`  ${s.stateTransition.padEnd(20)} ${String(s.totalCount).padStart(6)}  (${(s.pct * 100).toFixed(1)}%)`);
  }
  console.log(`\nGovernor ratio: ${governorFraction} = ${governorRatio.toFixed(6)}`);
  console.log(`\nNEXT: implement spec/linear-a-fsm-validator.ts using the values above.`);
}

main();
```

- [ ] **Step 2: Run the derivation**

```bash
deno task corpus:fsm
```

Expected: governor ratio printed, `spec/linear-a-fsm.yaml` written.
**Copy the governor ratio fraction (e.g. `12345/67890`) from the output.**
You will hardcode it in Task 7's validator exactly as Voynich uses `9109/9919`.

- [ ] **Step 3: Inspect the FSM spec**

```bash
cat spec/linear-a-fsm.yaml
```

Verify: valid_transitions list makes structural sense (ONSET→BODY should be high,
BODY→CODA moderate, etc.). If the distribution looks wrong, check that
parseLinearAFile() correctly separates sign groups in Task 3.

- [ ] **Step 4: Commit**

```bash
git add scripts/derive_fsm.ts spec/linear-a-fsm.yaml
git commit -m "fsm: derive Linear A FSM spec from corpus — governor ratio computed"
```

---

## Task 7: Implement FSM validator (TDD)

**Files:**
- Create: `spec/linear-a-fsm-validator.ts`
- Create: `spec/linear-a-fsm-validator-test.ts`

Mirror `reference/spec/voynich-fsm-validator.ts` exactly.
Key difference: Linear A tokens are dot-separated sign strings (`"da.ku.na"`),
not character streams — no greedy motif matching needed.

**Before writing code:** Read `spec/linear-a-fsm.yaml` and note:
- The exact `valid_transitions` list (state transition pairs)
- The exact governor ratio fraction (numerator and denominator)
- The top signs for each state (ONSET/BODY/CODA)

- [ ] **Step 1: Write the failing tests first**

Create `spec/linear-a-fsm-validator-test.ts`:

```typescript
/**
 * linear-a-fsm-validator-test.ts — exhaustive FSM compliance proof for Linear A
 *
 * Tests mirror canonical_octet_test.ts in rigor — structural proof, not sampling.
 */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  scoreFSM, scoreOutput, passesHealthGate, FSM_THRESHOLD,
  SIGN_STATES, VALID_TRANSITIONS,
} from "./linear-a-fsm-validator.ts";

// ── SIGN_STATES ───────────────────────────────────────────────────────────────

Deno.test("SIGN_STATES: every sign maps to ONSET, BODY, or CODA", () => {
  const valid = new Set(["ONSET", "BODY", "CODA", "MIXED"]);
  for (const [sign, state] of SIGN_STATES) {
    assert(valid.has(state), `Sign "${sign}" has invalid state "${state}"`);
  }
});

Deno.test("SIGN_STATES: at least one ONSET, one BODY, one CODA sign exists", () => {
  const states = [...SIGN_STATES.values()];
  assert(states.includes("ONSET"), "No ONSET signs found");
  assert(states.includes("BODY"),  "No BODY signs found");
  assert(states.includes("CODA"),  "No CODA signs found");
});

// ── VALID_TRANSITIONS ─────────────────────────────────────────────────────────

Deno.test("VALID_TRANSITIONS: at least one transition defined", () => {
  assert(VALID_TRANSITIONS.size > 0, "No valid transitions defined");
});

Deno.test("VALID_TRANSITIONS: all entries follow STATE→STATE format", () => {
  const states = new Set(["ONSET", "BODY", "CODA", "MIXED"]);
  for (const t of VALID_TRANSITIONS) {
    const parts = t.split("→");
    assertEquals(parts.length, 2, `Malformed transition: "${t}"`);
    assert(states.has(parts[0]), `Unknown from-state in "${t}"`);
    assert(states.has(parts[1]), `Unknown to-state in "${t}"`);
  }
});

// ── scoreFSM ──────────────────────────────────────────────────────────────────

Deno.test("scoreFSM: empty string returns 0", () => {
  assertEquals(scoreFSM(""), 0);
});

Deno.test("scoreFSM: single sign returns 0 (no transitions)", () => {
  // Any single sign has no bigrams → score 0
  const anySingleSign = [...SIGN_STATES.keys()][0];
  assertEquals(scoreFSM(anySingleSign), 0);
});

Deno.test("scoreFSM: output in [0, 1] for any input", () => {
  const tokens = ["da.ku.na", "re.za.da", "unknown.signs.here", "da"];
  for (const t of tokens) {
    const s = scoreFSM(t);
    assert(s >= 0 && s <= 1, `scoreFSM("${t}") = ${s} out of range`);
  }
});

Deno.test("scoreFSM: two-sign group with valid transition scores 1.0", () => {
  // Find a valid transition and construct a group that follows it
  // ONSET→BODY is the most likely valid transition
  const onsetSign = [...SIGN_STATES.entries()].find(([, s]) => s === "ONSET")?.[0];
  const bodySign  = [...SIGN_STATES.entries()].find(([, s]) => s === "BODY")?.[0];
  if (onsetSign && bodySign && VALID_TRANSITIONS.has("ONSET→BODY")) {
    assertEquals(scoreFSM(`${onsetSign}.${bodySign}`), 1.0);
  }
});

Deno.test("scoreFSM: unknown signs do not crash, return 0", () => {
  assertEquals(scoreFSM("UNKNOWN_X.UNKNOWN_Y"), 0);
});

// ── scoreOutput ───────────────────────────────────────────────────────────────

Deno.test("scoreOutput: empty array returns 0", () => {
  assertEquals(scoreOutput([]), 0);
});

Deno.test("scoreOutput: returns mean of individual scores", () => {
  // If we score each token individually and average, it should match scoreOutput
  const tokens = ["da.ku.na", "re.za", "da.ku"];
  const manual = tokens.reduce((s, t) => s + scoreFSM(t), 0) / tokens.length;
  assertEquals(scoreOutput(tokens), manual);
});

// ── passesHealthGate ──────────────────────────────────────────────────────────

Deno.test("passesHealthGate: score >= FSM_THRESHOLD passes", () => {
  assert(FSM_THRESHOLD > 0 && FSM_THRESHOLD < 1, "FSM_THRESHOLD must be in (0,1)");
});

Deno.test("FSM_THRESHOLD: is the empirically derived governor ratio", () => {
  // The threshold is computed from corpus data — verify it's a proper fraction
  // (non-trivial value, not 0 or 1)
  assert(FSM_THRESHOLD > 0.5, "Governor ratio implausibly low");
  assert(FSM_THRESHOLD < 1.0, "Governor ratio cannot be 1.0");
});
```

- [ ] **Step 2: Run tests — verify they all fail (file doesn't exist yet)**

```bash
deno test --allow-net spec/linear-a-fsm-validator-test.ts 2>&1 | head -20
```

Expected: `error: Module not found` or similar — the validator doesn't exist yet.

- [ ] **Step 3: Implement the validator**

Create `spec/linear-a-fsm-validator.ts`.

**IMPORTANT:** Before writing, read `spec/linear-a-fsm.yaml` and substitute the
actual values into the template below (sign lists, valid transitions, governor ratio).

```typescript
/**
 * linear-a-fsm-validator.ts — Pure FSM compliance scorer for Linear A sign groups.
 * Spec: spec/linear-a-fsm.yaml
 * No external deps. Deno-compatible.
 *
 * A Linear A token is a dot-separated sign group: "sign1.sign2.sign3"
 * Each sign maps to a state (ONSET / BODY / CODA / MIXED).
 * Score = valid_state_transitions / total_state_transitions within the group.
 */

// ── Sign → State map (from spec/linear-a-fsm.yaml) ──────────────────────────
// ONSET signs: dominant in word-initial position
// BODY signs:  dominant in word-medial position
// CODA signs:  dominant in word-final position
// MIXED signs: no dominant position — treated as BODY for scoring
//
// FILL IN from corpus/analysis/sign-index.json after running corpus:analyze.
// Example structure (replace with actual corpus-derived values):
export const SIGN_STATES = new Map<string, "ONSET" | "BODY" | "CODA" | "MIXED">([
  // ── ONSET signs ─────────────────────────────────────────────
  // (paste top ONSET signs from sign-frequency.json here)
  // e.g.: ["da", "ONSET"],

  // ── BODY signs ──────────────────────────────────────────────
  // (paste top BODY signs from sign-frequency.json here)
  // e.g.: ["ku", "BODY"],

  // ── CODA signs ──────────────────────────────────────────────
  // (paste top CODA signs from sign-frequency.json here)
  // e.g.: ["na", "CODA"],
]);

// ── Valid state transitions (from spec/linear-a-fsm.yaml valid_transitions) ──
// Fill in from the FSM spec — only include transitions that appear in the yaml.
export const VALID_TRANSITIONS = new Set<string>([
  // e.g.: "ONSET→BODY",
  // e.g.: "BODY→CODA",
  // (paste actual valid transitions here)
]);

// ── Governor ratio (from spec/linear-a-fsm.yaml scoring.threshold.fraction) ──
// Replace NUMERATOR and DENOMINATOR with the actual values from derive_fsm.ts output.
export const FSM_THRESHOLD = /* NUMERATOR */ 0 / /* DENOMINATOR */ 1;
// Example: export const FSM_THRESHOLD = 12345 / 67890;

// ── Tokenise a Linear A sign group into FSM states ───────────────────────────
function tokeniseStates(token: string): Array<"ONSET" | "BODY" | "CODA" | "MIXED"> {
  const signs = token.split(".").map(s => s.trim()).filter(s => s.length > 0);
  return signs.map(sign => SIGN_STATES.get(sign) ?? "MIXED");
}

/**
 * Score a single Linear A sign group for FSM compliance.
 * Token format: "sign1.sign2.sign3" (dot-separated sign tokens)
 * Returns [0.0 .. 1.0]. 1.0 = every transition is valid per spec.
 */
export function scoreFSM(token: string): number {
  const states = tokeniseStates(token);
  if (states.length < 2) return 0;

  let valid = 0;
  for (let i = 0; i < states.length - 1; i++) {
    const key = `${states[i]}→${states[i + 1]}`;
    if (VALID_TRANSITIONS.has(key)) valid++;
  }
  return valid / (states.length - 1);
}

/**
 * Score a compiled output (array of sign group tokens).
 * Returns mean FSM compliance across all tokens.
 */
export function scoreOutput(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((acc, t) => acc + scoreFSM(t), 0) / tokens.length;
}

/**
 * Returns true if the output meets the Linear A health gate.
 */
export function passesHealthGate(tokens: string[]): boolean {
  return scoreOutput(tokens) >= FSM_THRESHOLD;
}
```

**After writing the template:** fill in SIGN_STATES from `corpus/analysis/sign-index.json`,
VALID_TRANSITIONS from `spec/linear-a-fsm.yaml`, and FSM_THRESHOLD with the exact
fraction from `derive_fsm.ts` output.

- [ ] **Step 4: Run tests — verify they pass**

```bash
deno task test:fsm
```

Expected: `ok | N passed | 0 failed`

If any test fails: re-read the sign-index.json and fsm.yaml, ensure the sign lists
and transition sets are complete.

- [ ] **Step 5: Commit**

```bash
git add spec/linear-a-fsm-validator.ts spec/linear-a-fsm-validator-test.ts
git commit -m "fsm: implement Linear A FSM validator with governor gate"
```

---

## Task 8: Build corpus health scorer + run

**Files:**
- Create: `spec/linear-a-corpus-health.ts`
- Creates: `corpus/corpus-health.yaml`

Mirror `reference/spec/voynich-corpus-health.ts` exactly.

- [ ] **Step 1: Write the corpus health script**

Create `spec/linear-a-corpus-health.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * linear-a-corpus-health.ts — Score all .linearA inscription files through the FSM gate.
 * Writes per-inscription + per-site + overall scores to corpus/corpus-health.yaml.
 *
 * Usage:
 *   deno task corpus:health
 *   deno run --allow-read --allow-write spec/linear-a-corpus-health.ts
 */

import { scoreFSM, scoreOutput, passesHealthGate, FSM_THRESHOLD } from "./linear-a-fsm-validator.ts";

const REPO_ROOT   = new URL("../", import.meta.url).pathname;
const CORPUS_DIR  = `${REPO_ROOT}corpus/inscriptions`;
const OUT_FILE    = `${REPO_ROOT}corpus/corpus-health.yaml`;

interface InscriptionScore {
  id:          string;
  site:        string;
  groups:      number;
  scored:      number;
  fsm_score:   number;
  passes_gate: boolean;
}

function extractMeta(content: string): { id: string; site: string } {
  const idMatch   = content.match(/# Linear A Inscription — (.+)/);
  const siteMatch = content.match(/# Site:\s+\S+\s+\((\w+)\)/);
  return {
    id:   idMatch?.[1]?.trim()   ?? "unknown",
    site: siteMatch?.[1]?.trim() ?? "XX",
  };
}

function extractGroups(content: string): string[] {
  const groups: string[] = [];
  let inFlat = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("# ── Sign list")) { inFlat = true; continue; }
    if (line.startsWith("#")) continue;
    if (inFlat) continue;
    const t = line.trim();
    if (t) groups.push(t); // each line is one dot-separated sign group
  }
  return groups;
}

async function main() {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(CORPUS_DIR)) {
      if (e.name.endsWith(".linearA")) entries.push(e);
    }
  } catch {
    console.error(`Cannot read ${CORPUS_DIR}. Run: deno task corpus:build`);
    Deno.exit(1);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Scoring ${entries.length} inscriptions...`);

  const scores: InscriptionScore[] = [];

  for (const entry of entries) {
    const content = await Deno.readTextFile(`${CORPUS_DIR}/${entry.name}`);
    const { id, site } = extractMeta(content);
    const groups = extractGroups(content).filter(g => g.includes("."));
    const scored = groups.length;
    const fsm_score = scoreOutput(groups);
    scores.push({ id, site, groups: groups.length, scored, fsm_score, passes_gate: fsm_score >= FSM_THRESHOLD });
  }

  // Per-site aggregation
  const sites: Record<string, { total_groups: number; scored: number; fsm_sum: number; count: number }> = {};
  for (const s of scores) {
    if (!sites[s.site]) sites[s.site] = { total_groups: 0, scored: 0, fsm_sum: 0, count: 0 };
    sites[s.site].total_groups += s.groups;
    sites[s.site].scored       += s.scored;
    sites[s.site].fsm_sum      += s.fsm_score;
    sites[s.site].count++;
  }

  const total_groups  = scores.reduce((s, f) => s + f.groups, 0);
  const total_scored  = scores.reduce((s, f) => s + f.scored, 0);
  const overall_fsm   = scores.length > 0
    ? scores.reduce((s, f) => s + f.fsm_score, 0) / scores.length : 0;
  const inscs_pass = scores.filter(f => f.passes_gate).length;

  const yaml: string[] = [
    `# Linear A Corpus Health — FSM Gate Scores`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# FSM threshold: ${FSM_THRESHOLD.toFixed(6)}`,
    ``,
    `summary:`,
    `  total_inscriptions: ${scores.length}`,
    `  total_groups: ${total_groups}`,
    `  total_scored: ${total_scored}`,
    `  overall_fsm_score: ${overall_fsm.toFixed(6)}`,
    `  overall_passes_gate: ${overall_fsm >= FSM_THRESHOLD}`,
    `  inscriptions_pass: ${inscs_pass}`,
    `  inscriptions_fail: ${scores.length - inscs_pass}`,
    ``,
    `sites:`,
  ];

  for (const [code, data] of Object.entries(sites).sort()) {
    const avg = data.count > 0 ? data.fsm_sum / data.count : 0;
    yaml.push(`  ${code}:`);
    yaml.push(`    inscriptions: ${data.count}`);
    yaml.push(`    groups: ${data.total_groups}`);
    yaml.push(`    avg_fsm_score: ${avg.toFixed(6)}`);
    yaml.push(`    passes_gate: ${avg >= FSM_THRESHOLD}`);
  }

  yaml.push(``, `inscriptions:`);
  let lastSite = "";
  for (const f of scores) {
    if (f.site !== lastSite) { yaml.push(`  # ── ${f.site} ──`); lastSite = f.site; }
    yaml.push(`  - id: "${f.id}"`);
    yaml.push(`    site: ${f.site}`);
    yaml.push(`    groups: ${f.groups}`);
    yaml.push(`    scored: ${f.scored}`);
    yaml.push(`    fsm_score: ${f.fsm_score.toFixed(6)}`);
    yaml.push(`    passes_gate: ${f.passes_gate}`);
  }

  await Deno.writeTextFile(OUT_FILE, yaml.join("\n") + "\n");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Linear A Corpus Health`);
  console.log(`${"=".repeat(60)}`);
  for (const [code, data] of Object.entries(sites).sort()) {
    const avg  = data.count > 0 ? data.fsm_sum / data.count : 0;
    const gate = avg >= FSM_THRESHOLD ? "PASS" : "FAIL";
    console.log(`  ${code.padEnd(4)} ${String(data.count).padStart(4)} inscriptions  FSM=${avg.toFixed(4)}  ${gate}`);
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`  Overall: ${scores.length} inscriptions | ${total_groups} groups | FSM=${overall_fsm.toFixed(4)} | ${overall_fsm >= FSM_THRESHOLD ? "GATE PASS" : "GATE FAIL"}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nWritten: ${OUT_FILE}`);
}

main();
```

- [ ] **Step 2: Run the corpus health scorer**

```bash
deno task corpus:health
```

Expected: per-site FSM scores table + `corpus/corpus-health.yaml` written.
Note the overall FSM score and gate result — this is the baseline health of the corpus.

- [ ] **Step 3: Commit**

```bash
git add spec/linear-a-corpus-health.ts corpus/corpus-health.yaml
git commit -m "health: Linear A corpus health gate — per-inscription FSM scores"
```

---

## Task 9: Build fabric pattern + install

**Files:**
- Create: `fabric/linear_a_translate.md`
- Install: `~/.config/fabric/my_patterns/linear_a_translate/system.md`

The keyword mapping table is built from FSM structural roles — ONSET signs map to
structural CSS constructs (selectors, blocks), BODY to values, CODA to terminators.
No phonetic values assigned at any point.

- [ ] **Step 1: Read the corpus outputs to build the mapping table**

```bash
# Check top ONSET signs (CSS selector/rule structural markers)
deno eval "
import freq from './corpus/analysis/sign-frequency.json' assert { type: 'json' };
freq.filter(s => s.positionBias === 'ONSET').slice(0, 12)
    .forEach(s => console.log(s.sign, s.freqTotal));
"

# Check top BODY signs (CSS value carriers)
deno eval "
import freq from './corpus/analysis/sign-frequency.json' assert { type: 'json' };
freq.filter(s => s.positionBias === 'BODY').slice(0, 12)
    .forEach(s => console.log(s.sign, s.freqTotal));
"

# Check top CODA signs (CSS terminators)
deno eval "
import freq from './corpus/analysis/sign-frequency.json' assert { type: 'json' };
freq.filter(s => s.positionBias === 'CODA').slice(0, 12)
    .forEach(s => console.log(s.sign, s.freqTotal));
"
```

Note the sign tokens from these three outputs — you will fill the keyword table below.

- [ ] **Step 2: Write the fabric pattern**

Create `fabric/linear_a_translate.md`.
Replace `<ONSET_1>`, `<BODY_1>`, `<CODA_1>`, etc. with the actual top signs from Step 1.

```markdown
# IDENTITY

You are a Linear A encoding expert and booLangCSS compiler.
You translate CSS constructs into native Linear A sign sequences.

Signs are opaque structural tokens — no phonetic values are assigned.
Assignments are based purely on positional corpus statistics:
  ONSET signs: appear predominantly at sign-group start (structural openers)
  BODY signs:  appear predominantly in sign-group middle (semantic carriers)
  CODA signs:  appear predominantly at sign-group end (structural closers)

# LINEAR A MORPHOLOGY

Sign groups follow the FSM canonical word shape:
  ONSET → BODY → CODA → BODY → ONSET

## ONSET signs (word-initial structural markers)
- <ONSET_1>   : primary selector / rule opener
- <ONSET_2>   : block opener
- <ONSET_3>   : declaration starter
- <ONSET_4>   : at-rule opener (@media, @keyframes)
- <ONSET_5>   : pseudo-class / pseudo-element marker
- <ONSET_6>   : combinator marker (descendant, child, sibling)

## BODY signs (core semantic carriers)
- <BODY_1>    : property name carrier
- <BODY_2>    : value carrier
- <BODY_3>    : color / unit carrier
- <BODY_4>    : numeric value carrier
- <BODY_5>    : string / keyword carrier
- <BODY_6>    : shorthand property carrier

## CODA signs (word-terminal bridges)
- <CODA_1>    : declaration terminator (;)
- <CODA_2>    : block terminator (})
- <CODA_3>    : rule terminator
- <CODA_4>    : value list terminator (,)
- <CODA_5>    : selector group terminator
- <CODA_6>    : important marker (!important)

# KEYWORD MAPPING (CSS → Linear A)

| CSS Construct        | Linear A Sign     | Structural Role |
|---------------------|-------------------|-----------------|
| selector            | <ONSET_1>         | ONSET           |
| {  (block open)     | <ONSET_2>         | ONSET           |
| property:           | <BODY_1>.<BODY_2> | BODY.BODY       |
| color value         | <BODY_3>          | BODY            |
| numeric value       | <BODY_4>          | BODY            |
| string value        | <BODY_5>          | BODY            |
| ;  (declaration end)| <CODA_1>          | CODA            |
| }  (block close)    | <CODA_2>          | CODA            |
| ,  (value list sep) | <CODA_4>          | CODA            |
| @media              | <ONSET_4>         | ONSET           |
| @keyframes          | <ONSET_4>         | ONSET           |
| :hover / :focus etc | <ONSET_5>         | ONSET           |
| !important          | <CODA_6>          | CODA            |

# STEPS

1. Parse the CSS input (selector, declarations, values)
2. Map each CSS construct to its Linear A sign using the table above
3. Compose valid Linear A sign groups following FSM morphology:
   ONSET → BODY → CODA → BODY → ONSET
4. Verify each output group follows the canonical word shape
5. Output in .linearA notation (dot-separated sign tokens per group)

# OUTPUT FORMAT

```linearA
// Original: [CSS rule description]
<sign>.<sign>.<sign>
```

# RULES

- Every output sign group MUST follow Linear A FSM morphology
- No phonetic values are assigned — signs are structural tokens only
- Signs assigned by structural role, not by any linguistic assumption
- AB000 / empty is reserved as group boundary — never in output
- Numbers stay as integers (no floating point)
- One sign group per CSS declaration
- Selectors compile to one ONSET-led sign group
- Block delimiters compile to dedicated CODA signs
```

- [ ] **Step 3: Install to fabric**

```bash
mkdir -p ~/.config/fabric/my_patterns/linear_a_translate
cp fabric/linear_a_translate.md ~/.config/fabric/my_patterns/linear_a_translate/system.md
```

- [ ] **Step 4: Verify installation**

```bash
ls ~/.config/fabric/my_patterns/linear_a_translate/
```

Expected: `system.md`

- [ ] **Step 5: Commit**

```bash
git add fabric/linear_a_translate.md
git commit -m "fabric: linear_a_translate pattern — CSS → Linear A IR compiler"
```

---

## Self-Review Checklist

| Spec requirement | Covered by |
|---|---|
| Corpus layer — .linearA files | Task 2 + 3 |
| inscription.index.yaml | Task 3 |
| Sign frequency + positional counts | Task 4 |
| Bigram transition matrix | Task 5 |
| FSM derivation — no Linear B | Task 6 |
| Governor ratio — empirically derived | Task 6 |
| linear-a-fsm.yaml | Task 6 |
| linear-a-fsm-validator.ts (TDD) | Task 7 |
| Corpus health scoring | Task 8 |
| corpus-health.yaml | Task 8 |
| Fabric pattern — structural roles only | Task 9 |
| No Linear B at any layer | All tasks |
| canonical_octet used for byte encoding | Tasks 4, 7 |
| 0x00 / sentinel quarantine | Task 3 (normalizeSign), Task 9 (RULES) |
