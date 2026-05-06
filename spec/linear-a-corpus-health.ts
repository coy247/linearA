#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * linear-a-corpus-health.ts — Score all .linearA inscription files through the FSM gate.
 * Writes per-inscription + per-site + overall scores to corpus/corpus-health.yaml.
 *
 * Usage:
 *   deno task corpus:health
 *   deno run --allow-read --allow-write spec/linear-a-corpus-health.ts
 */

import { scoreOutput, FSM_THRESHOLD } from "./linear-a-fsm-validator.ts";

const REPO_ROOT  = decodeURIComponent(new URL("../", import.meta.url).pathname);
const CORPUS_DIR = `${REPO_ROOT}corpus/inscriptions`;
const OUT_FILE   = `${REPO_ROOT}corpus/corpus-health.yaml`;

interface InscriptionScore {
  id:          string;
  site:        string;
  groups:      number;
  scored:      number;
  fsm_score:   number;
  passes_gate: boolean;
}

function extractMeta(content: string): { id: string; site: string } {
  const idMatch   = content.match(/# Linear A Inscription — (.+)/);
  const siteMatch = content.match(/# Site:\s+\S+\s+\((\w+)\)/);
  return {
    id:   idMatch?.[1]?.trim()   ?? "unknown",
    site: siteMatch?.[1]?.trim() ?? "XX",
  };
}

function extractGroups(content: string): string[] {
  const groups: string[] = [];
  let inFlat = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("# ── Sign list")) { inFlat = true; continue; }
    if (line.startsWith("#")) continue;
    if (inFlat) continue;
    const t = line.trim();
    if (t) groups.push(t);
  }
  return groups;
}

async function main() {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(CORPUS_DIR)) {
      if (e.name.endsWith(".linearA")) entries.push(e);
    }
  } catch {
    console.error(`Cannot read ${CORPUS_DIR}. Run: deno task corpus:build`);
    Deno.exit(1);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`Scoring ${entries.length} inscriptions...`);

  const scores: InscriptionScore[] = [];

  for (const entry of entries) {
    const content = await Deno.readTextFile(`${CORPUS_DIR}/${entry.name}`);
    const { id, site } = extractMeta(content);
    const groups = extractGroups(content).filter(g => g.includes("."));
    const scored = groups.length;
    const fsm_score = scoreOutput(groups);
    scores.push({ id, site, groups: groups.length, scored, fsm_score, passes_gate: fsm_score >= FSM_THRESHOLD });
  }

  // Per-site aggregation
  const sites: Record<string, { total_groups: number; scored: number; fsm_sum: number; count: number }> = {};
  for (const s of scores) {
    if (!sites[s.site]) sites[s.site] = { total_groups: 0, scored: 0, fsm_sum: 0, count: 0 };
    sites[s.site].total_groups += s.groups;
    sites[s.site].scored       += s.scored;
    sites[s.site].fsm_sum      += s.fsm_score;
    sites[s.site].count++;
  }

  const total_groups  = scores.reduce((s, f) => s + f.groups, 0);
  const total_scored  = scores.reduce((s, f) => s + f.scored, 0);
  const overall_fsm   = scores.length > 0
    ? scores.reduce((s, f) => s + f.fsm_score, 0) / scores.length : 0;
  const inscs_pass = scores.filter(f => f.passes_gate).length;

  const yaml: string[] = [
    `# Linear A Corpus Health — FSM Gate Scores`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# FSM threshold: ${FSM_THRESHOLD.toFixed(6)}`,
    ``,
    `summary:`,
    `  total_inscriptions: ${scores.length}`,
    `  total_groups: ${total_groups}`,
    `  total_scored: ${total_scored}`,
    `  overall_fsm_score: ${overall_fsm.toFixed(6)}`,
    `  overall_passes_gate: ${overall_fsm >= FSM_THRESHOLD}`,
    `  inscriptions_pass: ${inscs_pass}`,
    `  inscriptions_fail: ${scores.length - inscs_pass}`,
    ``,
    `sites:`,
  ];

  for (const [code, data] of Object.entries(sites).sort()) {
    const avg = data.count > 0 ? data.fsm_sum / data.count : 0;
    yaml.push(`  ${code}:`);
    yaml.push(`    inscriptions: ${data.count}`);
    yaml.push(`    groups: ${data.total_groups}`);
    yaml.push(`    avg_fsm_score: ${avg.toFixed(6)}`);
    yaml.push(`    passes_gate: ${avg >= FSM_THRESHOLD}`);
  }

  yaml.push(``, `inscriptions:`);
  let lastSite = "";
  for (const f of scores) {
    if (f.site !== lastSite) { yaml.push(`  # ── ${f.site} ──`); lastSite = f.site; }
    yaml.push(`  - id: "${f.id}"`);
    yaml.push(`    site: ${f.site}`);
    yaml.push(`    groups: ${f.groups}`);
    yaml.push(`    scored: ${f.scored}`);
    yaml.push(`    fsm_score: ${f.fsm_score.toFixed(6)}`);
    yaml.push(`    passes_gate: ${f.passes_gate}`);
  }

  await Deno.writeTextFile(OUT_FILE, yaml.join("\n") + "\n");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Linear A Corpus Health`);
  console.log(`${"=".repeat(60)}`);
  for (const [code, data] of Object.entries(sites).sort()) {
    const avg  = data.count > 0 ? data.fsm_sum / data.count : 0;
    const gate = avg >= FSM_THRESHOLD ? "PASS" : "FAIL";
    console.log(`  ${code.padEnd(4)} ${String(data.count).padStart(4)} inscriptions  FSM=${avg.toFixed(4)}  ${gate}`);
  }
  console.log(`${"─".repeat(60)}`);
  console.log(`  Overall: ${scores.length} inscriptions | ${total_groups} groups | FSM=${overall_fsm.toFixed(4)} | ${overall_fsm >= FSM_THRESHOLD ? "GATE PASS" : "GATE FAIL"}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`\nWritten: ${OUT_FILE}`);
}

main();
