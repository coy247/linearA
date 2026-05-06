import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bij6ColorToCSS, parseBij6Color } from "./bij6_color.ts";

Deno.test("bij6ColorToCSS: r=1 g=1 b=1 → #000000", () => {
  assertEquals(bij6ColorToCSS({ r: 1, g: 1, b: 1 }), "#000000");
});

Deno.test("bij6ColorToCSS: r=6 g=6 b=6 → #ffffff", () => {
  assertEquals(bij6ColorToCSS({ r: 6, g: 6, b: 6 }), "#ffffff");
});

Deno.test("bij6ColorToCSS: r=4 g=3 b=5 → #9966cc", () => {
  // r=4: Math.round(3/5*255)=153=0x99, g=3: Math.round(2/5*255)=102=0x66, b=5: Math.round(4/5*255)=204=0xcc
  assertEquals(bij6ColorToCSS({ r: 4, g: 3, b: 5 }), "#9966cc");
});

Deno.test("bij6ColorToCSS: r=0 throws RangeError", () => {
  assertThrows(() => bij6ColorToCSS({ r: 0, g: 1, b: 1 }), RangeError);
});

Deno.test("bij6ColorToCSS: r=7 throws RangeError", () => {
  assertThrows(() => bij6ColorToCSS({ r: 7, g: 1, b: 1 }), RangeError);
});

Deno.test("parseBij6Color: 'bij6(r:4 g:3 b:5)' parses correctly", () => {
  const c = parseBij6Color("bij6(r:4 g:3 b:5)");
  assertEquals(c, { r: 4, g: 3, b: 5 });
});
