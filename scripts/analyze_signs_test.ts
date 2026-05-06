import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseLinearAFile, buildFrequencyTable, positionBias, buildSignFreqArray,
  buildSignIndex, buildBigramMatrix, aggregateStateTransitions,
} from "./analyze_signs.ts";
import type { SignIndex, BigramEntry } from "./analyze_signs.ts";

Deno.test("parseLinearAFile: extracts sign groups from .linearA content", () => {
  const content = [
    "# Linear A Inscription — HT 1",
    "# Site:    Hagia Triada (HT)",
    "# Signs:   5",
    "",
    "da.ku.na",
    "re.za",
    "",
    "# ── Sign list (flat) ───",
    "da.ku.na.re.za",
    "",
  ].join("\n");

  const groups = parseLinearAFile(content);
  assertEquals(groups.length, 2);
  assertEquals(groups[0], ["da", "ku", "na"]);
  assertEquals(groups[1], ["re", "za"]);
});

Deno.test("buildFrequencyTable: correct positional counts", () => {
  const groups = [["da", "ku", "da"], ["da", "re"]];
  const freq = buildFrequencyTable(groups);
  assertEquals(freq.get("da")?.total, 3);
  assertEquals(freq.get("da")?.initial, 2);
  assertEquals(freq.get("da")?.medial, 0);
  assertEquals(freq.get("da")?.final, 1);
  assertEquals(freq.get("ku")?.total, 1);
  assertEquals(freq.get("ku")?.medial, 1);
});

Deno.test("positionBias: dominant initial → ONSET", () => {
  assertEquals(positionBias({ total: 10, initial: 6, medial: 2, final: 2 }), "ONSET");
});

Deno.test("positionBias: dominant final → CODA", () => {
  assertEquals(positionBias({ total: 10, initial: 1, medial: 2, final: 7 }), "CODA");
});

Deno.test("positionBias: dominant medial → BODY", () => {
  assertEquals(positionBias({ total: 10, initial: 1, medial: 8, final: 1 }), "BODY");
});

Deno.test("positionBias: no dominance → MIXED", () => {
  assertEquals(positionBias({ total: 9, initial: 3, medial: 3, final: 3 }), "MIXED");
});

Deno.test("buildSignFreqArray: sorted by total freq, compact indices start at 1", () => {
  const freq = new Map([
    ["da", { total: 10, initial: 7, medial: 2, final: 1 }],
    ["ku", { total: 5,  initial: 1, medial: 3, final: 1 }],
    ["re", { total: 20, initial: 1, medial: 2, final: 17 }],
  ]);
  const arr = buildSignFreqArray(freq);
  assertEquals(arr[0].sign, "re");
  assertEquals(arr[0].compactIndex, 1);
  assertEquals(arr[1].sign, "da");
  assertEquals(arr[1].compactIndex, 2);
  assertEquals(arr[2].sign, "ku");
  assertEquals(arr[2].compactIndex, 3);
});

Deno.test("buildBigramMatrix: counts within-group pairs only", () => {
  const groups = [["da", "ku", "na"], ["da", "re"]];
  const index: SignIndex = {
    "da": { compactIndex: 1, canonicalByte: 1, state: "ONSET" },
    "ku": { compactIndex: 2, canonicalByte: 2, state: "BODY" },
    "na": { compactIndex: 3, canonicalByte: 3, state: "CODA" },
    "re": { compactIndex: 4, canonicalByte: 4, state: "BODY" },
  };
  const bigrams = buildBigramMatrix(groups, index);
  assertEquals(bigrams.length, 3);
  const daKu = bigrams.find(b => b.from === "da" && b.to === "ku");
  assertEquals(daKu?.count, 1);
  assertEquals(daKu?.stateTransition, "ONSET→BODY");
});

Deno.test("buildBigramMatrix: sorted descending by count", () => {
  const groups = [
    ["da", "ku"], ["da", "ku"], ["da", "ku"], ["re", "na"],
  ];
  const index: SignIndex = {
    "da": { compactIndex: 1, canonicalByte: 1, state: "ONSET" },
    "ku": { compactIndex: 2, canonicalByte: 2, state: "BODY" },
    "re": { compactIndex: 3, canonicalByte: 3, state: "ONSET" },
    "na": { compactIndex: 4, canonicalByte: 4, state: "CODA" },
  };
  const bigrams = buildBigramMatrix(groups, index);
  assertEquals(bigrams[0].from, "da");
  assertEquals(bigrams[0].to, "ku");
  assertEquals(bigrams[0].count, 3);
});

Deno.test("aggregateStateTransitions: sums counts per state pair", () => {
  const bigrams: BigramEntry[] = [
    { from:"da", to:"ku", count:4, fromState:"ONSET", toState:"BODY", stateTransition:"ONSET→BODY" },
    { from:"re", to:"za", count:2, fromState:"ONSET", toState:"BODY", stateTransition:"ONSET→BODY" },
    { from:"ku", to:"na", count:3, fromState:"BODY",  toState:"CODA", stateTransition:"BODY→CODA"  },
  ];
  const agg = aggregateStateTransitions(bigrams);
  assertEquals(agg[0].stateTransition, "ONSET→BODY");
  assertEquals(agg[0].totalCount, 6);
  assertEquals(agg[1].stateTransition, "BODY→CODA");
  assertEquals(agg[1].totalCount, 3);
  const total = agg.reduce((s, a) => s + a.totalCount, 0);
  assertEquals(total, 9);
});

Deno.test("buildSignIndex: maps signs to compact index, canonical byte, and state", () => {
  const freq = new Map([
    ["da", { total: 10, initial: 7, medial: 2, final: 1 }],
    ["ku", { total: 5,  initial: 1, medial: 3, final: 1 }],
  ]);
  const signFreqs = buildSignFreqArray(freq);
  const idx = buildSignIndex(signFreqs);
  assertEquals(idx["da"].compactIndex, 1);
  assertEquals(idx["da"].state, "ONSET");
  assertEquals(idx["ku"].compactIndex, 2);
  assertEquals(idx["ku"].state, "BODY");
});
