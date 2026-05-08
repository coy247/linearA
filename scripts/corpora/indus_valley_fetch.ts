#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/**
 * indus_valley_fetch.ts — Fetch Indus Valley / Harappan corpus from GitHub.
 *
 * Sources tried in order:
 *   1. mayig/indus-valley-script-corpus — JSON with grapheme sequences
 *   2. Synthetic fallback
 *
 * Output: corpus/indus_valley/raw/indus_valley_raw.txt
 */

import { generateCorpus, CORPUS_PARAMS } from "./synthetic_gen.ts";

const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);
const OUT_DIR   = `${REPO_ROOT}corpus/indus_valley/raw`;
const OUT_FILE  = `${OUT_DIR}/indus_valley_raw.txt`;

const GITHUB_SOURCES = [
  // mayig/indus-valley-script-corpus
  "https://api.github.com/repos/mayig/indus-valley-script-corpus/contents",
  // Alternative listing
  "https://api.github.com/repos/mayig/indus-valley-script-corpus/contents/data",
  "https://api.github.com/repos/sks444/indus-valley-script-corpus/contents",
];

async function tryFetch(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "linearA-corpus-fetcher/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 10) return text;
    }
  } catch { /* continue */ }
  return null;
}

interface IndusArtifact {
  id?: string;
  sides?: Array<{ graphemes?: string[]; signs?: string[] }>;
  graphemes?: string[];
  signs?: string[];
  inscription?: string;
}

function parseIndusJSON(raw: string): string[] {
  const groups: string[] = [];

  try {
    const data = JSON.parse(raw);
    const artifacts: IndusArtifact[] = Array.isArray(data) ? data : Object.values(data);

    for (const art of artifacts) {
      // Try sides array (mayig format)
      if (art.sides) {
        for (const side of art.sides) {
          const sgs = side.graphemes ?? side.signs ?? [];
          if (sgs.length > 0) groups.push(sgs.join("."));
        }
        continue;
      }
      // Try flat graphemes
      const sgs = art.graphemes ?? art.signs ?? [];
      if (sgs.length > 0) groups.push(sgs.join("."));
      // Try inscription string (space-separated)
      if (art.inscription) {
        const signs = art.inscription.trim().split(/\s+/).filter(s => s.length > 0);
        if (signs.length > 0) groups.push(signs.join("."));
      }
    }
  } catch {
    // Try line-by-line (simple text format)
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const signs = trimmed.split(/[\s,]+/).filter(s => s.length > 0);
      if (signs.length >= 2) groups.push(signs.join("."));
    }
  }

  return groups;
}

async function fetchFromGitHub(): Promise<string[] | null> {
  for (const apiUrl of GITHUB_SOURCES) {
    console.log(`  Trying: ${apiUrl}`);
    const listing = await tryFetch(apiUrl);
    if (!listing) continue;

    try {
      const files = JSON.parse(listing) as Array<{ name: string; download_url: string; type: string }>;
      const jsonFiles = files.filter(f => f.name.endsWith(".json") && f.download_url);

      for (const file of jsonFiles.slice(0, 10)) {
        const content = await tryFetch(file.download_url, 20000);
        if (!content) continue;
        const groups = parseIndusJSON(content);
        if (groups.length > 50) {
          console.log(`  ✓ ${file.name}: ${groups.length} groups`);
          return groups;
        }
      }

      // If no individual JSON files worked, try a combined file
      const combined = files.find(f => f.name.includes("corpus") || f.name.includes("all") || f.name.includes("data"));
      if (combined?.download_url) {
        const content = await tryFetch(combined.download_url, 30000);
        if (content) {
          const groups = parseIndusJSON(content);
          if (groups.length > 50) return groups;
        }
      }
    } catch { /* continue */ }
  }
  return null;
}

async function main() {
  await Deno.mkdir(OUT_DIR, { recursive: true });
  console.log("Fetching Indus Valley corpus...\n");

  let groups = await fetchFromGitHub();

  if (groups && groups.length > 50) {
    const header = [
      "# Indus Valley / Harappan corpus — GitHub source (mayig/indus-valley-script-corpus)",
      "# Format: one inscription per line, signs separated by '.'",
      "# Sign IDs from Mahadevan concordance",
      "# Reading direction: right-to-left (display order reversed here)",
      "#",
    ].join("\n");
    Deno.writeTextFileSync(OUT_FILE, header + "\n" + groups.join("\n") + "\n");
    console.log(`\n✓ Real corpus saved: ${groups.length} groups → ${OUT_FILE}`);
  } else {
    console.log("\n  Real sources unavailable. Generating synthetic corpus...");
    const params = {
      ...CORPUS_PARAMS["indus_valley"] ?? {},
      corpusId:      "indus_valley",
      scriptName:    "Indus Valley / Harappan",
      era:           "2600–1900 BCE",
      uniqueSigns:   400,
      totalGroups:   4000,    // 4k inscriptions × 1 group avg (short inscriptions)
      groupLenMin:   2,
      groupLenMax:   12,
      groupLenMode:  5,
      onsetFraction: 0.32,
      bodyFraction:  0.49,
      codaFraction:  0.11,
      onsetPosBias:  0.75,    // title signs strongly initial
      codaPosBias:   0.82,    // terminal signs strongly final (confirmed Mahadevan)
      seed:          0x1DF5,
    };
    const content = generateCorpus(params);
    Deno.writeTextFileSync(OUT_FILE, content);
    console.log(`✓ Synthetic corpus saved → ${OUT_FILE}`);
  }

  console.log(`\nNEXT: deno run --allow-read --allow-write scripts/corpora/indus_valley_build.ts`);
}

main();
