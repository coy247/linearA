#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * hermes_decipher.ts — Full Hermes-guided decipherment pipeline.
 *
 * Difficulty queue (hardest → easiest):
 *   1. rongorongo       — 14k glyphs, boustrophedon, no related script, no language family
 *   2. proto_elamite    — oldest script, 1000 signs, purely administrative
 *   3. byblos_syllabary — only 10 inscriptions, 114 signs
 *   4. cretan_hier      — 96 signs, predecessor to Linear A
 *   5. indus_valley     — 400 signs, avg 5-sign inscriptions
 *   6. linear_a         — best documented (Linear B parallel), our reference baseline
 *
 * Each run must beat the previous SAS score. SAS formula is immutable.
 * A language is "solved" (no longer undeciphered) when SAS >= 0.85.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net scripts/hermes_decipher.ts \
 *     --id rongorongo \
 *     --corpus data/rongorongo.txt \
 *     [--model hermes-local:latest] \
 *     [--force]  # override score-must-improve guard (use only for debugging)
 */

import { analyzeCorpus } from "./decipher_universal.ts";
import { hermesTokenize, tokensPerSecond } from "./hermes_tokenize.ts";
import { CANONICAL_RATIO } from "../../booLang-hardening/acceptable_range_governor.ts";

// ── Difficulty queue ──────────────────────────────────────────────────────────

export const DIFFICULTY_QUEUE = [
  {
    id:          "rongorongo",
    name:        "Rongorongo",
    era:         "1200–1877 CE",
    difficulty:  1,
    difficultyReason: "Smallest corpus, boustrophedon, no related script, known language but no phonetic mapping",
    readingDirection: "boustrophedon",
    knownFacts:  [
      "Anthropomorphic glyphs appear at line beginnings (ONSET role)",
      "Line-end markers appear at line ends (CODA role)",
      "Tablet C contains confirmed 30-day lunar calendar",
      "Glyph pairs are common — likely semantic compounds",
      "Reading order: boustrophedon (alternate lines rotated 180°)",
    ],
    expectedGovRatio: 0.74,
  },
  {
    id:          "proto_elamite",
    name:        "Proto-Elamite",
    era:         "3200–2900 BCE",
    difficulty:  2,
    difficultyReason: "Oldest undeciphered script, 1000 signs, pure administrative accounting",
    readingDirection: "rtl",
    knownFacts:  [
      "N-class signs (numerical wedge/circle) appear at group END — CODA role confirmed",
      "M-class signs (commodity pictographs) appear at group START — ONSET role confirmed",
      "Reading direction: right-to-left",
      "Groups typically: [commodity] [agent?] [count]",
      "High sign repetition within tablets (accounting records)",
    ],
    expectedGovRatio: 0.87,
  },
  {
    id:          "byblos_syllabary",
    name:        "Byblos Syllabary",
    era:         "1800–1400 BCE",
    difficulty:  3,
    difficultyReason: "Only 10 inscriptions (~1000 signs total), 114 unique signs, disputed partial decipherment",
    readingDirection: "rtl",
    knownFacts:  [
      "Reading direction: right-to-left (confirmed by sign orientation)",
      "Context: royal/administrative inscriptions from Byblos, Lebanon",
      "Possibly related to Proto-Sinaitic or early Semitic scripts",
      "Dhorme (1946) partial decipherment — largely rejected",
      "Sign frequency follows Zipf distribution",
    ],
    expectedGovRatio: 0.82,
  },
  {
    id:          "cretan_hieroglyphic",
    name:        "Cretan Hieroglyphic",
    era:         "2100–1700 BCE",
    difficulty:  4,
    difficultyReason: "Predecessor to Linear A, 96 signs, small corpus (seals and clay bars)",
    readingDirection: "ltr/boustrophedon",
    knownFacts:  [
      "Contemporary with and possibly predecessor to Linear A on Crete",
      "Appears on seals, clay bars, and roundels — administrative context",
      "CHIC catalog: Olivier & Godart (1996) is the reference",
      "Minoan language (isolate) likely underlying script",
      "Seal-type inscriptions are likely names/titles (short groups)",
    ],
    expectedGovRatio: 0.85,
  },
  {
    id:          "indus_valley",
    name:        "Indus Valley / Harappan",
    era:         "2600–1900 BCE",
    difficulty:  5,
    difficultyReason: "400 signs but average only 5 per inscription — very short groups, likely administrative labels",
    readingDirection: "rtl",
    knownFacts:  [
      "Reading direction: right-to-left (confirmed by sign compression at left edge)",
      "Terminal signs (Sign-342, Sign-59) appear at inscription end — CODA role confirmed",
      "Title/opener signs appear at inscription start — ONSET role confirmed",
      "Conditional entropy matches natural language (Rao et al. 2009)",
      "Most inscriptions are 3-7 signs — likely titles or merchant names",
    ],
    expectedGovRatio: 0.86,
  },
  {
    id:          "linear_a",
    name:        "Linear A",
    era:         "1800–1450 BCE",
    difficulty:  6,
    difficultyReason: "Best documented: Linear B phonetic parallel, DĀMOS corpus, empirical FSM baseline",
    readingDirection: "ltr",
    knownFacts:  [
      "Linear B borrowed ~80 signs from Linear A — structural parallel available",
      "DĀMOS corpus: ~7362 tokens, 56 unique signs",
      "Empirical governor ratio: 3631/3980 ≈ 0.9123",
      "Administrative context (Linear B decipherment confirms Minoan administrative use)",
      "Reading direction: left-to-right",
    ],
    expectedGovRatio: 0.9123,
  },
];

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface SolvedRecord {
  corpusId:           string;
  scriptName:         string;
  solvedAt:           string;       // ISO timestamp
  solvedByModel:      string;
  sas:                number;
  governorRatio:      number;
  bij6Slot:           number;
  bij6Hex:            string;
  canonicalDistance:  number;
  entropy:            number;
  structuralType:     string;
  vmcOutput:          string;
  tokensPerSecond:    number;
  notes:              string;
}

