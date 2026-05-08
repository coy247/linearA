#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * compare_languages.ts — Cross-language delta matrix.
 *
 * Reads all data/language_vectors/*.json files and computes pairwise
 * deltas across governor ratio, entropy, canonical distance, and group length.
 * Outputs a comparison matrix to stdout and data/language_vectors/_matrix.json.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/compare_languages.ts
 *   deno run --allow-read --allow-write scripts/compare_languages.ts --dir data/language_vectors
 */

import { CANONICAL_RATIO } from "../../booLang-hardening/acceptable_range_governor.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VectorSummary {
  corpusId:          string;
  scriptName:        string;
  era:               string;
  governorRatio:     number;
  bij6Slot:          number;
  bij6Hex:           string;
  canonicalDistance: number;
  transitionEntropy: number;
  avgGroupLength:    number;
  uniqueSigns:       number;
  totalTokens:       number;
  dominantPath:      string;
}

interface PairDelta {
  a:                    string;
  b:                    string;
  Δ_governorRatio:      number;
  Δ_canonicalDistance:  number;
  Δ_transitionEntropy:  number;
  Δ_avgGroupLength:     number;
  euclidean:            number;  // L2 distance across the 4 normalized deltas
  similarityTier:       string;  // VERY_HIGH / HIGH / MEDIUM / LOW / DIVERGENT
}

export interface ComparisonMatrix {
  generatedAt:       string;
  canonicalRatio:    number;
  corpusCount:       number;
  vectors:           VectorSummary[];
  pairs:             PairDelta[];
  universalMarkers:  UniversalMarkers;
}

interface UniversalMarkers {
  minGovernorRatio:   number;
  maxGovernorRatio:   number;
  allAboveThreshold:  boolean;  // all > 0.5
  convergenceScore:   number;   // 1 - (stddev of governorRatios / mean)
  entropyRange:       [number, number];
  dominantPathModes:  string[]; // most common transition arcs across all scripts
}

// ── Normalize a value to [0, 1] for distance computation ─────────────────────

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

// ── Euclidean distance across 4 features ─────────────────────────────────────

function euclidean(a: VectorSummary, b: VectorSummary, ranges: Record<string, [number, number]>): number {
  const dg = normalize(a.governorRatio, ...ranges.governorRatio)     - normalize(b.governorRatio, ...ranges.governorRatio);
  const dc = normalize(a.canonicalDistance, ...ranges.canonicalDistance) - normalize(b.canonicalDistance, ...ranges.canonicalDistance);
  const de = normalize(a.transitionEntropy, ...ranges.transitionEntropy) - normalize(b.transitionEntropy, ...ranges.transitionEntropy);
  const dl = normalize(a.avgGroupLength, ...ranges.avgGroupLength)   - normalize(b.avgGroupLength, ...ranges.avgGroupLength);
  return Math.sqrt(dg*dg + dc*dc + de*de + dl*dl);
}

function similarityTier(dist: number): string {
  if (dist < 0.1) return "VERY_HIGH";
  if (dist < 0.25) return "HIGH";
  if (dist < 0.45) return "MEDIUM";
  if (dist < 0.65) return "LOW";
  return "DIVERGENT";
}

// ── Standard deviation ────────────────────────────────────────────────────────

