import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseLightLengthSize, isValidLightLengthN } from "./light_length_size.ts";

Deno.test("parseLightLengthSize: ll(0) → 'initial'", () => {
  assertEquals(parseLightLengthSize("ll(0)"), "initial");
});

Deno.test("parseLightLengthSize: ll(3) → '3em'", () => {
  assertEquals(parseLightLengthSize("ll(3)"), "3em");
});

Deno.test("parseLightLengthSize: ll(5) → '100vw'", () => {
  assertEquals(parseLightLengthSize("ll(5)"), "100vw");
});

Deno.test("parseLightLengthSize: ll(6) throws SyntaxError", () => {
  assertThrows(() => parseLightLengthSize("ll(6)"), SyntaxError);
});

Deno.test("parseLightLengthSize: invalid string throws SyntaxError", () => {
  assertThrows(() => parseLightLengthSize("ll(bad)"), SyntaxError);
});

Deno.test("isValidLightLengthN: 0-5 valid, 6 invalid", () => {
  for (let i = 0; i <= 5; i++) {
    if (!isValidLightLengthN(i)) throw new Error(`${i} should be valid`);
  }
  if (isValidLightLengthN(6)) throw new Error("6 should be invalid");
});
