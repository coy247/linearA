#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * voynich-corpus-health.ts — C011 step 2
 * Score all voynich/folios/*.voynich files through the FSM health gate.
 * Writes per-folio + per-section + overall scores to voynich/corpus-health.yaml
 *
 * Usage:
 *   deno run --allow-read --allow-write spec/voynich-corpus-health.ts
 *   deno run --allow-read --allow-write spec/voynich-corpus-health.ts --folios-dir <path>
 */

import { scoreFSM, scoreOutput, passesHealthGate, FSM_THRESHOLD } from "./voynich-fsm-validator.ts";

const REPO_ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);

const args = Deno.args;
const foliosDir = (() => {
  const idx = args.indexOf("--folios-dir");
  return idx !== -1 ? args[idx + 1] : `${REPO_ROOT}voynich/folios`;
})();
const outFile = `${REPO_ROOT}voynich/corpus-health.yaml`;

interface FolioScore {
  folio: string;
  section: string;
  words: number;
  scored: number;
  fsm_score: number;
  passes_gate: boolean;
}

function extractSection(content: string): string {
  const m = content.match(/# Section:\s+\S+\s+\((\w)\)/);
  return m?.[1] ?? "?";
}

function extractWords(content: string): string[] {
  const lines = content.split("\n");
  const words: string[] = [];
  let inWordList = false;
  for (const line of lines) {
    if (line.startsWith("# ── Word list")) { inWordList = true; continue; }
    if (inWordList && line.startsWith("#")) { inWordList = false; continue; }
    if (inWordList && line.trim()) {
      words.push(...line.split(".").map(w => w.trim()).filter(w => w.length > 0));
    }
  }
  return words;
}

async function main() {
  const scores: FolioScore[] = [];

  let entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(foliosDir)) {
      if (entry.name.endsWith(".voynich")) entries.push(entry);
    }
  } catch {
    console.error(`[corpus-health] cannot read folios dir: ${foliosDir}`);
    Deno.exit(1);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`[corpus-health] scoring ${entries.length} folios…`);

  for (const entry of entries) {
    const content = await Deno.readTextFile(`${foliosDir}/${entry.name}`);
    const folio = entry.name.replace(".voynich", "");
    const section = extractSection(content);
    const words = extractWords(content);

    const scored = words.filter(w => w.length >= 4).length;
    const scorableWords = words.filter(w => w.length >= 4);
    const fsm_score = scoreOutput(scorableWords);

    scores.push({
      folio,
      section,
      words: words.length,
      scored,
      fsm_score,
      passes_gate: fsm_score >= FSM_THRESHOLD,
    });
  }

  // Per-section aggregation
  const sections: Record<string, { total_words: number; total_scored: number; fsm_sum: number; count: number }> = {};
  for (const s of scores) {
    if (!sections[s.section]) sections[s.section] = { total_words: 0, total_scored: 0, fsm_sum: 0, count: 0 };
    sections[s.section].total_words += s.words;
    sections[s.section].total_scored += s.scored;
    sections[s.section].fsm_sum += s.fsm_score;
    sections[s.section].count++;
  }

  // Overall
  const total_words = scores.reduce((s, f) => s + f.words, 0);
  const total_scored = scores.reduce((s, f) => s + f.scored, 0);
  const overall_fsm = scores.length > 0
    ? scores.reduce((s, f) => s + f.fsm_score, 0) / scores.length
    : 0;
  const folios_pass = scores.filter(f => f.passes_gate).length;

  const SECTION_NAMES: Record<string, string> = {
    H: "Herbal", A: "Astrological", Z: "Zodiac", C: "Cosmological",
    B: "Biological", P: "Pharmaceutical", T: "Text/Recipes", S: "Stars",
  };

  const yaml: string[] = [
    `# Voynich Corpus Health — FSM Gate Scores`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# FSM threshold: ${FSM_THRESHOLD.toFixed(6)} (9109/9919)`,
    ``,
    `summary:`,
    `  total_folios: ${scores.length}`,
    `  total_words: ${total_words}`,
    `  total_scored: ${total_scored}`,
    `  overall_fsm_score: ${overall_fsm.toFixed(6)}`,
    `  overall_passes_gate: ${overall_fsm >= FSM_THRESHOLD}`,
    `  folios_pass: ${folios_pass}`,
    `  folios_fail: ${scores.length - folios_pass}`,
    ``,
    `sections:`,
  ];

  for (const [code, data] of Object.entries(sections).sort()) {
    const avg = data.count > 0 ? data.fsm_sum / data.count : 0;
    yaml.push(`  ${code}:  # ${SECTION_NAMES[code] ?? "Unknown"}`);
    yaml.push(`    folios: ${data.count}`);
    yaml.push(`    words: ${data.total_words}`);
    yaml.push(`    avg_fsm_score: ${avg.toFixed(6)}`);
    yaml.push(`    passes_gate: ${avg >= FSM_THRESHOLD}`);
  }

  yaml.push(``);
  yaml.push(`folios:`);

  let lastSection = "";
  for (const f of scores) {
    if (f.section !== lastSection) {
      yaml.push(`  # ── ${SECTION_NAMES[f.section] ?? "Unknown"} ──`);
      lastSection = f.section;
    }
    yaml.push(`  - folio: ${f.folio}`);
    yaml.push(`    section: ${f.section}`);
    yaml.push(`    words: ${f.words}`);
    yaml.push(`    scored: ${f.scored}`);
    yaml.push(`    fsm_score: ${f.fsm_score.toFixed(6)}`);
    yaml.push(`    passes_gate: ${f.passes_gate}`);
  }

  await Deno.writeTextFile(outFile, yaml.join("\n") + "\n");
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Voynich Corpus Health`);
  console.log(`${"=".repeat(60)}`);
  for (const [code, data] of Object.entries(sections).sort()) {
    const avg = data.count > 0 ? data.fsm_sum / data.count : 0;
    const gate = avg >= FSM_THRESHOLD ? "PASS" : "FAIL";
    console.log(`  ${code}  ${(SECTION_NAMES[code] ?? "Unknown").padEnd(16)}  ${String(data.count).padStart(3)} folios  FSM=${avg.toFixed(4)}  ${gate}`);
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`  Overall: ${scores.length} folios | ${total_words} words | FSM=${overall_fsm.toFixed(4)} | ${overall_fsm >= FSM_THRESHOLD ? "GATE PASS" : "GATE FAIL"}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nWritten: ${outFile}`);
}

main();
