#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * decipher_universal.ts — Tokenization-free universal corpus analyzer.
 *
 * Applies the booLang FSM methodology to ANY sign corpus.
 * No LLM calls. No phonetic assumptions. Pure positional statistics.
 *
 * Input:  a corpus file where each line is a sign group,
 *         signs within a group separated by a delimiter (default: ".")
 * Output: language_vectors/<corpus_id>.json — structural vector
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/decipher_universal.ts \
 *     --corpus data/proto_elamite.txt \
 *     --id proto_elamite \
 *     --delimiter "." \
 *     --meta data/proto_elamite_meta.json
 */
import { CANONICAL_RATIO } from "../../booLang-hardening/acceptable_range_governor.ts";
import { booLangDiv } from "../../booLang-hardening/acceptable_range_governor.ts";

const REPO_ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SignRole {
  sign:         string;
  total:        number;
  initial:      number;
  medial:       number;
  final:        number;
  onsetRatio:   number;
  codaRatio:    number;
  bodyRatio:    number;
  role:         "ONSET" | "BODY" | "CODA" | "MIXED";
}

export interface FsmTransition {
  from:   "ONSET" | "BODY" | "CODA" | "MIXED";
  to:     "ONSET" | "BODY" | "CODA" | "MIXED";
  count:  number;
  ratio:  number;
}

// Valid transitions (universal — same set as Linear A analysis)
const VALID_TRANSITIONS = new Set([
  "ONSET→BODY", "BODY→BODY", "ONSET→ONSET",
  "BODY→ONSET", "ONSET→MIXED", "BODY→MIXED",
  "MIXED→BODY", "MIXED→ONSET",
]);

export interface LanguageVector {
  corpusId:          string;
  scriptName:        string;
  era:               string;
  totalTokens:       number;
  uniqueSigns:       number;
  avgGroupLength:    number;
  onsetCount:        number;
  bodyCount:         number;
  codaCount:         number;
  mixedCount:        number;
  validTransitions:  number;
  totalTransitions:  number;
  governorRatio:     number;
  bij6Slot:          number;
  bij6Hex:           string;
  canonicalDistance: number;   // |governorRatio - CANONICAL_RATIO|
  transitionEntropy: number;   // Shannon entropy of transition distribution
  dominantPath:      string;   // e.g. "ONSET→BODY→CODA"
  topOnsetSigns:     string[];
  topBodySigns:      string[];
  topCodaSigns:      string[];
  generatedAt:       string;
}

// ── Parse corpus ──────────────────────────────────────────────────────────────

export function parseCorpus(text: string, delimiter: string): string[][] {
  const groups: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const signs = trimmed.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
    if (signs.length > 0) groups.push(signs);
  }
  return groups;
}

// ── Frequency table ───────────────────────────────────────────────────────────

function buildFrequency(groups: string[][]): Map<string, { total: number; initial: number; medial: number; final: number }> {
  const freq = new Map<string, { total: number; initial: number; medial: number; final: number }>();
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      const sign = group[i];
      const cur = freq.get(sign) ?? { total: 0, initial: 0, medial: 0, final: 0 };
      cur.total++;
      if (i === 0)                cur.initial++;
      else if (i === group.length - 1) cur.final++;
      else                        cur.medial++;
      freq.set(sign, cur);
    }
  }
  return freq;
}

function assignRole(counts: { total: number; initial: number; medial: number; final: number }): SignRole["role"] {
  const onsetR = booLangDiv(counts.initial, counts.total);
  const codaR  = booLangDiv(counts.final,   counts.total);
  const onset  = onsetR === "DEFINED" ? 0 : onsetR;
  const coda   = codaR  === "DEFINED" ? 0 : codaR;
  if (onset > 0.5) return "ONSET";
  if (coda  > 0.5) return "CODA";
  if (onset < 0.2 && coda < 0.2) return "BODY";
  return "MIXED";
}

// ── Bigram FSM ────────────────────────────────────────────────────────────────

