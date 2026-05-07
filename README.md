# linearA

<div align="center">
<pre style="font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace; font-size: 13px; line-height: 1.6;">
    𐘠 · 𐘳 · 𐘽
    ONSET · BODY · CODA
    booLang → Linear A IR → Voynich Machine Code → CSS
</pre>
</div>

---

A CSS compiler whose source language is **booLangCSS** — written in Voynich EVA
opcodes, encoded through Linear A sign groups as an intermediate representation,
and emitted as standard CSS. Every value is mathematically grounded: colors are
Bij6 digits, sizes are light-length tiers, z-index is a pressure gate, transitions
are valid Linear A FSM state transitions.

---

## hello world

**Layer 1 — booLang source** (`.blcss` — EVA opcodes declare intent):

```
chedy .world {
  daiin color:      bij6(r:6 g:6 b:1);
  daiin font-size:  ll(1);
  daiin z-index:    pg(1);
  daiin transition: fsm(ONSET→BODY);
}
dy
```

**Layer 2 — Linear A IR** (`.linearA` — Bronze Age Minoan sign groups):

```
𐝫.𐘳.𐜨    # color: #ffff00  [ONSET→CODA]
𐘇.𐘳.𐘋    # font-size: 1em  [ONSET→CODA]
𐙗.𐘳.𐜨    # z-index: 100   [ONSET→CODA]
𐘉.𐘳.𐜨    # transition: all ease-out 300ms  [ONSET→CODA]

# FSM score: 0.0000 (threshold: 0.9123)
```

Each token is `ONSET.BODY.CODA` — three Linear A signs encoding property carrier,
body sign, and unit carrier. The FSM score measures how closely the CSS rule
follows the valid transition structure of the original Linear A corpus.

**Layer 3 — Voynich Machine Code** (`.vmc` — EVA opcodes + canonical bytes):

```
chedy       46 119 111     ; rule block: .world  [bij6: 03,24,1w]
daiin        1  10  37     ; color: #ffff00  [bij6: 0,3,u]
daiin        6  10  45     ; font-size: 1em  [bij6: 5,3,02]
daiin       37  10  37     ; z-index: 100  [bij6: u,3,u]
daiin       30  10  37     ; transition: all ease-out 300ms  [bij6: n,3,u]
chey                       ; close rule block
dy                         ; end of stream
```

**Layer 4 — CSS output** (`.css` — standard, valid, deployable):

```css
.world {
  color: #ffff00;
  font-size: 1em;
  z-index: 100;
  transition: all ease-out 300ms;
}
```

---

## value encoding

Every CSS value in booLangCSS is derived from a mathematical primitive,
not written by hand. The hex values are not arbitrary.

### bij6() → hex color

Bij6 uses digits `[1–6]` — bijective base-6, no zero. Each digit maps to a
hex channel via linear interpolation across the full 8-bit range:

```
channel = Math.round((digit − 1) / 5 × 255)
```

| digit | hex  | decimal |
|-------|------|---------|
| 1     | 0x00 |   0     |
| 2     | 0x33 |  51     |
| 3     | 0x66 | 102     |
| 4     | 0x99 | 153     |
| 5     | 0xCC | 204     |
| 6     | 0xFF | 255     |

These six values are exactly the **web-safe hex grid** — the equidistant
set used in the 216-color web-safe palette (6 × 6 × 6 = 216 combinations).
Bij6 is a mathematical isomorphism to the web-safe color cube.

```
bij6(r:6 g:6 b:1)  →  #ffff00   (expansion yellow — r=FF, g=FF, b=00)
bij6(r:1 g:1 b:1)  →  #000000   (ground — all channels at minimum)
bij6(r:6 g:6 b:6)  →  #ffffff   (full expansion — all channels at maximum)
```

The canonical ratio `9109/9919 ≈ 0.918` encodes to Bij6 slot
`ceil(0.918 × 6) = 6` → digit 6 → `0xFF` — maximum expansion tier.

### ll() → font-size

