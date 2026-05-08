#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * meta_interview.ts — Structured pre/post vector collector.
 *
 * Captures researcher knowledge before running decipher_universal,
 * then merges computed LanguageVector fields after the run.
 *
 * Usage (pre-analysis interview):
 *   deno run --allow-read --allow-write scripts/meta_interview.ts \
 *     --phase pre --id proto_elamite --out data/language_vectors/proto_elamite.meta.json
 *
 * Usage (post-analysis merge):
 *   deno run --allow-read --allow-write scripts/meta_interview.ts \
 *     --phase post --id proto_elamite \
 *     --vector data/language_vectors/proto_elamite.json \
 *     --meta data/language_vectors/proto_elamite.meta.json
 *
 * The merged output is written back to the .meta.json file.
 * The .json file (LanguageVector) is never modified.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreInterviewRecord {
  corpusId:          string;
  scriptName:        string;
  era:               string;
  medium:            string;        // clay/stone/wood/papyrus/unknown
  readingDirection:  string;        // ltr/rtl/boustrophedon/unknown
  knownLanguageFamily: string;      // Dravidian/Indo-Aryan/Polynesian/Semitic/isolate/unknown
  corpusSource:      string;        // CDLI/Mahadevan/Fischer/custom/unknown
  confirmedReadings: string[];      // any known phonetic or semantic mappings
  totalSignsKnown:   number | null; // researcher's prior count (null = unknown)
  hypothesisType:    string;        // logographic/syllabic/alphabetic/mixed/unknown
  notes:             string;
  recordedAt:        string;
}

export interface PostInterviewRecord extends PreInterviewRecord {
  // Computed fields from LanguageVector (populated in post phase)
  computed_governorRatio:     number;
  computed_bij6Slot:          number;
  computed_bij6Hex:           string;
  computed_canonicalDistance: number;
  computed_transitionEntropy: number;
  computed_dominantPath:      string;
  computed_uniqueSigns:       number;
  computed_totalTokens:       number;
  computed_avgGroupLength:    number;

  // Researcher post-analysis assessment
  structuralTypeConfirmed:    string;  // logographic/syllabic/alphabetic/mixed/unknown
  naturalLanguageConfidence:  string;  // HIGH/MEDIUM/LOW
  crossLanguageNotes:         string;
  universalGrammarMarkers:    string[];
  mergedAt:                   string;
}

// ── Defaults (no-LLM priors for known scripts) ────────────────────────────────