function stddev(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ── Main ──────────────────────────────────────────────────────────────────────

function buildMatrix(vectors: VectorSummary[]): ComparisonMatrix {
  if (vectors.length === 0) {
    throw new Error("No vectors to compare.");
  }

  // Compute ranges for normalization
  const ranges: Record<string, [number, number]> = {
    governorRatio:     [Math.min(...vectors.map(v => v.governorRatio)),     Math.max(...vectors.map(v => v.governorRatio))],
    canonicalDistance: [Math.min(...vectors.map(v => v.canonicalDistance)), Math.max(...vectors.map(v => v.canonicalDistance))],
    transitionEntropy: [Math.min(...vectors.map(v => v.transitionEntropy)), Math.max(...vectors.map(v => v.transitionEntropy))],
    avgGroupLength:    [Math.min(...vectors.map(v => v.avgGroupLength)),    Math.max(...vectors.map(v => v.avgGroupLength))],
  };

  // Pairwise deltas
  const pairs: PairDelta[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const a = vectors[i], b = vectors[j];
      const dist = euclidean(a, b, ranges);
      pairs.push({
        a:                   a.corpusId,
        b:                   b.corpusId,
        Δ_governorRatio:     parseFloat((a.governorRatio - b.governorRatio).toFixed(6)),
        Δ_canonicalDistance: parseFloat((a.canonicalDistance - b.canonicalDistance).toFixed(6)),
        Δ_transitionEntropy: parseFloat((a.transitionEntropy - b.transitionEntropy).toFixed(6)),
        Δ_avgGroupLength:    parseFloat((a.avgGroupLength - b.avgGroupLength).toFixed(6)),
        euclidean:           parseFloat(dist.toFixed(6)),
        similarityTier:      similarityTier(dist),
      });
    }
  }

  // Universal markers
  const govRatios = vectors.map(v => v.governorRatio);
  const mean = govRatios.reduce((s, v) => s + v, 0) / govRatios.length;
  const convergenceScore = 1 - (stddev(govRatios) / mean);

  // Dominant path modes: split each dominantPath into individual arcs
  const arcFreq = new Map<string, number>();
  for (const v of vectors) {
    for (const arc of v.dominantPath.split(" → ")) {
      arcFreq.set(arc, (arcFreq.get(arc) ?? 0) + 1);
    }
  }
  const dominantPathModes = [...arcFreq.entries()]
    .filter(([, c]) => c >= Math.ceil(vectors.length / 2))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  return {
    generatedAt:    new Date().toISOString(),
    canonicalRatio: CANONICAL_RATIO,
    corpusCount:    vectors.length,
    vectors,
    pairs:          pairs.sort((a, b) => a.euclidean - b.euclidean),
    universalMarkers: {
      minGovernorRatio:  Math.min(...govRatios),
      maxGovernorRatio:  Math.max(...govRatios),
      allAboveThreshold: govRatios.every(r => r > 0.5),
      convergenceScore:  parseFloat(convergenceScore.toFixed(6)),
      entropyRange:      [
        parseFloat(Math.min(...vectors.map(v => v.transitionEntropy)).toFixed(4)),
        parseFloat(Math.max(...vectors.map(v => v.transitionEntropy)).toFixed(4)),
      ],
      dominantPathModes,
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = Object.fromEntries(
    Deno.args.flatMap((a, i, arr) =>
      a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : []
    )
  );

  const dir     = args["dir"] ?? "data/language_vectors";
  const outPath = args["out"] ?? `${dir}/_matrix.json`;

  // Collect all .json files, skip _matrix.json and .meta.json
  const files: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    if (entry.isFile && entry.name.endsWith(".json") && !entry.name.startsWith("_") && !entry.name.includes(".meta")) {
      files.push(`${dir}/${entry.name}`);
    }
  }

  if (files.length === 0) {
    console.error(`No language vector files found in ${dir}`);
    console.error("Run decipher_universal.ts first to generate vectors.");
    Deno.exit(1);
  }

  const vectors: VectorSummary[] = files.map(f => {
    const raw = JSON.parse(Deno.readTextFileSync(f));
    return {
      corpusId:          raw.corpusId,
      scriptName:        raw.scriptName,
      era:               raw.era,
      governorRatio:     raw.governorRatio,
      bij6Slot:          raw.bij6Slot,
      bij6Hex:           raw.bij6Hex,
      canonicalDistance: raw.canonicalDistance,
      transitionEntropy: raw.transitionEntropy,
      avgGroupLength:    raw.avgGroupLength,
      uniqueSigns:       raw.uniqueSigns,
      totalTokens:       raw.totalTokens,
      dominantPath:      raw.dominantPath,
    };
  });

  const matrix = buildMatrix(vectors);

  // Print summary
  console.log(`\n╔═══ Cross-Language Comparison Matrix ═══╗`);
  console.log(`  CANONICAL_RATIO:  ${CANONICAL_RATIO.toFixed(6)}`);
  console.log(`  Scripts analyzed: ${matrix.corpusCount}`);
  console.log(`  All above 0.5:   ${matrix.universalMarkers.allAboveThreshold}`);
  console.log(`  Convergence:     ${matrix.universalMarkers.convergenceScore.toFixed(4)} (1 = identical governor ratios)`);
  console.log(`  Entropy range:   [${matrix.universalMarkers.entropyRange.join(", ")}] bits`);
  console.log(`  Shared paths:    ${matrix.universalMarkers.dominantPathModes.join(" | ") || "none"}`);

  console.log(`\n  Governor ratios (sorted):`);
  [...vectors].sort((a, b) => b.governorRatio - a.governorRatio).forEach(v => {
    const bar = "█".repeat(Math.round(v.governorRatio * 20));
    console.log(`    ${v.corpusId.padEnd(20)} ${v.governorRatio.toFixed(4)}  ${bar}  ${v.bij6Hex}`);
  });

  console.log(`\n  Most similar pairs:`);
  matrix.pairs.slice(0, 5).forEach(p => {
    console.log(`    ${p.a} ↔ ${p.b}: euclidean=${p.euclidean.toFixed(4)} [${p.similarityTier}]  Δgov=${p.Δ_governorRatio.toFixed(4)}`);
  });

  if (matrix.pairs.length > 5) {
    console.log(`\n  Most divergent pairs:`);
    matrix.pairs.slice(-Math.min(3, matrix.pairs.length)).reverse().forEach(p => {
      console.log(`    ${p.a} ↔ ${p.b}: euclidean=${p.euclidean.toFixed(4)} [${p.similarityTier}]  Δgov=${p.Δ_governorRatio.toFixed(4)}`);
    });
  }

  Deno.writeTextFileSync(outPath, JSON.stringify(matrix, null, 2));
  console.log(`\nMatrix written: ${outPath}`);
}
