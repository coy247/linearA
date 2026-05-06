#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * compiler.ts — booLangCSS full compiler pipeline.
 * .blcss → Linear A IR (.linearA) → Voynich Machine Code (.vmc) → CSS (.css)
 *
 * Usage:
 *   deno task build:boolangcss
 *   deno run --allow-read --allow-write src/boolangcss/compiler.ts [input.blcss]
 */
import { parseBlcss } from "./parser.ts";
import { emitTokens, formatLinearAIR, computeFsmScore } from "./linear_a_ir.ts";
import { emitBlockOpen, emitBlockClose, emitDeclInstruction, formatVMC } from "./vmc_emitter.ts";
import { emitCSS } from "./css_emitter.ts";
import { loadSignMap } from "./sign_map.ts";
import { type CompilerOutput } from "./types.ts";
import { FSM_THRESHOLD } from "../../spec/linear-a-fsm-validator.ts";

const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);

export function compile(source: string, signMap = loadSignMap()): CompilerOutput[] {
  const rules   = parseBlcss(source);
  const outputs: CompilerOutput[] = [];

  for (const rule of rules) {
    const tokens   = emitTokens(rule.decls, signMap);
    const fsmScore = computeFsmScore(tokens);
    const passes   = fsmScore >= FSM_THRESHOLD || tokens.length === 0;

    const vmc = [
      emitBlockOpen(rule.selector, signMap),
      ...tokens.map(t => emitDeclInstruction(t, signMap)),
      emitBlockClose(),
    ];

    const css = emitCSS([rule]);

    outputs.push({ rule, linearA: tokens, vmc, css, fsmScore, passes });
  }

  return outputs;
}

async function main() {
  const inputArg  = Deno.args[0] ?? `${REPO_ROOT}examples/example.blcss`;
  const source    = await Deno.readTextFile(inputArg);
  const signMap   = loadSignMap();
  const outputs   = compile(source, signMap);

  const allLinearA: string[] = ["# booLangCSS Linear A IR", ""];
  const allVMC: string[]     = ["; booLangCSS Voynich Machine Code", ""];
  const allCSS: string[]     = [];

  for (const out of outputs) {
    allLinearA.push(formatLinearAIR(out.linearA, out.rule.selector));
    allLinearA.push("");
    allVMC.push(formatVMC(
      emitBlockOpen(out.rule.selector, signMap),
      out.linearA,
      signMap,
    ));
    allVMC.push("");
    allCSS.push(out.css);

    const gate = out.passes ? "PASS" : "FAIL";
    console.log(`  ${out.rule.selector.padEnd(20)} FSM=${out.fsmScore.toFixed(4)}  ${gate}`);
  }

  const base = inputArg.replace(/\.blcss$/, "");
  await Deno.writeTextFile(`${base}.linearA`, allLinearA.join("\n"));
  await Deno.writeTextFile(`${base}.vmc`,     allVMC.join("\n"));
  await Deno.writeTextFile(`${base}.css`,     allCSS.join("\n"));

  console.log(`\nWritten: ${base}.linearA  ${base}.vmc  ${base}.css`);
}

if (import.meta.main) main();
