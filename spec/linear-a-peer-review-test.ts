import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runProof1, runProof2, runProof3, type ProofResult } from "./linear-a-peer-review.ts";

// ── Proof 1: MI + Bij6 slot ────────────────────────────────────────────────────

Deno.test("proof1: passes overall", () => {
  const r = runProof1();
  assert(r.passed, `Proof 1 failed: ${r.verdict}`);
});

Deno.test("proof1: MI > 0.01 bits (non-trivial structure)", () => {
  const r = runProof1();
  const mi = r.metrics["mutualInformation"] as number;
  assert(mi > 0.01, `MI = ${mi}, expected > 0.01 bits`);
});

Deno.test("proof1: linearA ratio encodes to expansion tier (digit 5 or 6)", () => {
  const r = runProof1();
  const d = r.metrics["linearABij6Digit"] as number;
  assert(d === 5 || d === 6, `linearA Bij6 digit = ${d}, expected 5 or 6`);
});

Deno.test("proof1: booLang ratio encodes to same Bij6 tier as linearA", () => {
  const r = runProof1();
  assert(
    r.metrics["sameExpansionTier"] === true,
    `Ratios map to different Bij6 tiers`
  );
});

// ── Proof 2: Permutation null test + tier isomorphism ─────────────────────────

Deno.test("proof2: passes overall", () => {
  const r = runProof2();
  assert(r.passed, `Proof 2 failed: ${r.verdict}`);
});

Deno.test("proof2: real ratio > null mean + 3*sigma (p < 0.001)", () => {
  const r = runProof2();
  const z = r.metrics["zScore"] as number;
  assert(z > 3, `z-score = ${z}, expected > 3`);
});

Deno.test("proof2: all 8 valid FSM transitions map to valid tier sequences", () => {
  const r = runProof2();
  assertEquals(r.metrics["validTierMappings"], 8);
});

Deno.test("proof2: no invalid FSM transition maps to a valid tier sequence", () => {
  const r = runProof2();
  assertEquals(r.metrics["falseValidTierMappings"], 0);
});

// ── Proof 3: Canonical octet clustering ────────────────────────────────────────

Deno.test("proof3: passes overall", () => {
  const r = runProof3();
  assert(r.passed, `Proof 3 failed: ${r.verdict}`);
});

Deno.test("proof3: BODY centroid < ONSET centroid (iterating tier clusters low)", () => {
  const r = runProof3();
  const cb = r.metrics["centroidBODY"]  as number;
  const co = r.metrics["centroidONSET"] as number;
  assert(cb < co, `C_BODY=${cb.toFixed(2)} not < C_ONSET=${co.toFixed(2)}`);
});

Deno.test("proof3: BODY centroid < CODA centroid (iterating tier clusters low)", () => {
  const r = runProof3();
  const cb = r.metrics["centroidBODY"] as number;
  const cc = r.metrics["centroidCODA"] as number;
  assert(cb < cc, `C_BODY=${cb.toFixed(2)} not < C_CODA=${cc.toFixed(2)}`);
});

Deno.test("proof3: Cohen's d > 0.5 for both ONSET-BODY and BODY-CODA pairs", () => {
  const r = runProof3();
  const dOB = r.metrics["cohenD_ONSET_BODY"] as number;
  const dBC = r.metrics["cohenD_BODY_CODA"]  as number;
  assert(dOB > 0.5, `Cohen's d ONSET-BODY = ${dOB.toFixed(3)}, expected > 0.5`);
  assert(dBC > 0.5, `Cohen's d BODY-CODA = ${dBC.toFixed(3)}, expected > 0.5`);
});
