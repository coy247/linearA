/**
 * canonical_octet_test.ts — exhaustive proof of 256→136 canonical collapse
 *
 * This test suite is a structural proof, not a sample check.
 * It covers every byte value and every invariant — if any test fails,
 * the reduction claim is false and the module must be corrected.
 */

import { assertEquals, assertMatch, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bitReverse8,
  canonicalOctet,
  canonicalToBij6,
  bij6ToCanonical,
  mintOctetBLID,
  canonicalFingerprint,
  canonicalScore,
  OCTET_PALINDROMES,
  OCTET_CANONICAL_COUNT,
  OCTET_SENTINEL,
} from "./canonical_octet.ts";

// ── bitReverse8 ───────────────────────────────────────────────────────────────

Deno.test("bitReverse8: involution — bitReverse8(bitReverse8(b)) == b for all 256 values", () => {
  for (let b = 0; b < 256; b++) {
    assertEquals(
      bitReverse8(bitReverse8(b)), b,
      `involution failed at b=0x${b.toString(16).padStart(2, "0")}`,
    );
  }
});

Deno.test("bitReverse8: spot checks — known byte reversals", () => {
  // 0b10000000 (0x80) ↔ 0b00000001 (0x01)
  assertEquals(bitReverse8(0x80), 0x01);
  assertEquals(bitReverse8(0x01), 0x80);
  // 0b11110000 (0xF0) ↔ 0b00001111 (0x0F)
  assertEquals(bitReverse8(0xF0), 0x0F);
  assertEquals(bitReverse8(0x0F), 0xF0);
  // 0b10110100 (0xB4) ↔ 0b00101101 (0x2D)
  assertEquals(bitReverse8(0xB4), 0x2D);
  assertEquals(bitReverse8(0x2D), 0xB4);
});

Deno.test("bitReverse8: output always in 0..255", () => {
  for (let b = 0; b < 256; b++) {
    const r = bitReverse8(b);
    assert(
      r >= 0 && r <= 255 && Number.isInteger(r),
      `out of range at b=${b}: got ${r}`,
    );
  }
});

// ── Palindromes ───────────────────────────────────────────────────────────────

Deno.test("OCTET_PALINDROMES: exactly 16 fixed points", () => {
  assertEquals(OCTET_PALINDROMES.length, 16);
});

Deno.test("OCTET_PALINDROMES: all are genuine fixed points (bitReverse8(b) == b)", () => {
  for (const b of OCTET_PALINDROMES) {
    assertEquals(
      bitReverse8(b), b,
      `palindrome 0x${b.toString(16)} is not a fixed point`,
    );
  }
});

Deno.test("OCTET_PALINDROMES: includes sentinel 0x00 and boundary 0xFF", () => {
  assert(OCTET_PALINDROMES.includes(OCTET_SENTINEL));
  assert(OCTET_PALINDROMES.includes(0xFF));
});

Deno.test("OCTET_PALINDROMES: no duplicates, no non-palindromes", () => {
  const seen = new Set<number>();
  for (const b of OCTET_PALINDROMES) {
    assert(!seen.has(b), `duplicate palindrome: 0x${b.toString(16)}`);
    assertEquals(bitReverse8(b), b);
    seen.add(b);
  }
});

// ── canonicalOctet ────────────────────────────────────────────────────────────

Deno.test("canonicalOctet: symmetry — canonical(b) == canonical(bitReverse8(b)) for all 256", () => {
  for (let b = 0; b < 256; b++) {
    const c1 = canonicalOctet(b);
    const c2 = canonicalOctet(bitReverse8(b));
    assertEquals(
      c1, c2,
      `symmetry failed at b=0x${b.toString(16).padStart(2, "0")}: canonical=${c1} vs mirror-canonical=${c2}`,
    );
  }
});

Deno.test("canonicalOctet: canonical(b) <= b always (canonical is the minimum)", () => {
  for (let b = 0; b < 256; b++) {
    assert(
      canonicalOctet(b) <= b,
      `canonical(${b}) = ${canonicalOctet(b)} > b — not minimal`,
    );
  }
});

