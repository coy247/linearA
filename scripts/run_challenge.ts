#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * run_challenge.ts — Orchestrates the full Hermes decipherment challenge.
 *
 * Runs all languages in difficulty order (hardest → easiest).
 * Sequential — Ollama is a single-inference queue; parallelism = contention.
 * Fire-and-forget: no user prompts, no permission stops.
 *
 * PENALTY RULE: any process that halts and requests human input is penalized
 * -0.05 SAS added to the ledger for that language. Implemented as a catch-all
 * on any thrown error that contains "permission", "confirm", or "input".
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-net scripts/run_challenge.ts
 *   deno run --allow-read --allow-write --allow-net scripts/run_challenge.ts \
 *     --model gemma4-hermes:latest
 */

import { DIFFICULTY_QUEUE, runHermesDecipher, computeSAS, type ScoreLedger } from "./hermes_decipher.ts";

const PENALTY_DELTA = -0.05;

const args = Object.fromEntries(
  Deno.args.flatMap((a, i, arr) => a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])
);
const model   = args["model"] ?? "hermes-local:latest";
const startAt = args["start"] ?? DIFFICULTY_QUEUE[0].id;

// ── Penalty writer ────────────────────────────────────────────────────────────

function writePenalty(corpusId: string, reason: string) {
  const ledger: ScoreLedger = JSON.parse(Deno.readTextFileSync("data/scores/ledger.json"));
  const prevEntries = ledger.entries.filter(e => e.corpusId === corpusId);
  const previousSas = prevEntries.length > 0 ? prevEntries[prevEntries.length - 1].sas : null;
  const penaltySas  = (previousSas ?? 0.5) + PENALTY_DELTA;

  ledger.entries.push({
    runId:              `${corpusId}_PENALTY_${Date.now()}`,
    corpusId,
    runAt:              new Date().toISOString(),
    model:              "PENALTY",
    sas:                parseFloat(Math.max(0, penaltySas).toFixed(6)),
    previousSas,
    delta:              PENALTY_DELTA,
    governorRatio:      0,
    bij6Slot:           1,
    bij6Hex:            "0x00",
    canonicalDistance:  1,
    entropy:            0,
    signGroupsProposed: 0,
    hermesConfidence:   0,
    hermesReasoning:    `PENALTY: ${reason}`,
    tokensPerSecond:    0,
    durationMs:         0,
    beatPrevious:       false,
    solvedThisRun:      false,
  });

  Deno.writeTextFileSync("data/scores/ledger.json", JSON.stringify(ledger, null, 2));
  console.error(`\n  !! PENALTY applied to ${corpusId}: -0.05 SAS`);
  console.error(`  !! Reason: ${reason}`);
}

// ── Summary printer ───────────────────────────────────────────────────────────

interface RunResult {
  id:       string;
  name:     string;
  sas:      number | null;
  baseline: number;
  delta:    number | null;
  solved:   boolean;
  tps:      number;
  ms:       number;
  error:    string | null;
}

