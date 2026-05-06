import { type BlcssRule, type CSSDecl } from "./types.ts";
import { parseBij6Color, bij6ColorToCSS } from "./math/bij6_color.ts";
import { parseLightLengthSize } from "./math/light_length_size.ts";
import { parsePGTier, pgTierToCSS } from "./math/pressure_gate_zindex.ts";
import { parseFsmTransition } from "./math/fsm_transition_css.ts";

function resolveValue(property: string, raw: string): { resolvedCSS: string; valueType: CSSDecl["valueType"] } {
  const t = raw.trim();

  if (t.startsWith("bij6(")) {
    if (property === "color" || property === "background") {
      const c = parseBij6Color(t);
      return { resolvedCSS: bij6ColorToCSS(c), valueType: "bij6" };
    }
    // Numeric bij6: extract first digit as integer
    const m = t.match(/bij6\s*\(\s*(\d)\s*\)/);
    if (m) return { resolvedCSS: `${Number(m[1]) * 4}px`, valueType: "bij6" };
    throw new SyntaxError(`Unrecognized bij6 form for "${property}": "${t}"`);
  }

  if (t.startsWith("ll(")) {
    return { resolvedCSS: parseLightLengthSize(t), valueType: "ll" };
  }

  if (t.startsWith("pg(")) {
    const tier = parsePGTier(t);
    return { resolvedCSS: pgTierToCSS(tier), valueType: "pg" };
  }

  if (t.startsWith("fsm(")) {
    return { resolvedCSS: parseFsmTransition(t, property === "transition" ? "all" : property), valueType: "fsm" };
  }

  return { resolvedCSS: t, valueType: "raw" };
}

/** Parse a single "daiin property: value;" line */
function parseDecl(line: string): CSSDecl | null {
  // Accept: "daiin property: value;" or "  property: value;"
  const m = line.match(/(?:daiin\s+)?([a-z-]+)\s*:\s*(.+?)\s*;?$/);
  if (!m) return null;
  const property = m[1].trim();
  const rawValue = m[2].trim();
  const { resolvedCSS, valueType } = resolveValue(property, rawValue);
  return { property, rawValue, valueType, resolvedCSS };
}

/**
 * Parse .blcss text into BlcssRule[].
 *
 * Format:
 *   chedy selector {
 *     daiin property: value;
 *   }
 * or standard CSS-like:
 *   selector {
 *     property: value;
 *   }
 */
export function parseBlcss(source: string): BlcssRule[] {
  const rules: BlcssRule[] = [];
  const lines = source.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("//"));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Match "chedy selector {" or "selector {"
    const ruleStart = line.match(/^(?:chedy\s+)?(.+?)\s*\{/);
    if (!ruleStart) { i++; continue; }

    const selector = ruleStart[1].trim();
    const decls: CSSDecl[] = [];
    i++;

    while (i < lines.length && !lines[i].startsWith("}")) {
      const decl = parseDecl(lines[i]);
      if (decl) decls.push(decl);
      i++;
    }

    rules.push({ selector, decls });
    i++; // skip closing }
  }

  return rules;
}
