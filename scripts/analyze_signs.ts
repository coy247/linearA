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

const REPO_ROOT    = decodeURIComponent(new URL("../", import.meta.url).pathname);
const CORPUS_DIR   = `${REPO_ROOT}corpus/inscriptions`;
const ANALYSIS_DIR = `${REPO_ROOT}corpus/analysis`;

export interface SignFreq {
  sign:          string;
  compactIndex:  number;
  canonicalByte: number | null;
  freqTotal:     number;
  freqInitial:   number;
  freqMedial:    number;
  freqFinal:     number;
  positionBias:  "ONSET" | "BODY" | "CODA" | "MIXED";
}

export interface SignIndex {
  [sign: string]: {
    compactIndex:  number;
    canonicalByte: number | null;
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
    if (inFlatList) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const signs = trimmed.split(".").map(s => s.trim()).filter(s => s.length > 0);
    if (signs.length > 0) groups.push(signs);
  }
  return groups;
}

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
      if (i === 0)                        entry.initial++;
      else if (i === group.length - 1)    entry.final++;
      else                                entry.medial++;
    }
  }
  return freq;
}

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

export function buildSignFreqArray(
  freq: Map<string, { total: number; initial: number; medial: number; final: number }>
): SignFreq[] {
  const sorted = [...freq.entries()].sort((a, b) => b[1].total - a[1].total);
  return sorted.map(([sign, counts], idx) => {
    const compactIndex = idx + 1;
    return {
      sign,
      compactIndex,
      // canonicalOctet maps indices 1–255 to bytes; beyond 255 the byte overflows (AND32 truncates).
      // Return null for out-of-range indices — the encoding layer handles only the top 255 signs.
      canonicalByte: compactIndex <= 255 ? canonicalOctet(compactIndex) : null,
      freqTotal:   counts.total,
      freqInitial: counts.initial,
      freqMedial:  counts.medial,
      freqFinal:   counts.final,
      positionBias: positionBias(counts),
    };
  });
}

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

export interface BigramEntry {
  from:            string;
  to:              string;
  count:           number;
  fromState:       "ONSET" | "BODY" | "CODA" | "MIXED";
  toState:         "ONSET" | "BODY" | "CODA" | "MIXED";
  stateTransition: string;
}

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
    // "→" (U+2192) is safe as delimiter: Linear A signs are U+10600–U+1077F, no overlap.
    const [from, to] = key.split("→");
    const fromState = signIndex[from]?.state ?? "MIXED";
    const toState   = signIndex[to]?.state   ?? "MIXED";
    entries.push({ from, to, count, fromState, toState, stateTransition: `${fromState}→${toState}` });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries;
}

export function aggregateStateTransitions(
  bigrams: BigramEntry[],
): Array<{ stateTransition: string; totalCount: number; pct: number }> {
  const totals = new Map<string, number>();
  let grandTotal = 0;
  for (const b of bigrams) {
    totals.set(b.stateTransition, (totals.get(b.stateTransition) ?? 0) + b.count);
    grandTotal += b.count;
  }
  return [...totals.entries()]
    .map(([stateTransition, totalCount]) => ({
      stateTransition,
      totalCount,
      pct: totalCount / grandTotal,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await Deno.mkdir(ANALYSIS_DIR, { recursive: true });

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

  const freq = buildFrequencyTable(allGroups);
  console.log(`  Unique signs: ${freq.size}`);

  const signFreqs = buildSignFreqArray(freq);
  const signIndex = buildSignIndex(signFreqs);

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
  console.log("  Rank  Sign  Total  Initial  Medial  Final  State");
  console.log("  " + "─".repeat(55));
  for (const sf of signFreqs.slice(0, 20)) {
    console.log(
      `  ${String(sf.compactIndex).padStart(4)}  ` +
      `${sf.sign}  ` +
      `${String(sf.freqTotal).padStart(5)}  ` +
      `${String(sf.freqInitial).padStart(7)}  ` +
      `${String(sf.freqMedial).padStart(6)}  ` +
      `${String(sf.freqFinal).padStart(5)}  ` +
      sf.positionBias
    );
  }

  const byState = { ONSET: 0, BODY: 0, CODA: 0, MIXED: 0 };
  for (const sf of signFreqs) byState[sf.positionBias]++;
  console.log(`\nState distribution across ${freq.size} unique signs:`);
  console.log(`  ONSET: ${byState.ONSET}  BODY: ${byState.BODY}  CODA: ${byState.CODA}  MIXED: ${byState.MIXED}`);

  // Build bigram matrix
  const bigrams = buildBigramMatrix(allGroups, signIndex);
  const stateAgg = aggregateStateTransitions(bigrams);

  await Deno.writeTextFile(
    `${ANALYSIS_DIR}/bigram-matrix.json`,
    JSON.stringify({ bigrams, stateAggregates: stateAgg }, null, 2),
  );

  console.log("\nState transition aggregates (sorted by count):");
  const grandTotal = bigrams.reduce((s, b) => s + b.count, 0);
  for (const agg of stateAgg) {
    console.log(
      `  ${agg.stateTransition.padEnd(16)} ${String(agg.totalCount).padStart(6)}  ` +
      `(${(agg.pct * 100).toFixed(1)}%)`
    );
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${String(grandTotal).padStart(6)}`);

  console.log(`\nWritten:`);
  console.log(`  ${ANALYSIS_DIR}/sign-frequency.json`);
  console.log(`  ${ANALYSIS_DIR}/sign-index.json`);
  console.log(`  ${ANALYSIS_DIR}/bigram-matrix.json`);
  console.log(`\nNEXT: deno task corpus:fsm`);
}

if (import.meta.main) main();
