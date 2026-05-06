/**
 * canonical_octet.ts — W32-gate bit-reversal normalization for octets
 *
 * The problem with raw hexadecimal:
 *   A byte b and its bit-mirror bitReverse8(b) are treated as distinct values,
 *   but in a bit-order-agnostic encoding system they carry the same structural
 *   information. This creates 240 redundant representations (120 mirror pairs × 2)
 *   that inflate comparison spaces and symbol-table surface area.
 *
 * The fix — canonical form:
 *   canonical(b) = min(b, bitReverse8(b))
 *
 *   256 raw bytes → 136 canonical forms:
 *     16 palindromes (bitReverse8(b) == b, each their own canonical)
 *     + 120 mirror pairs (each reduced to the smaller of the two)
 *   = 136 structurally distinct octet identities
 *
 * Application to Linear A encoding:
 *   Use canonicalOctet(b) as the primary key in any symbol table, frequency map,
 *   or pattern matcher that operates on individual bytes. Two bytes that are
 *   bit-mirror images of each other resolve to the same canonical entry.
 *   This reduces the effective alphabet from 256 to 136 — a 47% reduction in
 *   comparison space per byte — without information loss (raw byte stored as metadata).
 *
 * Sentinel policy:
 *   0x00 is quarantined — it is the null/boundary marker and must never be
 *   entered into a canonical symbol table. Bij6 encodes it as "∅".
 *
 * Bij6 representation:
 *   Canonical forms are encoded in Bij6 (digits 1–6, no zero).
 *   A byte's canonical value encodes to 1–3 Bij6 digit characters.
 *   Digit '0' is structurally absent — injection defense baked into the encoding.
 *
 * Fingerprint:
 *   canonicalFingerprint(hexStr) compresses a hex string to a 7-byte canonical key.
 *   7 = floor(sqrt(52)) — the minimal length giving collision resistance within
 *   one structural tick of the CIC-equivalent state space (4 phases × 13 antinodes).
 */

// ── W32 gate primitives — inlined to avoid potential circular imports ─────────
// Each maps to a single machine instruction; the one-liners are the spec.
const AND32 = (a: number, b: number): number => (a & b) >>> 0;
const OR32  = (a: number, b: number): number => (a | b) >>> 0;
const SHR32 = (a: number, n: number): number => (a >>> n) >>> 0;

// ── Fingerprint length (structural constant) ──────────────────────────────────
// floor(sqrt(4 phases × 13 canonical antinodes)) = floor(sqrt(52)) = 7
const CANONICAL_FOOTPRINT = 7;

// ── Canonical count (structural constant, not a magic number) ─────────────────
// 16 palindrome bytes + 120 mirror pairs = 136 distinct canonical forms.
// Derivation: 2^(8/2) = 16 palindromes (bits 0-3 determine bits 4-7 uniquely).
// Non-palindromes: 256 − 16 = 240 / 2 = 120 pairs. Total: 16 + 120 = 136.
export const OCTET_CANONICAL_COUNT = 136;

// ── Sentinel ──────────────────────────────────────────────────────────────────
export const OCTET_SENTINEL = 0x00;

// ── W32-gate bit reversal for a single octet ─────────────────────────────────
// Three swap passes: nibbles [7:4]↔[3:0], 2-bit groups, adjacent bits.
// Each pass uses the AND32+SHR32+OR32 triple — both halves masked so residual
// bits from adjacent groups don't contaminate the swap.
// Left shift uses (x<<n)>>>0 — arithmetic shl, single machine instruction.
export function bitReverse8(b: number): number {
  let x = AND32(b, 0xFF);
  // Pass 1 — swap nibbles: mask upper half to lower, lower half to upper
  x = OR32(AND32(SHR32(x, 4), 0x0F), AND32((x << 4) >>> 0, 0xF0));
  // Pass 2 — swap 2-bit groups: 0x33=00110011 even pairs, 0xCC=11001100 odd pairs
  x = OR32(AND32(SHR32(x, 2), 0x33), AND32((x << 2) >>> 0, 0xCC));
  // Pass 3 — swap adjacent bits: 0x55=01010101 even bits, 0xAA=10101010 odd bits
  x = OR32(AND32(SHR32(x, 1), 0x55), AND32((x << 1) >>> 0, 0xAA));
  return AND32(x, 0xFF);
}

