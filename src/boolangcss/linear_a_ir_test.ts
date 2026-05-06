import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeFsmScore } from "./linear_a_ir.ts";
import type { LinearAToken } from "./types.ts";

function fakeToken(valid: boolean): LinearAToken {
  return {
    group: "𐘠.𐘳.𐘽",
    fromState: "ONSET",
    toState: "CODA",
    transition: "ONSET→CODA",
    valid,
    cssDecl: { property: "color", rawValue: "bij6(r:4 g:3 b:5)", valueType: "bij6", resolvedCSS: "#ff0000" },
  };
}

Deno.test("computeFsmScore: empty list → 0", () => {
  assertEquals(computeFsmScore([]), 0);
});

Deno.test("computeFsmScore: all valid → 1", () => {
  const tokens = [fakeToken(true), fakeToken(true), fakeToken(true)];
  assertEquals(computeFsmScore(tokens), 1);
});

Deno.test("computeFsmScore: half valid → 0.5", () => {
  const tokens = [fakeToken(true), fakeToken(false)];
  assertEquals(computeFsmScore(tokens), 0.5);
});
