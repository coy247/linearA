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

const REPO_ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const OUT_DIR = `${REPO_ROOT}corpus/raw`;

const CANDIDATES = [
  "https://raw.githubusercontent.com/mwenge/LinearA/master/src/linearA.js",
  "https://raw.githubusercontent.com/mwenge/LinearA/master/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/main/src/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/main/linearA.js",
  "https://raw.githubusercontent.com/mwenge/lineara.xyz/master/src/linearA.js",
];

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
