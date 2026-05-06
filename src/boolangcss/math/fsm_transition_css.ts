/**
 * fsm_transition_css.ts — CSS transition property constrained to valid Linear A FSM transitions.
 *
 * "transition: fsm(ONSET→BODY)" in .blcss declares a transition that must be
 * one of the 8 valid Linear A state transitions.
 *
 * Mapping: FSM transition → CSS easing + duration pair
 *   ONSET→BODY   → ease-out 300ms
 *   BODY→BODY    → linear   300ms
 *   ONSET→ONSET  → linear   400ms
 *   BODY→ONSET   → ease     250ms
 *   ONSET→MIXED  → ease-out 350ms
 *   BODY→MIXED   → ease-out 280ms
 *   MIXED→BODY   → ease-in  200ms
 *   MIXED→ONSET  → ease-in  200ms
 */
import { VALID_TRANSITIONS } from "../../../spec/linear-a-fsm-validator.ts";

const FSM_TO_CSS: Record<string, string> = {
  "ONSET→BODY":  "ease-out 300ms",
  "ONSET→ONSET": "linear 400ms",
  "BODY→BODY":   "linear 300ms",
  "BODY→ONSET":  "ease 250ms",
  "ONSET→MIXED": "ease-out 350ms",
  "BODY→MIXED":  "ease-out 280ms",
  "MIXED→BODY":  "ease-in 200ms",
  "MIXED→ONSET": "ease-in 200ms",
};

/** Parse "fsm(ONSET→BODY)" → CSS transition timing string */
export function parseFsmTransition(raw: string, prop = "all"): string {
  const m = raw.match(/fsm\s*\(\s*([A-Z]+→[A-Z]+)\s*\)/);
  if (!m) throw new SyntaxError(`Invalid fsm() value: "${raw}"`);
  const t = m[1];
  if (!VALID_TRANSITIONS.has(t)) {
    throw new RangeError(`fsm(${t}) is not a valid Linear A FSM transition`);
  }
  const timing = FSM_TO_CSS[t] ?? "linear 300ms";
  return `${prop} ${timing}`;
}
