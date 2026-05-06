/**
 * linear-a-fsm-validator.ts — Pure FSM compliance scorer for Linear A sign groups.
 * Spec: spec/linear-a-fsm.yaml
 * No network deps. Deno-compatible.
 *
 * A Linear A token is a dot-separated sign group: "sign1.sign2.sign3"
 * Each sign maps to a state (ONSET / BODY / CODA / MIXED).
 * Score = valid_state_transitions / total_state_transitions within the group.
 */

// ── Sign → State map (loaded from corpus/analysis/sign-index.json) ────────────
interface SignIndexEntry {
  compactIndex:  number;
  canonicalByte: number | null;
  state:         "ONSET" | "BODY" | "CODA" | "MIXED";
}

function loadSignStates(): Map<string, "ONSET" | "BODY" | "CODA" | "MIXED"> {
  const indexPath = decodeURIComponent(
    new URL("../corpus/analysis/sign-index.json", import.meta.url).pathname
  );
  const raw = Deno.readTextFileSync(indexPath);
  const index = JSON.parse(raw) as Record<string, SignIndexEntry>;
  const map = new Map<string, "ONSET" | "BODY" | "CODA" | "MIXED">();
  for (const [sign, entry] of Object.entries(index)) {
    map.set(sign, entry.state);
  }
  return map;
}

export const SIGN_STATES: Map<string, "ONSET" | "BODY" | "CODA" | "MIXED"> = loadSignStates();

// ── Valid state transitions (from spec/linear-a-fsm.yaml, 90% coverage gate) ──
// These 8 transitions account for 3631/3980 = 91.2% of all corpus bigrams.
export const VALID_TRANSITIONS = new Set<string>([
  "ONSET→ONSET",
  "BODY→BODY",
  "ONSET→BODY",
  "BODY→ONSET",
  "ONSET→MIXED",
  "BODY→MIXED",
  "MIXED→BODY",
  "MIXED→ONSET",
]);

// ── Governor ratio — empirically derived from corpus bigram statistics ─────────
// 3631 out of 3980 total bigram transitions fall within the valid transition set
// at the 90% coverage inflection point. No Linear B assumptions.
export const FSM_THRESHOLD = 3631 / 3980;

// ── Tokenise a Linear A sign group into FSM states ───────────────────────────
function tokeniseStates(token: string): Array<"ONSET" | "BODY" | "CODA" | "MIXED"> {
  const signs = token.split(".").map(s => s.trim()).filter(s => s.length > 0);
  return signs.map(sign => SIGN_STATES.get(sign) ?? "MIXED");
}

/**
 * Score a single Linear A sign group for FSM compliance.
 * Token format: "sign1.sign2.sign3" (dot-separated sign tokens)
 * Returns [0.0 .. 1.0]. 1.0 = every transition is valid per spec.
 */
export function scoreFSM(token: string): number {
  const states = tokeniseStates(token);
  if (states.length < 2) return 0;
  let valid = 0;
  for (let i = 0; i < states.length - 1; i++) {
    const key = `${states[i]}→${states[i + 1]}`;
    if (VALID_TRANSITIONS.has(key)) valid++;
  }
  return valid / (states.length - 1);
}

/**
 * Score a compiled output (array of sign group tokens).
 * Returns mean FSM compliance across all tokens.
 */
export function scoreOutput(tokens: string[]): number {
  if (tokens.length === 0) return 0;
  return tokens.reduce((acc, t) => acc + scoreFSM(t), 0) / tokens.length;
}

/**
 * Returns true if the output meets the Linear A health gate.
 */
export function passesHealthGate(tokens: string[]): boolean {
  return scoreOutput(tokens) >= FSM_THRESHOLD;
}
