#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * synthetic_fetch.ts — Generate synthetic corpora for scripts with no
 *   publicly available machine-readable source.
 *
 * Generates:
 *   corpus/rongorongo/raw/rongorongo_raw.txt
 *   corpus/byblos_syllabary/raw/byblos_syllabary_raw.txt
 *   corpus/cretan_hieroglyphic/raw/cretan_hieroglyphic_raw.txt
 *
 * Each corpus is statistically calibrated to known parameters from the literature.
 * ALL generated files are clearly labeled SYNTHETIC in their headers.
 */

import { generateCorpus, CORPUS_PARAMS } from "./synthetic_gen.ts";

const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);

interface CorpusSpec {
  id:        string;
  outFile:   string;
  params:    typeof CORPUS_PARAMS[string];
}

const SPECS: CorpusSpec[] = [
  {
    id: "rongorongo",
    outFile: `${REPO_ROOT}corpus/rongorongo/raw/rongorongo_raw.txt`,
    params: CORPUS_PARAMS["rongorongo"]!,
  },
  {
    id: "byblos_syllabary",
    outFile: `${REPO_ROOT}corpus/byblos_syllabary/raw/byblos_syllabary_raw.txt`,
    params: CORPUS_PARAMS["byblos_syllabary"]!,
  },
  {
    id: "cretan_hieroglyphic",
    outFile: `${REPO_ROOT}corpus/cretan_hieroglyphic/raw/cretan_hieroglyphic_raw.txt`,
    params: CORPUS_PARAMS["cretan_hieroglyphic"]!,
  },
];

for (const spec of SPECS) {
  const dir = spec.outFile.replace(/\/[^/]+$/, "");
  Deno.mkdirSync(dir, { recursive: true });
  const content = generateCorpus(spec.params);
  Deno.writeTextFileSync(spec.outFile, content);
  const lineCount = content.split("\n").filter(l => l && !l.startsWith("#")).length;
  console.log(`✓ ${spec.params.scriptName.padEnd(26)} ${lineCount} groups → ${spec.outFile}`);
}

console.log("\nSynthetic corpora generated. NEXT: deno task corpus:build:all");
