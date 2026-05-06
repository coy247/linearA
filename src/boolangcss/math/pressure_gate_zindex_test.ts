import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computePGTier, parsePGTier, pgTierToCSS } from "./pressure_gate_zindex.ts";

Deno.test("computePGTier: high class count → tier 2", () => {
  // classCount=10, elementCount=0 → x=10/11, y=0 → boundary=3*(10/11)≈2.73 > 1
  assertEquals(computePGTier(10, 0), 2);
});

Deno.test("computePGTier: high element count → tier 0", () => {
  // classCount=0, elementCount=10 → x=0, y=10/11 → boundary=-5*(10/11)≈-4.5 < -1
  assertEquals(computePGTier(0, 10), 0);
});

Deno.test("computePGTier: balanced → tier 1", () => {
  // classCount=2, elementCount=2 → x=2/5, y=2/5 → boundary=3*0.4-5*0.4=-0.8 → tier 1
  assertEquals(computePGTier(2, 2), 1);
});

Deno.test("parsePGTier: pg(2) → 2", () => {
  assertEquals(parsePGTier("pg(2)"), 2);
});

Deno.test("pgTierToCSS: tier 2 → '200'", () => {
  assertEquals(pgTierToCSS(2), "200");
});
