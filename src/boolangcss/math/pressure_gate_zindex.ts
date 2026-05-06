/**
 * pressure_gate_zindex.ts — CSS z-index via 3-tier pressure gate formula.
 *
 * In the CSS context:
 *   x = classCount / (classCount + elementCount + 1)  — throughput proxy
 *   y = elementCount / (classCount + elementCount + 1) — overhead proxy
 *   boundary = 3x - 5y
 *
 * Three tiers:
 *   boundary > 1  → tier 2, z-index: 200  (elevated — high specificity)
 *   -1 ≤ boundary ≤ 1 → tier 1, z-index: 100  (mid)
 *   boundary < -1 → tier 0, z-index: 0   (collapsed — low specificity)
 *
 * "pg(n)" in .blcss declares intent. Compiler verifies declared tier matches
 * computed tier from the containing rule's selector structure.
 */

export type PGTier = 0 | 1 | 2;
const TIER_TO_ZINDEX: Record<PGTier, number> = { 0: 0, 1: 100, 2: 200 };

export function computePGTier(classCount: number, elementCount: number): PGTier {
  const total = classCount + elementCount + 1;
  const x = classCount  / total;
  const y = elementCount / total;
  const boundary = 3 * x - 5 * y;
  if (boundary > 1)  return 2;
  if (boundary < -1) return 0;
  return 1;
}

/** Parse "pg(n)" → tier number */
export function parsePGTier(raw: string): PGTier {
  const m = raw.match(/pg\s*\(\s*([012])\s*\)/);
  if (!m) throw new SyntaxError(`Invalid pg() value: "${raw}"`);
  return Number(m[1]) as PGTier;
}

export function pgTierToCSS(tier: PGTier): string {
  return `${TIER_TO_ZINDEX[tier]}`;
}
