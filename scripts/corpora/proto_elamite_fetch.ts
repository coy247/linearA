#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/**
 * proto_elamite_fetch.ts — Fetch Proto-Elamite corpus from CDLI GitHub.
 *
 * Sources tried in order (first success wins):
 *   1. cdli-gh/data GitHub — bulk ATF dump, filtered for proto-elamite period
 *   2. CDLI search API — JSON results for period:proto-elamite
 *   3. Synthetic fallback — generated from known statistical parameters
 *
 * Output: corpus/proto_elamite/raw/proto_elamite_raw.txt
 */

import { generateCorpus, CORPUS_PARAMS } from "./synthetic_gen.ts";

const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const OUT_DIR   = `${REPO_ROOT}corpus/proto_elamite/raw`;
const OUT_FILE  = `${OUT_DIR}/proto_elamite_raw.txt`;

// CDLI GitHub bulk data (ATF format)
const CDLI_SOURCES = [
  // Direct CDLI GitHub search for proto-elamite ATF files listing
  "https://api.github.com/repos/cdli-gh/data/contents",
  // Known ATF bundle paths in cdli-gh/data
  "https://raw.githubusercontent.com/cdli-gh/data/master/cdldata.json",
];

// CDLI search API
const CDLI_API = "https://cdli.mpiwg-berlin.mpg.de/artifacts?filters=period:Proto-Elamite&limit=500&format=json";

interface CDLIArtifact {
  id?: string;
  designation?: string;
  period?: string;
  transliteration?: string;
  atf?: string;
  text?: string;
}

async function tryFetch(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "linearA-corpus-fetcher/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 50) return text;
    }
  } catch { /* continue */ }
  return null;
}

/** Extract sign groups from CDLI ATF format.
 *
 * ATF lines look like:
 *   &P...... = tablet id
 *   @tablet
 *   1. M388 N01 N14
 *   2. M036 M218 N01
 *
 * Sign IDs are M-class (commodity) and N-class (numerical).
 * We emit one group per ATF content line.
 */
function parseATF(raw: string): string[] {
  const groups: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Skip metadata lines
    if (!trimmed || trimmed.startsWith("&") || trimmed.startsWith("@") ||
        trimmed.startsWith("#") || trimmed.startsWith("$")) continue;

    // Content line: "1. M388 N01 N14" or "1'. M388#"
    const match = trimmed.match(/^\d+'?\.\s+(.+)$/);
    if (!match) continue;

    const signPart = match[1];
    // Split on spaces, filter to sign-like tokens (M/N/X prefix or alphanumeric)
    const signs = signPart.split(/\s+/)
      .map(s => s.replace(/[#?!*[\]]/g, "").trim())
      .filter(s => s.length > 0 && /^[A-Za-z][A-Za-z0-9]+$/.test(s));

    if (signs.length > 0) groups.push(signs.join("."));
  }
  return groups;
}

async function fetchFromCDLIAPI(): Promise<string[] | null> {
  console.log("  Trying CDLI search API...");
  const raw = await tryFetch(CDLI_API, 20000);
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    const artifacts: CDLIArtifact[] = Array.isArray(data) ? data : (data.results ?? data.data ?? []);
    if (artifacts.length === 0) return null;

    const groups: string[] = [];
    for (const art of artifacts) {
      const text = art.transliteration ?? art.atf ?? art.text ?? "";
      if (text) groups.push(...parseATF(text));
    }
    if (groups.length > 100) {
      console.log(`  ✓ CDLI API: ${groups.length} sign groups from ${artifacts.length} tablets`);
      return groups;
    }
  } catch { /* continue */ }
  return null;
}

async function fetchFromGitHub(): Promise<string[] | null> {
  console.log("  Trying CDLI GitHub repo listing...");
  const listing = await tryFetch(CDLI_SOURCES[0]);
  if (!listing) return null;

  try {
    const files = JSON.parse(listing) as Array<{ name: string; download_url: string; type: string }>;
    // Look for ATF files or data directories
    const atfEntries = files.filter(f =>
      f.name.includes("proto") || f.name.includes("atf") || f.name.includes("pf")
    );
    for (const entry of atfEntries.slice(0, 3)) {
      if (entry.download_url) {
        console.log(`  Trying: ${entry.download_url}`);
        const content = await tryFetch(entry.download_url, 30000);
        if (content) {
          const groups = parseATF(content);
          if (groups.length > 50) {
            console.log(`  ✓ GitHub: ${groups.length} sign groups from ${entry.name}`);
            return groups;
          }
        }
      }
    }
  } catch { /* continue */ }
  return null;
}

async function main() {
  await Deno.mkdir(OUT_DIR, { recursive: true });
  console.log("Fetching Proto-Elamite corpus...\n");

  // Try real sources
  let groups: string[] | null = null;
  groups = await fetchFromCDLIAPI();
  if (!groups) groups = await fetchFromGitHub();

  if (groups && groups.length > 100) {
    const header = [
      "# Proto-Elamite corpus — CDLI source",
      "# Format: one sign group per line, signs separated by '.'",
      "# M-class = commodity (ONSET), N-class = numerical (CODA)",
      "#",
    ].join("\n");
    const content = header + "\n" + groups.join("\n") + "\n";
    Deno.writeTextFileSync(OUT_FILE, content);
    console.log(`\n✓ Real corpus saved: ${groups.length} groups → ${OUT_FILE}`);
  } else {
    // Synthetic fallback
    console.log("\n  Real sources unavailable. Generating synthetic corpus...");
    const params = CORPUS_PARAMS["proto_elamite"] ?? {
      corpusId:      "proto_elamite",
      scriptName:    "Proto-Elamite",
      era:           "3200–2900 BCE",
      uniqueSigns:   1000,
      totalGroups:   9600,    // 48k tokens / avg 5 per group
      groupLenMin:   2,
      groupLenMax:   10,
      groupLenMode:  5,
      onsetFraction: 0.32,    // M-class commodity signs
      bodyFraction:  0.51,    // X-class agent/official signs
      codaFraction:  0.10,    // N-class numerical signs
      onsetPosBias:  0.80,    // commodity signs strongly initial (confirmed)
      codaPosBias:   0.88,    // numerical signs strongly final (confirmed)
      seed:          0x3EA1,
    };
    const content = generateCorpus(params);
    Deno.writeTextFileSync(OUT_FILE, content);
    console.log(`✓ Synthetic corpus saved → ${OUT_FILE}`);
  }

  console.log(`\nNEXT: deno run --allow-read --allow-write scripts/corpora/proto_elamite_build.ts`);
}

main();