const KNOWN_PRIORS: Record<string, Partial<PreInterviewRecord>> = {
  linear_a: {
    scriptName: "Linear A",
    era: "1800–1450 BCE",
    medium: "clay/stone",
    readingDirection: "ltr",
    knownLanguageFamily: "unknown (Minoan — isolate candidate)",
    corpusSource: "DĀMOS/Packard",
    confirmedReadings: ["none (phonetic values borrowed from Linear B are approximate)"],
    totalSignsKnown: 56,
    hypothesisType: "syllabic",
    notes: "Script of Minoan Crete. Mother script of Linear B. Undeciphered.",
  },
  proto_elamite: {
    scriptName: "Proto-Elamite",
    era: "3200–2900 BCE",
    medium: "clay",
    readingDirection: "rtl",
    knownLanguageFamily: "unknown (isolate)",
    corpusSource: "CDLI",
    confirmedReadings: ["numerical signs (base-10 system)", "M-class = commodity (structural)"],
    totalSignsKnown: 1000,
    hypothesisType: "logographic",
    notes: "World's oldest undeciphered script. Administrative accounting only.",
  },
  indus_valley: {
    scriptName: "Indus Valley / Harappan",
    era: "2600–1900 BCE",
    medium: "stone seals",
    readingDirection: "rtl",
    knownLanguageFamily: "unknown (Dravidian proto-candidate)",
    corpusSource: "Mahadevan concordance",
    confirmedReadings: ["none — conditional entropy profile matches natural language (Rao 2009)"],
    totalSignsKnown: 400,
    hypothesisType: "logosyllabic",
    notes: "~4000 inscriptions. Average 5 signs. Likely administrative titles.",
  },
  rongorongo: {
    scriptName: "Rongorongo",
    era: "1200–1877 CE",
    medium: "wood",
    readingDirection: "boustrophedon",
    knownLanguageFamily: "Old Rapa Nui (Polynesian — known language, unknown phonetic mapping)",
    corpusSource: "Fischer catalog",
    confirmedReadings: ["Tablet C = lunar calendar (30-day structure confirmed)"],
    totalSignsKnown: 120,
    hypothesisType: "mixed",
    notes: "Only indigenous Oceanian writing system. 25 tablets, ~14k glyphs. Ritual/astronomical.",
  },
  cretan_hieroglyphic: {
    scriptName: "Cretan Hieroglyphic",
    era: "2100–1700 BCE",
    medium: "clay/stone/seals",
    readingDirection: "ltr/boustrophedon",
    knownLanguageFamily: "unknown (Minoan — isolate candidate)",
    corpusSource: "CHIC (Olivier & Godart)",
    confirmedReadings: ["none — contemporary with Linear A, possibly related"],
    totalSignsKnown: 96,
    hypothesisType: "unknown",
    notes: "Predecessor or sibling script to Linear A on Crete.",
  },
  byblos_syllabary: {
    scriptName: "Byblos Syllabary / Pseudo-hieroglyphic",
    era: "1800–1400 BCE",
    medium: "stone",
    readingDirection: "rtl",
    knownLanguageFamily: "unknown (Semitic candidate)",
    corpusSource: "Dunand excavations",
    confirmedReadings: ["none — partial decipherment attempts by Dhorme (1946) disputed"],
    totalSignsKnown: 114,
    hypothesisType: "syllabic",
    notes: "From Byblos, Lebanon. ~10 inscriptions. Context suggests administrative/royal.",
  },
};

// ── Pre-interview ─────────────────────────────────────────────────────────────

function buildPreRecord(corpusId: string): PreInterviewRecord {
  const prior = KNOWN_PRIORS[corpusId] ?? {};
  return {
    corpusId,
    scriptName:          prior.scriptName        ?? corpusId,
    era:                 prior.era               ?? "unknown",
    medium:              prior.medium            ?? "unknown",
    readingDirection:    prior.readingDirection  ?? "unknown",
    knownLanguageFamily: prior.knownLanguageFamily ?? "unknown",
    corpusSource:        prior.corpusSource      ?? "unknown",
    confirmedReadings:   prior.confirmedReadings ?? [],
    totalSignsKnown:     prior.totalSignsKnown   ?? null,
    hypothesisType:      prior.hypothesisType    ?? "unknown",
    notes:               prior.notes             ?? "",
    recordedAt:          new Date().toISOString(),
  };
}

// ── Post-interview merge ───────────────────────────────────────────────────────

interface LanguageVectorMinimal {
  governorRatio:     number;
  bij6Slot:          number;
  bij6Hex:           string;
  canonicalDistance: number;
  transitionEntropy: number;
  dominantPath:      string;
  uniqueSigns:       number;
  totalTokens:       number;
  avgGroupLength:    number;
}