export interface LedgerEntry {
  runId:              string;
  corpusId:           string;
  runAt:              string;
  model:              string;
  sas:                number;
  previousSas:        number | null;
  delta:              number | null;
  governorRatio:      number;
  bij6Slot:           number;
  bij6Hex:            string;
  canonicalDistance:  number;
  entropy:            number;
  signGroupsProposed: number;
  hermesConfidence:   number;
  hermesReasoning:    string;
  tokensPerSecond:    number;
  durationMs:         number;
  beatPrevious:       boolean;
  solvedThisRun:      boolean;
}

export interface ScoreLedger {
  _schema:           string;
  _note:             string;
  _booLangThreshold: number;
  _solvedDefinition: string;
  canonicalRatio:    number;
  entries:           LedgerEntry[];
  solved:            SolvedRecord[];
}

export function computeSAS(governorRatio: number, canonicalDistance: number, entropy: number): number {
  const entropyScore = Math.min(entropy / 3.5, 1.0);
  return (governorRatio * 0.50) + ((1 - canonicalDistance) * 0.30) + (entropyScore * 0.20);
}

// ── VMC output builder ────────────────────────────────────────────────────────

function buildVMC(scriptName: string, corpusId: string, gov: number, slot: number, hex: string,
  topOnset: string[], topBody: string[], topCoda: string[]): string {
  const lines = [
    `; ${scriptName} — booLang FSM structural decipherment`,
    `; governor ratio: ${gov.toFixed(4)} → Bij6 slot ${slot} → ${hex}`,
    `; CANONICAL_RATIO: ${CANONICAL_RATIO.toFixed(4)} → Bij6 slot 6 → 0xFF`,
    `; script: ${corpusId}`,
    ``,
  ];
  if (topOnset[0]) lines.push(`chedy  ${topOnset[0].padEnd(14)} ; structural opener (ONSET)`);
  for (const b of topBody.slice(0, 2)) {
    lines.push(`  daiin  ${b.padEnd(12)} ; semantic carrier (BODY)`);
  }
  if (topCoda[0]) lines.push(`chey   ${topCoda[0].padEnd(14)} ; structural closer (CODA)`);
  lines.push(`dy`);
  return lines.join("\n");
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function runHermesDecipher(options: {
  id:         string;
  corpusText?: string;   // raw text (if provided, skips file read)
  corpusFile?: string;   // path to corpus file
  model?:     string;
  force?:     boolean;   // bypass score-must-improve guard
  verbose?:   boolean;
}): Promise<LedgerEntry> {
  const { id, model = "hermes-local:latest", force = false, verbose = false } = options;

  // Find script metadata
  const meta = DIFFICULTY_QUEUE.find(q => q.id === id);
  if (!meta) throw new Error(`Unknown corpus id: ${id}. Known: ${DIFFICULTY_QUEUE.map(q => q.id).join(", ")}`);

  // Load ledger
  let ledger: ScoreLedger;
  try {
    ledger = JSON.parse(Deno.readTextFileSync("data/scores/ledger.json"));
  } catch {
    throw new Error("data/scores/ledger.json not found. Run scripts/hermes_decipher.ts from the repo root.");
  }

  // Find previous SAS for this corpus
  const prevEntries = ledger.entries.filter(e => e.corpusId === id);
  const previousSas = prevEntries.length > 0
    ? prevEntries[prevEntries.length - 1].sas
    : null;

  // Load corpus text
  let rawText = options.corpusText ?? "";
  if (!rawText && options.corpusFile) {
    rawText = Deno.readTextFileSync(options.corpusFile);
  }
  if (!rawText) {
    // Use seeded vector for demo mode (no corpus file)
    throw new Error(`No corpus text provided. Use --corpus <file> or pass corpusText.`);
  }

  // Build cross-language context from matrix (if available)
  let crossCtx: string | undefined;
  try {
    const matrix = JSON.parse(Deno.readTextFileSync("data/language_vectors/_matrix.json"));
    crossCtx = JSON.stringify({
      canonicalRatio: matrix.canonicalRatio,
      convergenceScore: matrix.universalMarkers.convergenceScore,
      dominantPathModes: matrix.universalMarkers.dominantPathModes,
      knownScripts: matrix.vectors.map((v: { corpusId: string; governorRatio: number; bij6Hex: string }) => ({
        id: v.corpusId, gov: v.governorRatio, hex: v.bij6Hex,
      })),
    });
  } catch { /* no matrix yet — first run */ }

  if (verbose) console.log(`\n[hermes_decipher] Calling ${model} for ${meta.name}...`);

  // Hermes tokenization
  const hermesResult = await hermesTokenize({
    rawText,
    corpusId: id,
    scriptName: meta.name,
    era: meta.era,
    readingDirection: meta.readingDirection,
    knownFacts: meta.knownFacts,
    crossLanguageContext: crossCtx,
    model,
  });

  const tps = tokensPerSecond(hermesResult);
  if (verbose) {
    console.log(`[hermes_decipher] Segmented ${hermesResult.signGroups.length} groups in ${hermesResult.durationMs}ms (${tps} tok/s)`);
    console.log(`[hermes_decipher] Confidence: ${hermesResult.confidence.toFixed(2)}`);
    console.log(`[hermes_decipher] Reasoning: ${hermesResult.reasoning}`);
  }

  if (hermesResult.signGroups.length === 0) {
    throw new Error("Hermes returned 0 sign groups — check corpus format or model.");
  }

  // FSM analysis
  const vector = analyzeCorpus(hermesResult.signGroups, id, meta.name, meta.era);
  const sas    = computeSAS(vector.governorRatio, vector.canonicalDistance, vector.transitionEntropy);

  // Score guard
  if (!force && previousSas !== null && sas <= previousSas) {
    throw new Error(
      `Score did not improve: SAS=${sas.toFixed(4)} <= previous=${previousSas.toFixed(4)}. ` +
      `Run with --force to override (debug only — this violates the challenge rules).`
    );
  }

  const isSolved = sas >= ledger._booLangThreshold && vector.governorRatio > 0.65;
  const alreadySolved = ledger.solved.some(s => s.corpusId === id);

  // Build VMC
  const vmc = buildVMC(
    meta.name, id, vector.governorRatio, vector.bij6Slot, vector.bij6Hex,
    vector.topOnsetSigns, vector.topBodySigns, vector.topCodaSigns,
  );

  // Build entry
  const entry: LedgerEntry = {
    runId:              `${id}_${Date.now()}`,
    corpusId:           id,
    runAt:              new Date().toISOString(),
    model,
    sas:                parseFloat(sas.toFixed(6)),
    previousSas:        previousSas !== null ? parseFloat(previousSas.toFixed(6)) : null,
    delta:              previousSas !== null ? parseFloat((sas - previousSas).toFixed(6)) : null,
    governorRatio:      vector.governorRatio,
    bij6Slot:           vector.bij6Slot,
    bij6Hex:            vector.bij6Hex,
    canonicalDistance:  vector.canonicalDistance,
    entropy:            vector.transitionEntropy,
    signGroupsProposed: hermesResult.signGroups.length,
    hermesConfidence:   hermesResult.confidence,
    hermesReasoning:    hermesResult.reasoning,
    tokensPerSecond:    tps,
    durationMs:         hermesResult.durationMs,
    beatPrevious:       previousSas === null || sas > previousSas,
    solvedThisRun:      isSolved && !alreadySolved,
  };

  // Update ledger
  ledger.entries.push(entry);

  if (isSolved && !alreadySolved) {
    ledger.solved.push({
      corpusId:          id,
      scriptName:        meta.name,
      solvedAt:          entry.runAt,
      solvedByModel:     model,
      sas:               entry.sas,
      governorRatio:     vector.governorRatio,
      bij6Slot:          vector.bij6Slot,
      bij6Hex:           vector.bij6Hex,
      canonicalDistance: vector.canonicalDistance,
      entropy:           vector.transitionEntropy,
      structuralType:    "structural — ONSET/BODY/CODA roles assigned via FSM",
      vmcOutput:         vmc,
      tokensPerSecond:   tps,
      notes:             `Hermes reasoning: ${hermesResult.reasoning}`,
    });
  }

  Deno.writeTextFileSync("data/scores/ledger.json", JSON.stringify(ledger, null, 2));

  // Also write/update the language vector
  try { Deno.mkdirSync("data/language_vectors", { recursive: true }); } catch { /* exists */ }
  Deno.writeTextFileSync(`data/language_vectors/${id}.json`, JSON.stringify(vector, null, 2));

  return entry;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = Object.fromEntries(
    Deno.args.flatMap((a, i, arr) =>
      a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : []
    )
  );

  const id          = args["id"];
  const corpusFile  = args["corpus"];
  const model       = args["model"] ?? "hermes-local:latest";
  const force       = "force" in args;
  const queue       = "queue" in args;

  if (queue) {
    console.log("\n╔═══ Difficulty Queue (hardest → easiest) ═══╗");
    DIFFICULTY_QUEUE.forEach((q, i) => {
      console.log(`  ${i + 1}. [difficulty ${q.id.padEnd(22)} expected gov: ${q.expectedGovRatio.toFixed(4)}  ${q.era}`);
      console.log(`     ${q.difficultyReason}`);
    });
    Deno.exit(0);
  }

  if (!id || !corpusFile) {
    console.error("Usage: hermes_decipher.ts --id <corpus_id> --corpus <file> [--model <name>] [--force]");
    console.error("       hermes_decipher.ts --queue   (show difficulty queue)");
    Deno.exit(1);
  }

  const corpusText = Deno.readTextFileSync(corpusFile);

  console.log(`\n╔═══ Hermes Decipher: ${id} ═══╗`);

  try {
    const entry = await runHermesDecipher({ id, corpusText, model, force, verbose: true });

    console.log(`\n  SAS:              ${entry.sas.toFixed(6)}`);
    console.log(`  Previous SAS:     ${entry.previousSas?.toFixed(6) ?? "—  (first run)"}`);
    console.log(`  Delta:            ${entry.delta !== null ? (entry.delta > 0 ? "+" : "") + entry.delta.toFixed(6) : "—"}`);
    console.log(`  Governor ratio:   ${entry.governorRatio.toFixed(4)} → Bij6 slot ${entry.bij6Slot} → ${entry.bij6Hex}`);
    console.log(`  Canonical dist:   ${entry.canonicalDistance.toFixed(4)}`);
    console.log(`  Entropy:          ${entry.entropy.toFixed(4)} bits`);
    console.log(`  Groups proposed:  ${entry.signGroupsProposed}`);
    console.log(`  Hermes tok/s:     ${entry.tokensPerSecond}`);
    console.log(`  Beat previous:    ${entry.beatPrevious ? "YES ✓" : "NO ✗"}`);
    if (entry.solvedThisRun) {
      console.log(`\n  *** SOLVED: ${id} is no longer undeciphered ***`);
      console.log(`  Solved at: ${entry.runAt}`);
      console.log(`  SAS >= ${0.85} threshold met — booLang standard achieved`);
    }

  } catch (err) {
    console.error(`\nError: ${(err as Error).message}`);
    Deno.exit(1);
  }
}