function printSummary(results: RunResult[]) {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("  HERMES CHALLENGE — FINAL RESULTS");
  console.log("  SAS threshold for SOLVED: 0.85");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const header = `${"Script".padEnd(26)} ${"Baseline".padStart(8)} ${"Hermes".padStart(8)} ${"Delta".padStart(8)} ${"tok/s".padStart(6)} ${"Status".padStart(14)}`;
  console.log(header);
  console.log("─".repeat(header.length));

  for (const r of results) {
    const sasStr  = r.sas !== null ? r.sas.toFixed(4) : "ERROR ";
    const dStr    = r.delta !== null ? (r.delta > 0 ? "+" : "") + r.delta.toFixed(4) : "  —   ";
    const status  = r.error
      ? "FAILED"
      : r.solved
        ? "*** SOLVED ***"
        : r.sas !== null && r.sas > r.baseline
          ? "improved"
          : "no gain";
    const tpsStr  = r.tps > 0 ? String(r.tps) : "—";
    console.log(
      `${r.name.padEnd(26)} ${r.baseline.toFixed(4).padStart(8)} ${sasStr.padStart(8)} ${dStr.padStart(8)} ${tpsStr.padStart(6)}  ${status}`
    );
    if (r.error) console.log(`  Error: ${r.error}`);
  }

  const solved = results.filter(r => r.solved).length;
  console.log(`\n  Solved: ${solved}/${results.length} languages`);
  if (solved > 0) {
    console.log("  Solved languages are no longer undeciphered — see data/scores/ledger.json");
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  // Find start index
  const startIdx = DIFFICULTY_QUEUE.findIndex(q => q.id === startAt);
  if (startIdx === -1) {
    console.error(`Unknown start id: ${startAt}`);
    Deno.exit(1);
  }

  const queue = DIFFICULTY_QUEUE.slice(startIdx);
  console.log(`\n╔═══ Hermes Challenge: ${queue.length} languages queued ═══╗`);
  console.log(`  Model: ${model}`);
  console.log(`  Order: ${queue.map(q => q.id).join(" → ")}`);
  console.log(`  Penalty: -0.05 SAS per interruption attempt`);
  console.log(`  Started: ${new Date().toISOString()}\n`);

  // Load baselines from ledger
  const ledger: ScoreLedger & { baselines?: Array<{ corpusId: string; sas: number }> } =
    JSON.parse(Deno.readTextFileSync("data/scores/ledger.json"));
  const baselineMap = new Map<string, number>(
    (ledger.baselines ?? []).map(b => [b.corpusId, b.sas])
  );

  const results: RunResult[] = [];

  for (const script of queue) {
    const corpusFile = `corpus/${script.id}/${script.id}_flat.txt`;
    const baseline   = baselineMap.get(script.id) ?? 0;

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  [${results.length + 1}/${queue.length}] ${script.name}`);
    console.log(`  Difficulty: ${script.difficulty}/6 — ${script.difficultyReason}`);
    console.log(`  Baseline SAS: ${baseline.toFixed(4)}`);
    console.log(`  Corpus: ${corpusFile}`);
    console.log(`  Started: ${new Date().toISOString()}`);

    // Check corpus exists
    try { Deno.statSync(corpusFile); } catch {
      const msg = `corpus file not found: ${corpusFile}`;
      writePenalty(script.id, msg);
      results.push({ id: script.id, name: script.name, sas: null, baseline, delta: null, solved: false, tps: 0, ms: 0, error: msg });
      continue;
    }

    const corpusText = Deno.readTextFileSync(corpusFile);
    const t0 = Date.now();

    try {
      const entry = await runHermesDecipher({
        id: script.id,
        corpusText,
        model,
        force: false,
        verbose: true,
      });

      const ms = Date.now() - t0;
      results.push({
        id:       script.id,
        name:     script.name,
        sas:      entry.sas,
        baseline,
        delta:    entry.sas - baseline,
        solved:   entry.solvedThisRun,
        tps:      entry.tokensPerSecond,
        ms,
        error:    null,
      });

      console.log(`  Completed: ${new Date().toISOString()}  (${(ms / 1000).toFixed(0)}s)`);
      console.log(`  SAS: ${entry.sas.toFixed(4)}  Δ vs baseline: ${(entry.sas - baseline > 0 ? "+" : "")}${(entry.sas - baseline).toFixed(4)}`);
      if (entry.solvedThisRun) {
        console.log(`\n  ████  SOLVED: ${script.name} is no longer undeciphered  ████`);
        console.log(`  SAS ${entry.sas.toFixed(4)} >= 0.85 threshold`);
        console.log(`  Solved at: ${entry.runAt}`);
      }

    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const isInterruptAttempt = /permission|confirm|input|prompt|stdin/i.test(msg);
      if (isInterruptAttempt) {
        writePenalty(script.id, msg);
      }
      results.push({ id: script.id, name: script.name, sas: null, baseline, delta: null, solved: false, tps: 0, ms: Date.now() - t0, error: msg });
      console.error(`  FAILED: ${msg}`);
      // Continue to next language regardless
    }
  }

  printSummary(results);

  // Regenerate comparison matrix
  console.log("\nRegenerating language comparison matrix...");
  try {
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-read", "--allow-write", "scripts/compare_languages.ts"],
      stdout: "inherit",
      stderr: "inherit",
    });
    await cmd.output();
  } catch { /* non-fatal */ }
}

main();
