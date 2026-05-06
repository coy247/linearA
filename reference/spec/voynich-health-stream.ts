#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * voynich-health-stream.ts — C006 step 4
 * Emits per-run FSM health scores to boolang-health.jsonl.
 * Observational only — reads xmr-samples.jsonl, scores W32 tokens via FSM.
 *
 * Usage: deno run --allow-read --allow-write spec/voynich-health-stream.ts
 * Wire into xmr_supervisor.ts as an optional post-run step, or run standalone.
 */

import { scoreOutput, FSM_THRESHOLD } from "./voynich-fsm-validator.ts";
import { join } from "jsr:@std/path";

const REPO_ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const SAMPLES_FILE = join(REPO_ROOT, "logs/xmr-samples.jsonl");
const HEALTH_FILE  = join(REPO_ROOT, "logs/boolang-health.jsonl");

interface HealthRecord {
  ts: number;               // metadata only — non-authoritative
  // booLangID: BLID_health_<sha256(tokens)[0..16]> — content-derived, replaces timestamp run_id (C003 ID audit)
  run_id: string;
  tokens_scored: number;
  fsm_score: number;        // mean FSM compliance [0..1]
  passes_gate: boolean;     // score >= FSM_THRESHOLD (9109/9919)
  threshold: number;
  authority: false;
}

/** Extract W32/Voynich token candidates from a sample line */
function extractTokens(line: string): string[] {
  try {
    const obj = JSON.parse(line);
    // Collect any string fields that look like booLang W32 output
    // (future: xmr_supervisor emits a `w32_tokens` field per sample)
    const candidates: string[] = [];
    if (Array.isArray(obj.w32_tokens)) candidates.push(...obj.w32_tokens);
    if (typeof obj.voynich_output === "string") candidates.push(obj.voynich_output);
    return candidates;
  } catch {
    return [];
  }
}

async function emitHealthRecord(tokens: string[], run_id: string): Promise<void> {
  if (tokens.length === 0) return;

  const record: HealthRecord = {
    ts: Date.now(),
    run_id,
    tokens_scored: tokens.length,
    fsm_score: scoreOutput(tokens),
    passes_gate: false,
    threshold: FSM_THRESHOLD,
    authority: false,
  };
  record.passes_gate = record.fsm_score >= FSM_THRESHOLD;

  await Deno.writeTextFile(HEALTH_FILE, JSON.stringify(record) + "\n", { append: true });
  console.log(
    `[voynich-health] run=${run_id} score=${record.fsm_score.toFixed(4)} ` +
    `gate=${record.passes_gate ? "PASS" : "FAIL"} tokens=${tokens.length}`
  );
}

async function deriveRunId(tokens: string[]): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(tokens.join("|")));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `BLID_health_${hex}`;
}

async function main() {
  const allTokens: string[] = [];

  try {
    const content = await Deno.readTextFile(SAMPLES_FILE);
    for (const line of content.split("\n").filter(Boolean)) {
      allTokens.push(...extractTokens(line));
    }
  } catch {
    console.log("[voynich-health] no samples file yet — nothing to score");
    return;
  }

  const run_id = await deriveRunId(allTokens);
  await emitHealthRecord(allTokens, run_id);
}

main();
