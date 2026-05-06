/**
 * light_length_size.ts — font-size encoding via light-length tiers.
 * ll(0) = reset (initial), ll(1)-ll(4) = 1em-4em, ll(5) = 100vw (full expansion).
 * n ∈ [0,5] (light_length.ts magnitude domain).
 */

const TIER_TO_CSS: Record<number, string> = {
  0: "initial",
  1: "1em",
  2: "2em",
  3: "3em",
  4: "4em",
  5: "100vw",
};

/** Parse "ll(n)" → CSS font-size string */
export function parseLightLengthSize(raw: string): string {
  const m = raw.match(/ll\s*\(\s*(\d)\s*\)/);
  if (!m) throw new SyntaxError(`Invalid ll() value: "${raw}"`);
  const n = Number(m[1]);
  if (n < 0 || n > 5) throw new RangeError(`ll(${n}) out of range [0,5]`);
  return TIER_TO_CSS[n];
}

/** Validate n is in light-length magnitude domain [0,5] */
export function isValidLightLengthN(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 5;
}
