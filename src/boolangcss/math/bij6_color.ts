/**
 * bij6_color.ts — RGB color encoding via Bij6.
 * Colors are specified as {r, g, b} each in [1,6] — Bij6 digits, no zero.
 * Encodes to: "#rrggbb" CSS hex, where each channel = Math.round((d-1)/5 * 255).
 *
 * Validation delegates to nonceToBij6/bij6ToNonce roundtrip from booLang-hardening.
 */
import { nonceToBij6, bij6ToNonce } from "../../../../booLang-hardening/bij6.ts";

export interface Bij6Color {
  r: number;   // digit 1-6
  g: number;   // digit 1-6
  b: number;   // digit 1-6
}

function validateDigit(d: number, channel: string): void {
  if (!Number.isInteger(d) || d < 1 || d > 6) {
    throw new RangeError(`Bij6Color: ${channel}=${d} out of range [1,6]`);
  }
  const state = nonceToBij6(d);
  const back  = bij6ToNonce(state);
  if (back !== d) {
    throw new RangeError(`Bij6Color: ${channel}=${d} failed Bij6 roundtrip (got ${back})`);
  }
}

function digitToHex(d: number): string {
  const byte = Math.round((d - 1) / 5 * 255);
  return byte.toString(16).padStart(2, "0");
}

export function bij6ColorToCSS(c: Bij6Color): string {
  validateDigit(c.r, "r");
  validateDigit(c.g, "g");
  validateDigit(c.b, "b");
  return `#${digitToHex(c.r)}${digitToHex(c.g)}${digitToHex(c.b)}`;
}

/** Parse "bij6(r:4 g:3 b:5)" → Bij6Color */
export function parseBij6Color(raw: string): Bij6Color {
  const m = raw.match(/bij6\s*\(\s*r:([1-6])\s+g:([1-6])\s+b:([1-6])\s*\)/);
  if (!m) throw new SyntaxError(`Invalid bij6 color: "${raw}"`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}