Deno.test("canonicalOctet: idempotent — canonical(canonical(b)) == canonical(b)", () => {
  for (let b = 0; b < 256; b++) {
    const c = canonicalOctet(b);
    assertEquals(
      canonicalOctet(c), c,
      `idempotency failed at b=${b}: canonical(canonical(b))=${canonicalOctet(c)} != ${c}`,
    );
  }
});

Deno.test("canonicalOctet: PROOF — exactly 136 distinct canonical forms across all 256 bytes", () => {
  const forms = new Set<number>();
  for (let b = 0; b < 256; b++) forms.add(canonicalOctet(b));
  assertEquals(forms.size, OCTET_CANONICAL_COUNT); // 16 palindromes + 120 mirror-pair reps = 136
});

Deno.test("canonicalOctet: palindromes are their own canonical forms", () => {
  for (const b of OCTET_PALINDROMES) {
    assertEquals(
      canonicalOctet(b), b,
      `palindrome 0x${b.toString(16)} should be its own canonical`,
    );
  }
});

Deno.test("canonicalOctet: sentinel 0x00 maps to 0 (quarantine identity preserved)", () => {
  assertEquals(canonicalOctet(OCTET_SENTINEL), 0);
});

// ── Bij6 encode/decode ────────────────────────────────────────────────────────

Deno.test("canonicalToBij6: no digit '0' in any output for all 136 canonical forms", () => {
  const forms = new Set<number>();
  for (let b = 0; b < 256; b++) forms.add(canonicalOctet(b));
  for (const c of forms) {
    if (c === 0) continue; // sentinel
    const bij6 = canonicalToBij6(c);
    assert(
      !bij6.includes("0"),
      `Bij6 output contains '0' for canonical=${c}: "${bij6}"`,
    );
  }
});

Deno.test("bij6ToCanonical: round-trip for all 136 canonical forms", () => {
  const forms = new Set<number>();
  for (let b = 0; b < 256; b++) forms.add(canonicalOctet(b));
  for (const c of forms) {
    if (c === 0) continue;
    const enc = canonicalToBij6(c);
    const dec = bij6ToCanonical(enc);
    assertEquals(dec, c, `round-trip failed for canonical=${c}: "${enc}" → ${dec}`);
  }
});

Deno.test("canonicalToBij6: output length 1–3 digits for all non-sentinel canonical forms", () => {
  const forms = new Set<number>();
  for (let b = 0; b < 256; b++) forms.add(canonicalOctet(b));
  for (const c of forms) {
    if (c === 0) continue;
    const enc = canonicalToBij6(c);
    assert(
      enc.length >= 1 && enc.length <= 3,
      `unexpected length ${enc.length} for canonical=${c}: "${enc}"`,
    );
  }
});

Deno.test("canonicalToBij6: sentinel 0 encodes as ∅", () => {
  assertEquals(canonicalToBij6(0), "∅");
  assertEquals(bij6ToCanonical("∅"), 0);
});

// ── mintOctetBLID ─────────────────────────────────────────────────────────────

Deno.test("mintOctetBLID: format matches BLID2_octet_{bij6}_{hash12}", async () => {
  const blid = await mintOctetBLID(0x80);
  assertMatch(blid, /^BLID2_octet_([1-6]{1,3}|∅)_[0-9a-f]{12}$/);
});

Deno.test("mintOctetBLID: PROOF — all 256 input bytes map to exactly 136 distinct BLIDs", async () => {
  const blidSet = new Set<string>();
  for (let b = 0; b < 256; b++) {
    blidSet.add(await mintOctetBLID(b));
  }
  assertEquals(blidSet.size, OCTET_CANONICAL_COUNT);
});

Deno.test("mintOctetBLID: mirror symmetry — b and bitReverse8(b) produce the same BLID", async () => {
  for (let b = 0; b < 256; b++) {
    const mirror = bitReverse8(b);
    if (mirror === b) continue; // palindrome, skip
    const blid1 = await mintOctetBLID(b);
    const blid2 = await mintOctetBLID(mirror);
    assertEquals(
      blid1, blid2,
      `mirror pair 0x${b.toString(16)} / 0x${mirror.toString(16)} → different BLIDs`,
    );
  }
});