Light-length tiers map the [0,5] magnitude domain of `LightLengthState`
to CSS font-size values:

```
ll(0) → initial   (reset — no light-length)
ll(1) → 1em       (tier 1)
ll(2) → 2em       (tier 2)
ll(3) → 3em       (tier 3)
ll(4) → 4em       (tier 4)
ll(5) → 100vw     (full expansion — viewport width)
```

Validated via `fromBij6Digit()` from booLang-hardening — digits `[1–5]`
are valid Bij6 magnitudes; `ll(0)` is the reset state.

### pg() → z-index

The pressure gate formula `boundary = 3x − 5y` where:
- `x = classCount / (classCount + elementCount + 1)` — throughput proxy
- `y = elementCount / (classCount + elementCount + 1)` — overhead proxy

Maps to three z-index tiers via `evaluatePressure()` from booLang-hardening:

```
boundary > 1   →  tier 2, z-index: 200  (elevated)
−1 ≤ b ≤ 1    →  tier 1, z-index: 100  (mid)
boundary < −1  →  tier 0, z-index: 0    (collapsed)
```

### fsm() → transition timing

Valid Linear A FSM transitions (from corpus analysis, governor ratio 3631/3980):

```
ONSET→BODY   →  ease-out 300ms
BODY→BODY    →  linear   300ms
ONSET→ONSET  →  linear   400ms
BODY→ONSET   →  ease     250ms
ONSET→MIXED  →  ease-out 350ms
BODY→MIXED   →  ease-out 280ms
MIXED→BODY   →  ease-in  200ms
MIXED→ONSET  →  ease-in  200ms
```

Invalid transitions (e.g. `fsm(CODA→CODA)`) throw at compile time.

---

## pipeline

```
.blcss          booLang source — EVA opcodes + bij6/ll/pg/fsm values
  ↓  parser
BlcssRule[]     parsed rules with resolved CSS values
  ↓  linear_a_ir
.linearA        Linear A sign groups — ONSET.BODY.CODA per declaration
  ↓  vmc_emitter
.vmc            Voynich Machine Code — canonical bytes + bij6 annotations
  ↓  css_emitter
.css            standard CSS output
```

The compiler is at `src/boolangcss/compiler.ts`. Run:

```bash
deno run --allow-read --allow-write src/boolangcss/compiler.ts
```

---

## proofs

Three independent mathematical proofs validate the Linear A
ONSET/BODY/CODA structural decipherment (`spec/linear-a-peer-review.ts`):

| proof | method | result |
|-------|--------|--------|
| 1 | Mutual Information + Bij6 governor slot | MI ≈ 1.57 bits; ratio maps to expansion tier (digit 6) |
| 2 | 10k permutation null test (mulberry32, seed 0xDEADBEEF) | z >> 3, p < 0.001 |
| 3 | Canonical octet clustering + Cohen's d | C_BODY < C_ONSET ≈ C_CODA, d > 0.5 |

Run all proofs:

```bash
deno test --allow-read spec/linear-a-peer-review-test.ts
```

---

## booLang-hardening dependency

Math primitives are imported from `../booLang-hardening/`:

```
CANONICAL_RATIO     ← acceptable_range_governor.ts   (9109/9919)
booLangDiv          ← acceptable_range_governor.ts   (x/0 = "DEFINED")
evaluatePressure    ← pressure_gate.ts               (3x−5y boundary)
fromBij6Digit       ← light_length.ts                ([1,6] validation)
nonceToBij6         ← bij6.ts                        (digit → Bij6State)
bij6ToNonce         ← bij6.ts                        (Bij6State → digit)
bij6ToBase36        ← bij6.ts                        (Bij6State → string)
mulberry32          ← prng.ts                        (seeded PRNG)
canonicalOctet      ← canonical_octet.ts             (256 → 136 forms)
```

---

## test

```bash
deno test --allow-read   # 69 tests, 0 failures
```

---

## license

proprietary. all rights reserved.
concept and architecture: **Garzaro**.