function mergePostRecord(pre: PreInterviewRecord, vec: LanguageVectorMinimal): PostInterviewRecord {
  const govR = vec.governorRatio;
  const naturalLanguageConfidence =
    govR >= 0.85 ? "HIGH" :
    govR >= 0.65 ? "MEDIUM" :
    govR >= 0.50 ? "LOW" :
    "INSUFFICIENT (may not be natural language)";

  const universalGrammarMarkers: string[] = [];
  if (govR > 0.50) universalGrammarMarkers.push(`governor_ratio > 0.5 (${govR.toFixed(4)})`);
  if (vec.transitionEntropy > 1.0) universalGrammarMarkers.push(`entropy > 1.0 bit (${vec.transitionEntropy.toFixed(4)})`);
  if (vec.avgGroupLength > 2.0) universalGrammarMarkers.push(`avg_group_length > 2 (${vec.avgGroupLength.toFixed(2)})`);
  if (vec.uniqueSigns > 10) universalGrammarMarkers.push(`sign_inventory > 10 (${vec.uniqueSigns})`);

  return {
    ...pre,
    computed_governorRatio:     vec.governorRatio,
    computed_bij6Slot:          vec.bij6Slot,
    computed_bij6Hex:           vec.bij6Hex,
    computed_canonicalDistance: vec.canonicalDistance,
    computed_transitionEntropy: vec.transitionEntropy,
    computed_dominantPath:      vec.dominantPath,
    computed_uniqueSigns:       vec.uniqueSigns,
    computed_totalTokens:       vec.totalTokens,
    computed_avgGroupLength:    vec.avgGroupLength,
    structuralTypeConfirmed:    pre.hypothesisType,
    naturalLanguageConfidence,
    crossLanguageNotes:         "",
    universalGrammarMarkers,
    mergedAt:                   new Date().toISOString(),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = Object.fromEntries(
    Deno.args.flatMap((a, i, arr) =>
      a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : []
    )
  );

  const phase     = args["phase"] ?? "pre";
  const id        = args["id"];
  const outPath   = args["out"]    ?? `data/language_vectors/${id}.meta.json`;
  const vecPath   = args["vector"] ?? `data/language_vectors/${id}.json`;
  const metaPath  = args["meta"]   ?? `data/language_vectors/${id}.meta.json`;

  if (!id) {
    console.error("Usage: meta_interview.ts --phase <pre|post> --id <corpus_id> [--out <path>] [--vector <path>] [--meta <path>]");
    Deno.exit(1);
  }

  if (phase === "pre") {
    const record = buildPreRecord(id);
    try { Deno.mkdirSync("data/language_vectors", { recursive: true }); } catch { /* exists */ }
    Deno.writeTextFileSync(outPath, JSON.stringify(record, null, 2));
    console.log(`\n╔═══ Pre-Analysis Record: ${record.scriptName} ═══╗`);
    console.log(`  Era:               ${record.era}`);
    console.log(`  Medium:            ${record.medium}`);
    console.log(`  Reading direction: ${record.readingDirection}`);
    console.log(`  Language family:   ${record.knownLanguageFamily}`);
    console.log(`  Hypothesis type:   ${record.hypothesisType}`);
    console.log(`  Known signs:       ${record.totalSignsKnown ?? "unknown"}`);
    console.log(`  Confirmed readings: ${record.confirmedReadings.join("; ") || "none"}`);
    console.log(`\nRecord written: ${outPath}`);
    console.log(`\nNext: run decipher_universal.ts --corpus <file> --id ${id}`);
    console.log(`Then: meta_interview.ts --phase post --id ${id} --vector data/language_vectors/${id}.json --meta ${outPath}`);

  } else if (phase === "post") {
    const pre: PreInterviewRecord = JSON.parse(Deno.readTextFileSync(metaPath));
    const vec: LanguageVectorMinimal = JSON.parse(Deno.readTextFileSync(vecPath));
    const post = mergePostRecord(pre, vec);
    Deno.writeTextFileSync(metaPath, JSON.stringify(post, null, 2));

    console.log(`\n╔═══ Post-Analysis Merge: ${post.scriptName} ═══╗`);
    console.log(`  Governor ratio:    ${post.computed_governorRatio.toFixed(4)} → Bij6 slot ${post.computed_bij6Slot} → ${post.computed_bij6Hex}`);
    console.log(`  Canonical dist:    ${post.computed_canonicalDistance.toFixed(4)}`);
    console.log(`  Entropy:           ${post.computed_transitionEntropy.toFixed(4)} bits`);
    console.log(`  NL confidence:     ${post.naturalLanguageConfidence}`);
    console.log(`  UG markers:        ${post.universalGrammarMarkers.join(" | ") || "none"}`);
    console.log(`  Dominant path:     ${post.computed_dominantPath}`);
    console.log(`\nMerged record written: ${metaPath}`);

  } else {
    console.error(`Unknown phase: ${phase}. Use --phase pre or --phase post`);
    Deno.exit(1);
  }
}