function buildBigramFSM(groups: string[][], roleMap: Map<string, SignRole["role"]>) {
  const transitions = new Map<string, number>();
  let totalTransitions = 0;

  for (const group of groups) {
    for (let i = 0; i < group.length - 1; i++) {
      const fromRole = roleMap.get(group[i])   ?? "MIXED";
      const toRole   = roleMap.get(group[i+1]) ?? "MIXED";
      const key = `${fromRole}→${toRole}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
      totalTransitions++;
    }
  }
  return { transitions, totalTransitions };
}

// ── Shannon entropy ───────────────────────────────────────────────────────────

function shannonEntropy(transitions: Map<string, number>, total: number): number {
  let entropy = 0;
  for (const count of transitions.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

// ── Bij6 encoding ─────────────────────────────────────────────────────────────

function bij6Slot(ratio: number): number {
  return Math.min(6, Math.max(1, Math.ceil(ratio * 6)));
}

function bij6Hex(slot: number): string {
  const byte = Math.round((slot - 1) / 5 * 255);
  return `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

// ── Dominant path ─────────────────────────────────────────────────────────────

function dominantPath(transitions: Map<string, number>): string {
  const sorted = [...transitions.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 3).map(([k]) => k.split("→").join("→")).join(" → ");
}

// ── Main analysis ─────────────────────────────────────────────────────────────

export function analyzeCorpus(
  groups:     string[][],
  corpusId:   string,
  scriptName: string,
  era:        string,
): LanguageVector {
  const freqMap = buildFrequency(groups);
  const roles   = new Map<string, SignRole["role"]>();
  const signRoles: SignRole[] = [];

  for (const [sign, counts] of freqMap) {
    const role     = assignRole(counts);
    const onsetR   = booLangDiv(counts.initial, counts.total);
    const codaR    = booLangDiv(counts.final,   counts.total);
    const onset    = onsetR === "DEFINED" ? 0 : onsetR;
    const coda     = codaR  === "DEFINED" ? 0 : codaR;
    roles.set(sign, role);
    signRoles.push({
      sign, total: counts.total, initial: counts.initial,
      medial: counts.medial, final: counts.final,
      onsetRatio: onset, codaRatio: coda, bodyRatio: 1 - onset - coda, role,
    });
  }

  const { transitions, totalTransitions } = buildBigramFSM(groups, roles);

  let validCount = 0;
  for (const [key, count] of transitions) {
    if (VALID_TRANSITIONS.has(key)) validCount += count;
  }

  const govRatioResult = booLangDiv(validCount, totalTransitions);
  const governorRatio  = govRatioResult === "DEFINED" ? 0 : govRatioResult;
  const slot           = bij6Slot(governorRatio);

  const totalTokens    = signRoles.reduce((s, r) => s + r.total, 0);
  const avgGroupLen    = booLangDiv(totalTokens, groups.length);

  const byRole = (r: SignRole["role"]) =>
    signRoles.filter(s => s.role === r).sort((a, b) => b.total - a.total);

  return {
    corpusId,
    scriptName,
    era,
    totalTokens,
    uniqueSigns:       freqMap.size,
    avgGroupLength:    avgGroupLen === "DEFINED" ? 0 : avgGroupLen,
    onsetCount:        byRole("ONSET").length,
    bodyCount:         byRole("BODY").length,
    codaCount:         byRole("CODA").length,
    mixedCount:        byRole("MIXED").length,
    validTransitions:  validCount,
    totalTransitions,
    governorRatio,
    bij6Slot:          slot,
    bij6Hex:           bij6Hex(slot),
    canonicalDistance: Math.abs(governorRatio - CANONICAL_RATIO),
    transitionEntropy: shannonEntropy(transitions, totalTransitions || 1),
    dominantPath:      dominantPath(transitions),
    topOnsetSigns:     byRole("ONSET").slice(0, 5).map(s => s.sign),
    topBodySigns:      byRole("BODY").slice(0, 5).map(s => s.sign),
    topCodaSigns:      byRole("CODA").slice(0, 5).map(s => s.sign),
    generatedAt:       new Date().toISOString(),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args   = Object.fromEntries(
    Deno.args.flatMap((a, i, arr) =>
      a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : []
    )
  );

  const corpusFile = args["corpus"];
  const id         = args["id"]        ?? "unknown";
  const name       = args["name"]      ?? id;
  const era        = args["era"]       ?? "unknown";
  const delimiter  = args["delimiter"] ?? ".";

  if (!corpusFile) {
    console.error("Usage: decipher_universal.ts --corpus <file> --id <id> [--name <name>] [--era <era>] [--delimiter <char>]");
    Deno.exit(1);
  }

  const text   = Deno.readTextFileSync(corpusFile);
  const groups = parseCorpus(text, delimiter);
  const vector = analyzeCorpus(groups, id, name, era);

  // Print summary
  console.log(`\n╔═══ ${vector.scriptName} ═══╗`);
  console.log(`  Era:               ${vector.era}`);
  console.log(`  Tokens:            ${vector.totalTokens}  (${vector.uniqueSigns} unique signs)`);
  console.log(`  Avg group length:  ${vector.avgGroupLength.toFixed(2)}`);
  console.log(`  Sign roles:        ONSET=${vector.onsetCount} BODY=${vector.bodyCount} CODA=${vector.codaCount} MIXED=${vector.mixedCount}`);
  console.log(`  Governor ratio:    ${vector.governorRatio.toFixed(4)}  →  Bij6 slot ${vector.bij6Slot} → ${vector.bij6Hex}`);
  console.log(`  CANONICAL_RATIO:   ${CANONICAL_RATIO.toFixed(4)}  →  Bij6 slot 6 → 0xFF`);
  console.log(`  Distance:          ${vector.canonicalDistance.toFixed(4)}`);
  console.log(`  Entropy:           ${vector.transitionEntropy.toFixed(4)} bits`);
  console.log(`  Dominant path:     ${vector.dominantPath}`);
  console.log(`  Top ONSET:         ${vector.topOnsetSigns.join("  ")}`);
  console.log(`  Top BODY:          ${vector.topBodySigns.join("  ")}`);
  console.log(`  Top CODA:          ${vector.topCodaSigns.join("  ")}`);

  // VMC output
  console.log(`\n; ${vector.scriptName} — booLang FSM decode`);
  console.log(`; governor ratio: ${vector.governorRatio.toFixed(4)} → Bij6 slot ${vector.bij6Slot} → ${vector.bij6Hex}`);
  if (vector.topOnsetSigns[0]) console.log(`chedy  ${vector.topOnsetSigns[0].padEnd(12)} ; structural opener (ONSET)`);
  for (const b of vector.topBodySigns.slice(0, 2)) {
    console.log(`  daiin  ${b.padEnd(10)} ; semantic carrier (BODY)`);
  }
  if (vector.topCodaSigns[0]) console.log(`chey   ${vector.topCodaSigns[0].padEnd(12)} ; structural closer (CODA)`);
  console.log(`dy`);

  // Write vector JSON
  const outDir = `${REPO_ROOT}data/language_vectors`;
  try { Deno.mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
  const outPath = `${outDir}/${vector.corpusId}.json`;
  Deno.writeTextFileSync(outPath, JSON.stringify(vector, null, 2));
  console.log(`\nVector written: ${outPath}`);
}