Deno.test("mintOctetBLID: palindromes produce 16 unique BLIDs (no two share a BLID)", async () => {
  const palindromeBLIDs = new Set<string>();
  for (const b of OCTET_PALINDROMES) {
    const blid = await mintOctetBLID(b);
    assert(
      !palindromeBLIDs.has(blid),
      `palindrome 0x${b.toString(16)} shares BLID with another palindrome`,
    );
    palindromeBLIDs.add(blid);
  }
  assertEquals(palindromeBLIDs.size, 16);
});

Deno.test("mintOctetBLID: 0x00 encodes as sentinel ∅, distinct from 0xFF", async () => {
  const blid00 = await mintOctetBLID(0x00);
  const blidFF = await mintOctetBLID(0xFF);
  assert(blid00 !== blidFF, "0x00 and 0xFF must have different BLIDs");
  assert(blid00.includes("∅"), `0x00 should encode as sentinel ∅, got: ${blid00}`);
});

// ── canonicalFingerprint ──────────────────────────────────────────────────────

Deno.test("canonicalFingerprint: output is 14 hex chars (7 bytes × 2 hex digits)", () => {
  const fp = canonicalFingerprint("a3b4c5d6e7f80910a1b2");
  assertEquals(fp.length, 14);
});

Deno.test("canonicalFingerprint: deterministic — same input always produces same fingerprint", () => {
  const blid = "a3b4c5d6e7f80910a1b2c3d4";
  assertEquals(canonicalFingerprint(blid), canonicalFingerprint(blid));
});

Deno.test("canonicalFingerprint: mirror bytes produce same fingerprint as original bytes", () => {
  // 0x80 ↔ 0x01 are a mirror pair; both canonicalize to 0x01
  const blid1 = "80" + "1234567890abcdef1234";
  const blid2 = "01" + "1234567890abcdef1234";
  assertEquals(canonicalFingerprint(blid1), canonicalFingerprint(blid2));
});

// ── canonicalScore ────────────────────────────────────────────────────────────

Deno.test("canonicalScore: output length matches input length", () => {
  const input = new Uint8Array([0x80, 0xF0, 0xB4, 0x00, 0xFF, 0x01, 0x0F]);
  const out   = canonicalScore(input);
  assertEquals(out.length, input.length);
});

Deno.test("canonicalScore: each output byte is canonical form of input byte", () => {
  const input = new Uint8Array([0x80, 0xF0, 0xB4, 0xFF, 0x01]);
  const out   = canonicalScore(input);
  for (let i = 0; i < input.length; i++) {
    assertEquals(
      out[i], canonicalOctet(input[i]),
      `byte ${i}: expected canonical(0x${input[i].toString(16)})=${canonicalOctet(input[i])}, got ${out[i]}`,
    );
  }
});

Deno.test("canonicalScore: mirrored input and direct input produce identical output", () => {
  const input  = new Uint8Array([0x80, 0x40, 0xF0, 0x0A]);
  const mirror = new Uint8Array(input.map(b => bitReverse8(b)));
  assertEquals(Array.from(canonicalScore(input)), Array.from(canonicalScore(mirror)));
});

// ── Space reduction proof (structural summary) ────────────────────────────────

Deno.test("PROOF — 256 byte values → 136 canonical forms → 120 representations eliminated", () => {
  const eliminated = 256 - OCTET_CANONICAL_COUNT; // 120
  assertEquals(eliminated, 120);

  // Verify: exactly 120 bytes are NOT their own canonical representative
  let nonCanonical = 0;
  for (let b = 0; b < 256; b++) {
    if (canonicalOctet(b) !== b) nonCanonical++;
  }
  assertEquals(nonCanonical, 120);

  // Verify: non-palindromes form 120 symmetric pairs
  const nonPalindromes = new Set<number>();
  for (let b = 0; b < 256; b++) {
    if (bitReverse8(b) !== b) nonPalindromes.add(b);
  }
  assertEquals(nonPalindromes.size, 240);        // 240 / 2 = 120 pairs

  // Verify: palindromes + canonical non-palindromes = 136
  assertEquals(16 + 240 / 2, OCTET_CANONICAL_COUNT);
});
