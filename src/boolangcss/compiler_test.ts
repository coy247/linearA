import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compile } from "./compiler.ts";

const EXAMPLE_BLCSS = `
chedy .test {
  daiin color: bij6(r:4 g:3 b:5);
  daiin font-size: ll(2);
  daiin z-index: pg(0);
}
`;

Deno.test("compiler: parses .blcss without throwing", () => {
  const outputs = compile(EXAMPLE_BLCSS);
  assert(outputs.length > 0, "No rules compiled");
});

Deno.test("compiler: emits Linear A tokens for each declaration", () => {
  const outputs = compile(EXAMPLE_BLCSS);
  const rule = outputs[0];
  assertEquals(rule.linearA.length, rule.rule.decls.length);
});

Deno.test("compiler: CSS output contains resolved values", () => {
  const outputs = compile(EXAMPLE_BLCSS);
  const css = outputs[0].css;
  assert(css.includes("#"), "Expected hex color in CSS output");
  assert(css.includes("2em"), "Expected em unit in CSS output");
});

Deno.test("compiler: VMC output has chedy + daiin + chey opcodes", () => {
  const outputs = compile(EXAMPLE_BLCSS);
  const opcodes = outputs[0].vmc.map(i => i.opcode);
  assert(opcodes.includes("chedy"), "Missing chedy opcode");
  assert(opcodes.includes("daiin"), "Missing daiin opcode");
  assert(opcodes.includes("chey"),  "Missing chey opcode");
});

Deno.test("compiler: bij6 color encodes to #rrggbb format", () => {
  const out = compile(`chedy div {\n  daiin color: bij6(r:1 g:1 b:1);\n}`);
  const css  = out[0]?.css ?? "";
  // r=1 g=1 b=1 → each channel = Math.round(0/5*255) = 0 → #000000
  assert(css.includes("#000000"), `Expected #000000 in: ${css}`);
});

Deno.test("compiler: ll(0) resolves to 'initial'", () => {
  const out = compile(`chedy div {\n  daiin font-size: ll(0);\n}`);
  assert(out[0]?.css.includes("initial"), "ll(0) should resolve to initial");
});

Deno.test("compiler: invalid fsm transition throws", () => {
  let threw = false;
  try { compile(`chedy div {\n  daiin transition: fsm(CODA→CODA);\n}`); }
  catch { threw = true; }
  assert(threw, "Expected error for invalid FSM transition CODA→CODA");
});
