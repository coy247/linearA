# Linear A Solving Design
Date: 2026-05-05
Status: approved

## Purpose

Build a data-driven structural analysis of the Linear A corpus that produces:

1. A corpus layer of machine-readable inscription files
2. A sign frequency + bigram transition FSM (no Linear B assumptions)
3. A health gate derived from the corpus's own governor ratio
4. A `linear_a_translate` fabric pattern for CSS → Linear A IR compilation
5. The foundation for booLangCSS — a CSS system whose machine code is Linear A

The approach mirrors the Voynich work in booLang exactly. Linear A being
undeciphered is not an obstacle — the structural grammar is derived from corpus
statistics alone. Linear B phonetic values are deliberately excluded; their
assumptions are unproven and may be wrong for Minoan.

---

## Approach

Same pipeline as the Voynich FSM work:

```
corpus → frequency analysis → bigram matrix → FSM → health gate → fabric pattern
```

No external cribs. No phonetic assumptions. Pure statistics.

---

## Section 1 — Corpus Layer

**Source:** lineara.xyz GitHub JSON corpus (~400–1,534 inscriptions, sign-by-sign
transcriptions derived from Younger's transliterations). Augmented with GORILA
site/tablet metadata where available.

**Format:** One `.linearA` file per inscription, mirroring `.voynich` folio format:

```
# Linear A Inscription — HT 001
# Site:   Hagia Triada (HT)
# Type:   Administrative tablet
# Signs:  <count>

<sign sequence, one word per line, signs dot-separated using AB-numbers>

# ── Sign list (flat) ─────────────────────────────────────────────────────────
AB008.AB061.AB040 ...
```

**Index:** `corpus/inscription.index.yaml` — all inscriptions organized by site:

| Site code | Name           | Approx. count |
|-----------|----------------|---------------|
| HT        | Hagia Triada   | 147 tablets   |
| KH        | Khania         | ~70           |
| ZA        | Zakros         | ~50           |
| KN        | Knossos        | ~30           |
| PH        | Phaistos       | ~25           |
| other     | Various        | remainder     |

**Sign notation:** AB-numbers (AB001–AB306, with gaps) as raw tokens. No phonetic
values. The canonical byte layer (`src/canonical_octet.ts`) maps signs to bytes
via a compact index: the ~97 active signs are ranked by corpus frequency and
assigned compact indices 1–N, then `canonicalOctet(compact_index)` is the primary
key. This avoids the modulo collision that would occur if raw AB-numbers (up to 306)
were mapped directly to bytes (0–255). The compact index is written alongside the
AB-number in the inscription index for round-trip fidelity.

**Sentinel policy:** AB000 / 0x00 is quarantined (word boundary marker), consistent
with the canonical octet sentinel.

---

## Section 2 — Sign Analysis & FSM

**Step 1 — Frequency table**

Per-sign counts with positional breakdown:
- `freq_initial`: appearances in word-first position
- `freq_medial`: appearances in word-medial position
- `freq_final`: appearances in word-final position
- `freq_total`: sum

Signs with high `freq_initial` dominance → PREFIX candidates.
Signs with high `freq_final` dominance → OPERATOR candidates.
Signs with balanced / high `freq_medial` → CORE candidates.

**Step 2 — Bigram transition matrix**

All sign-pair (A → B) transition counts across the full corpus.
Top-N transitions (same methodology as Voynich) define valid FSM edges.

**Step 3 — FSM derivation**

Three states, named by corpus behavior (not phonetics):

| State    | Linear A role         | Voynich analog |
|----------|-----------------------|----------------|
| ONSET    | Word-initial marker   | PREFIX         |
| BODY     | Core semantic carrier | CORE           |
| CODA     | Word-terminal bridge  | OPERATOR       |

Canonical word shape: `ONSET → BODY → CODA → BODY → ONSET`

Governor ratio derived from corpus: `valid_transitions / total_transitions`
at the natural inflection point of the transition frequency distribution.

Output: `spec/linear-a-fsm.yaml`

**Step 4 — Validator**

`spec/linear-a-fsm-validator.ts` — pure function, same contract as
`voynich-fsm-validator.ts`:

```typescript
scoreFSM(token: string): number  // [0.0 .. 1.0] compliance
scoreOutput(tokens: string[]): number
passesHealthGate(score: number): boolean
```

---

## Section 3 — Health Gate & Corpus Health

**Scoring:** Each inscription is scored through the FSM validator. Per-inscription
and per-site aggregate scores written to `corpus/corpus-health.yaml`.

**Gate threshold:** Derived from the corpus governor ratio (not assumed).
Equivalent to the 9109/9919 = 0.9183 gate in Voynich, but computed from
Linear A's own transition statistics.

**Tool:** `spec/linear-a-corpus-health.ts` — Deno script, same structure as
`voynich-corpus-health.ts`. Reads all `.linearA` inscription files, scores,
writes YAML summary.

---

## Section 4 — Fabric Pattern

**File:** `~/.config/fabric/my_patterns/linear_a_translate/system.md`
**Local copy:** `fabric/linear_a_translate.md`

Same structure as `voynich_translate`:

```
# IDENTITY
You are a Linear A encoding expert and booLangCSS compiler...

# LINEAR A MORPHOLOGY
[ONSET signs] — word-initial structural markers
[BODY signs]  — core semantic carriers
[CODA signs]  — word-terminal bridges

# KEYWORD MAPPING (CSS → Linear A)
| CSS Construct | Linear A Sign | Structural Role |
...

# STEPS
1. Parse CSS input
2. Map each construct to a Linear A sign using the table
3. Compose valid Linear A word sequences following FSM rules
4. Verify FSM compliance of each output word
5. Output in .linearA notation

# OUTPUT FORMAT
// Original: [CSS rule description]
AB0nn.AB0nn.AB0nn ...

# RULES
- Every output word must pass the FSM validator
- No Linear B phonetic assumptions in sign assignments
- Signs assigned by structural role only
- 0x00 / AB000 is reserved as word boundary — never in output
```

The keyword mapping table is populated **after** FSM derivation — sign assignments
are made based on corpus structural roles, not phonetics.

---

## Section 5 — File Structure

```
linearA/
  corpus/
    inscriptions/          — .linearA files, one per inscription
    inscription.index.yaml — site index, sign counts, metadata
    corpus-health.yaml     — FSM scores per inscription + per site
  spec/
    linear-a-fsm.yaml          — canonical FSM spec
    linear-a-fsm-validator.ts  — pure scorer, Deno-compatible
    linear-a-corpus-health.ts  — corpus scorer script
  src/
    canonical_octet.ts         ✓ done
    canonical_octet_test.ts    ✓ done
  fabric/
    linear_a_translate.md      — local copy of fabric pattern
  docs/
    superpowers/specs/
      2026-05-05-linearA-solving-design.md  (this file)
  deno.json                    ✓ done
  reference/                   ✓ Voynich reference copies
```

---

## Build Sequence

1. Fetch lineara.xyz corpus JSON from GitHub
2. Convert to `.linearA` inscription files + `inscription.index.yaml`
3. Build sign frequency table + bigram transition matrix
4. Derive FSM states and governor ratio
5. Write `spec/linear-a-fsm.yaml`
6. Implement `spec/linear-a-fsm-validator.ts`
7. Run `spec/linear-a-corpus-health.ts` → `corpus/corpus-health.yaml`
8. Populate fabric pattern keyword table from FSM structural roles
9. Write `fabric/linear_a_translate.md` + install to fabric

---

## Constraints

- No Linear B phonetic values at any layer
- No external cribs or assumed readings
- All sign assignments derived from corpus statistics only
- 0x00 / AB000 quarantined as sentinel throughout
- All tooling Deno-compatible, no external deps beyond std
- Health gate threshold must be empirically derived, not assumed
