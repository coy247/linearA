#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * derive_fsm.ts — Derive Linear A FSM spec from corpus analysis.
 *
 * Reads:
 *   corpus/analysis/sign-frequency.json
 *   corpus/analysis/bigram-matrix.json
 * Writes:
 *   spec/linear-a-fsm.yaml
 *
 * Algorithm:
 *   1. Load state aggregates (state transition totals)
 *   2. Sort by count descending
 *   3. Include state transitions that appear in the top COVERAGE_TARGET of total mass
 *   4. Compute governor ratio = included_count / total_count
 *   5. Write FSM spec with motif lists, valid transitions, and governor ratio
 */

import type { SignFreq } from "./analyze_signs.ts";

const REPO_ROOT   = decodeURIComponent(new URL("../", import.meta.url).pathname);
const FREQ_FILE   = `${REPO_ROOT}corpus/analysis/sign-frequency.json`;
const BIGRAM_FILE = `${REPO_ROOT}corpus/analysis/bigram-matrix.json`;
const FSM_OUT     = `${REPO_ROOT}spec/linear-a-fsm.yaml`;

// Target: include transitions that account for this fraction of total bigram mass.
const COVERAGE_TARGET = 0.90;

interface StateAggregate {
  stateTransition: string;
  totalCount:      number;
  pct:             number;
}

interface BigramData {
  stateAggregates: StateAggregate[];
}

async function main() {
  const signFreqs: SignFreq[]  = JSON.parse(await Deno.readTextFile(FREQ_FILE));
  const bigramData: BigramData = JSON.parse(await Deno.readTextFile(BIGRAM_FILE));

  const agg = bigramData.stateAggregates;
  const grandTotal = agg.reduce((s, a) => s + a.totalCount, 0);

  // Select transitions by cumulative coverage
  let cumulative = 0;
  const selected: StateAggregate[] = [];
  for (const entry of agg) {
    selected.push(entry);
    cumulative += entry.totalCount;
    if (cumulative / grandTotal >= COVERAGE_TARGET) break;
  }

  const governorRatio = cumulative / grandTotal;
  const governorFraction = `${cumulative}/${grandTotal}`;

  console.log(`\nFSM Derivation`);
  console.log(`  Total bigram transitions: ${grandTotal}`);
  console.log(`  Coverage target:          ${(COVERAGE_TARGET * 100).toFixed(0)}%`);
  console.log(`  Selected transitions:     ${selected.length}`);
  console.log(`  Included count:           ${cumulative}`);
  console.log(`  Governor ratio:           ${governorFraction} = ${governorRatio.toFixed(6)}`);

  // Group signs by state for motif lists
  const byState = { ONSET: [] as SignFreq[], BODY: [] as SignFreq[], CODA: [] as SignFreq[], MIXED: [] as SignFreq[] };
  for (const sf of signFreqs) byState[sf.positionBias].push(sf);

  // Build top motifs per state (top 16 by frequency)
  const topOnset = byState.ONSET.slice(0, 16).map(sf => sf.sign);
  const topBody  = byState.BODY.slice(0, 16).map(sf => sf.sign);
  const topCoda  = byState.CODA.slice(0, 16).map(sf => sf.sign);

  // Compute corpus stats
  const totalSigns = signFreqs.reduce((s, sf) => s + sf.freqTotal, 0);

  // Build YAML
  const yaml = [
    `---`,
    `# linear-a-fsm.yaml — Canonical Linear A FSM Specification`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# Source: corpus/analysis/bigram-matrix.json`,
    `# Authority: non-authoritative (derived from corpus statistics)`,
    `# No Linear B phonetic values — signs are opaque structural tokens`,
    `---`,
    ``,
    `fsm:`,
    `  id: linear_a_word_fsm`,
    `  version: 1`,
    `  authority: non-authoritative`,
    `  description: >`,
    `    Finite-state machine describing the morphological structure of Linear A`,
    `    sign groups. Derived from positional frequency and bigram transition analysis`,
    `    of the full Linear A corpus. No phonetic assumptions from Linear B.`,
    `    A sign group is FSM-valid if its state sequence passes the governor gate.`,
    ``,
    `  corpus_stats:`,
    `    total_inscriptions: ${new Set(signFreqs.map(sf => sf.sign)).size}`,
    `    total_signs: ${totalSigns}`,
    `    unique_signs: ${signFreqs.length}`,
    `    total_bigrams: ${grandTotal}`,
    ``,
    `  states:`,
    `    - id: STATE_ONSET`,
    `      label: onset`,
    `      role: >`,
    `        Sign-group initial position. High frequency at word start.`,
    `        Structural prefix marker. Equivalent to PREFIX in Voynich FSM.`,
    `      sign_count: ${byState.ONSET.length}`,
    `      top_signs: [${topOnset.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `    - id: STATE_BODY`,
    `      label: body`,
    `      role: >`,
    `        Sign-group medial position. Core semantic carrier.`,
    `        Equivalent to CORE in Voynich FSM.`,
    `      sign_count: ${byState.BODY.length}`,
    `      top_signs: [${topBody.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `    - id: STATE_CODA`,
    `      label: coda`,
    `      role: >`,
    `        Sign-group terminal position. Morphological suffix bridge.`,
    `        Equivalent to OPERATOR in Voynich FSM.`,
    `      sign_count: ${byState.CODA.length}`,
    `      top_signs: [${topCoda.map(s => `"${s}"`).join(", ")}]`,
    ``,
    `  valid_transitions:`,
    ...selected.map(entry => {
      const [from, to] = entry.stateTransition.split("→");
      return [
        `    - from: STATE_${from}`,
        `      to:   STATE_${to}`,
        `      count: ${entry.totalCount}`,
        `      pct:   ${(entry.pct * 100).toFixed(2)}`,
      ].join("\n");
    }),
    ``,
    `  canonical_word_shape:`,
    `    pattern: STATE_ONSET → STATE_BODY → STATE_CODA → STATE_BODY → STATE_ONSET`,
    `    description: >`,
    `      The minimal complete Linear A sign group. A group that follows this`,
    `      path exactly scores 1.0 against the FSM.`,
    ``,
    `  scoring:`,
    `    method: transition_compliance_ratio`,
    `    formula: >`,
    `      score(group) = valid_transitions_in_group / total_transitions_in_group`,
    `      where a transition is valid if its state pair appears in valid_transitions.`,
    `    threshold:`,
    `      pass:  ${governorRatio.toFixed(10)}`,
    `      fraction: "${governorFraction}"`,
    `      label: "Linear A corpus governor ratio — derived from ${(COVERAGE_TARGET * 100).toFixed(0)}% coverage target"`,
    ``,
    `  sign_index_file: corpus/analysis/sign-index.json`,
    ``,
  ].join("\n");

  await Deno.mkdir(`${REPO_ROOT}spec`, { recursive: true });
  await Deno.writeTextFile(FSM_OUT, yaml);

  console.log(`\nWritten: ${FSM_OUT}`);
  console.log(`\nSelected valid state transitions:`);
  for (const s of selected) {
    console.log(`  ${s.stateTransition.padEnd(20)} ${String(s.totalCount).padStart(6)}  (${(s.pct * 100).toFixed(1)}%)`);
  }
  console.log(`\nGovernor ratio: ${governorFraction} = ${governorRatio.toFixed(6)}`);
  console.log(`\nNEXT: implement spec/linear-a-fsm-validator.ts using the values above.`);
}

main();