// ── Canonical form: min(b, bitReverse8(b)) ───────────────────────────────────
// For any b: canonicalOctet(b) === canonicalOctet(bitReverse8(b)).
// 0x00 maps to 0 (the sentinel — never entered into a canonical symbol table).
export function canonicalOctet(b: number): number {
  const raw = AND32(b, 0xFF);
  const rev = bitReverse8(raw);
  return raw < rev ? raw : rev;
}

// ── The 16 palindrome bytes (canonical fixed points) ─────────────────────────
// These bytes are their own bit-reversal; bits 0–3 mirror bits 7–4.
// Includes 0x00 (sentinel) and 0xFF (all-ones).
export const OCTET_PALINDROMES: readonly number[] = (() => {
  const out: number[] = [];
  for (let b = 0; b < 256; b++) {
    if (bitReverse8(b) === b) out.push(b);
  }
  return out;
})();

// ── Bij6 encode/decode for octet canonical forms ─────────────────────────────
// Direct digit-string encoding — digits 1–6, no zero, no base-36 compression.
// A byte's canonical value ∈ {0..255}:
//   0   → sentinel "∅"  (0x00 is quarantined, never in counting system)
//   1..255 → 1–3 Bij6 digit characters (e.g. 1→"1", 42→"66", 255→"663")
export function canonicalToBij6(canonical: number): string {
  if (canonical <= 0) return "∅";
  const digits: number[] = [];
  let n = canonical;
  while (n > 0) {
    digits.push(((n - 1) % 6) + 1); // digit ∈ {1..6}, never 0
    n = Math.floor((n - 1) / 6);
  }
  return digits.reverse().join("");
}

export function bij6ToCanonical(s: string): number {
  if (s === "∅") return 0;
  let n = 0;
  for (const ch of s) {
    n = n * 6 + parseInt(ch, 10);
  }
  return n;
}

// ── Canonical BLID ────────────────────────────────────────────────────────────
// Format: BLID2_octet_{bij6canonical}_{hash12}
// The Bij6 canonical is readable in the BLID itself — no decode required.
// hash12 covers canonical + parentBLID for chain integrity.
export async function mintOctetBLID(
  b:           number,
  parentBLID?: string,
): Promise<string> {
  const c    = canonicalOctet(b);
  const bij6 = canonicalToBij6(c);
  const raw  = `octet|${c}|${parentBLID ?? "genesis"}`;
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const h12  = Array.from(new Uint8Array(buf).slice(0, 6))
    .map(x => x.toString(16).padStart(2, "0")).join("");
  return `BLID2_octet_${bij6}_${h12}`;
}

// ── Canonical fingerprint: compact canonical hash key ─────────────────────────
// Reduces a hex string to a CANONICAL_FOOTPRINT-byte (7-byte) canonical key.
// Two hex strings that differ only in bit-mirror bytes produce the same fingerprint.
// Output: 14 lowercase hex chars (7 bytes × 2 hex digits each).
export function canonicalFingerprint(hexStr: string): string {
  const hexBytes = hexStr.slice(0, CANONICAL_FOOTPRINT * 2);
  let fp = "";
  for (let i = 0; i < hexBytes.length; i += 2) {
    const b = parseInt(hexBytes.slice(i, i + 2), 16);
    fp += canonicalOctet(b).toString(16).padStart(2, "0");
  }
  return fp;
}

// ── Canonical score for an n-byte buffer ─────────────────────────────────────
// Reduces a raw byte buffer to its canonical octet representation.
// Each byte is replaced with canonicalOctet(byte) — mirror bytes collapse to
// the same value, reducing the effective alphabet from 256 to 136 per byte.
// O(n) time, O(n) space.
export function canonicalScore(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = canonicalOctet(bytes[i]);
  }
  return out;
}
