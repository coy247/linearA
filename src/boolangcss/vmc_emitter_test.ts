import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatVMC, emitBlockOpen } from "./vmc_emitter.ts";
import { loadSignMap } from "./sign_map.ts";
import type { LinearAToken } from "./types.ts";

Deno.test("vmc_emitter: formatVMC includes [bij6: annotation", async () => {
  const signMap = loadSignMap();
  const blockOpen = emitBlockOpen(".test", signMap);
  const tokens: LinearAToken[] = [];
  const output = formatVMC(blockOpen, tokens, signMap);
  assert(output.includes("[bij6:"), `Expected [bij6: annotation in VMC output`);
});

Deno.test("vmc_emitter: emitBlockOpen produces chedy opcode with selector comment", async () => {
  const signMap = loadSignMap();
  const instr = emitBlockOpen(".hero", signMap);
  assertEquals(instr.opcode, "chedy");
  assert(instr.comment.includes(".hero"));
});
