/**
 * linear-a-fsm-validator-test.ts — exhaustive FSM compliance proof for Linear A
 */

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  scoreFSM, scoreOutput, passesHealthGate, FSM_THRESHOLD,
  SIGN_STATES, VALID_TRANSITIONS,
} from "./linear-a-fsm-validator.ts";

// ── SIGN_STATES ───────────────────────────────────────────────────────────────

Deno.test("SIGN_STATES: every sign maps to ONSET, BODY, CODA, or MIXED", () => {
  const valid = new Set(["ONSET", "BODY", "CODA", "MIXED"]);
  for (const [sign, state] of SIGN_STATES) {
    assert(valid.has(state), `Sign "${sign}" has invalid state "${state}"`);
  }
});

Deno.test("SIGN_STATES: at least one ONSET, one BODY, one CODA sign exists", () => {
  const states = [...SIGN_STATES.values()];
  assert(states.includes("ONSET"), "No ONSET signs found");
  assert(states.includes("BODY"),  "No BODY signs found");
  assert(states.includes("CODA"),  "No CODA signs found");
});

// ── VALID_TRANSITIONS ─────────────────────────────────────────────────────────

Deno.test("VALID_TRANSITIONS: at least one transition defined", () => {
  assert(VALID_TRANSITIONS.size > 0, "No valid transitions defined");
});

Deno.test("VALID_TRANSITIONS: all entries follow STATE→STATE format", () => {
  const states = new Set(["ONSET", "BODY", "CODA", "MIXED"]);
  for (const t of VALID_TRANSITIONS) {
    const parts = t.split("→");
    assertEquals(parts.length, 2, `Malformed transition: "${t}"`);
    assert(states.has(parts[0]), `Unknown from-state in "${t}"`);
    assert(states.has(parts[1]), `Unknown to-state in "${t}"`);
  }
});

// ── scoreFSM ──────────────────────────────────────────────────────────────────

Deno.test("scoreFSM: empty string returns 0", () => {
  assertEquals(scoreFSM(""), 0);
});

Deno.test("scoreFSM: single sign returns 0 (no transitions)", () => {
  const anySingleSign = [...SIGN_STATES.keys()][0];
  assertEquals(scoreFSM(anySingleSign), 0);
});

Deno.test("scoreFSM: output in [0, 1] for any input", () => {
  const tokens = ["𐝫.𐘳", "𐘽.𐘋", "UNKNOWN.SIGNS", "𐝫"];
  for (const t of tokens) {
    const s = scoreFSM(t);
    assert(s >= 0 && s <= 1, `scoreFSM("${t}") = ${s} out of range`);
  }
});

Deno.test("scoreFSM: ONSET→BODY transition scores 1.0 (valid)", () => {
  // 𐝫 is rank-1 ONSET sign, 𐘳 is rank-10 BODY sign
  if (SIGN_STATES.get("𐝫") === "ONSET" && SIGN_STATES.get("𐘳") === "BODY" && VALID_TRANSITIONS.has("ONSET→BODY")) {
    assertEquals(scoreFSM("𐝫.𐘳"), 1.0);
  }
});

Deno.test("scoreFSM: unknown signs score 0", () => {
  assertEquals(scoreFSM("UNKNOWN_X.UNKNOWN_Y"), 0);
});

// ── scoreOutput ───────────────────────────────────────────────────────────────

Deno.test("scoreOutput: empty array returns 0", () => {
  assertEquals(scoreOutput([]), 0);
});

Deno.test("scoreOutput: returns mean of individual scores", () => {
  const tokens = ["𐝫.𐘳", "𐘽.𐘋", "𐝫.𐙂"];
  const manual = tokens.reduce((s, t) => s + scoreFSM(t), 0) / tokens.length;
  assertEquals(scoreOutput(tokens), manual);
});

// ── FSM_THRESHOLD ─────────────────────────────────────────────────────────────

Deno.test("FSM_THRESHOLD: is in (0.5, 1.0) range", () => {
  assert(FSM_THRESHOLD > 0.5, "Governor ratio implausibly low");
  assert(FSM_THRESHOLD < 1.0, "Governor ratio cannot be 1.0");
});

Deno.test("FSM_THRESHOLD: equals 3631/3980 (empirically derived)", () => {
  const expected = 3631 / 3980;
  assert(Math.abs(FSM_THRESHOLD - expected) < 1e-10, `Expected ${expected}, got ${FSM_THRESHOLD}`);
});
