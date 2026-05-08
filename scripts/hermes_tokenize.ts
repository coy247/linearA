/**
 * hermes_tokenize.ts — Hermes-guided sign segmentation via Ollama.
 *
 * Given raw corpus text and optional cross-language context (from _matrix.json),
 * calls the local Hermes model to propose sign group boundaries.
 * Returns structured sign groups ready for decipher_universal analysis.
 *
 * The model never touches the scoring math — it only proposes segmentations.
 * All scoring is deterministic in decipher_universal.ts.
 */

const OLLAMA_BASE = "http://localhost:11434";

export interface HermesTokenizeInput {
  rawText:         string;        // raw corpus (any delimiter style)
  corpusId:        string;
  scriptName:      string;
  era:             string;
  readingDirection: string;
  knownFacts:      string[];      // confirmed structural facts (e.g. "numerical signs at end")
  crossLanguageContext?: string;  // JSON summary from _matrix.json (optional)
  model?:          string;        // default: hermes-local:latest
}

export interface HermesTokenizeOutput {
  signGroups:      string[][];    // proposed segmentation
  confidence:      number;        // 0–1, self-reported by model
  reasoning:       string;        // model's boundary rationale
  model:           string;
  tokensGenerated: number;
  durationMs:      number;
}

// ── Build the segmentation prompt ─────────────────────────────────────────────

function buildPrompt(input: HermesTokenizeInput): string {
  const crossCtx = input.crossLanguageContext
    ? `\nCross-language structural context (from analyzed scripts — use as priors):\n${input.crossLanguageContext}\n`
    : "";

  const facts = input.knownFacts.length > 0
    ? `\nConfirmed structural facts:\n${input.knownFacts.map(f => `- ${f}`).join("\n")}\n`
    : "";

  return `You are a structural linguist analyzing the undeciphered script: ${input.scriptName} (${input.era}).
Reading direction: ${input.readingDirection}.
${facts}${crossCtx}
TASK: Segment the raw corpus below into sign groups.
Each sign group is a logical unit (like a word or administrative entry).
Signs within a group are separated by periods (.).
Groups are separated by newlines.

Rules:
1. Preserve every sign token — do not discard anything
2. Apply your knowledge of ${input.scriptName} sign boundaries
3. Groups should average 3–7 signs (administrative scripts tend shorter)
4. Boustrophedon scripts: preserve original sequence, do not reverse lines
5. Output ONLY the segmented corpus — no commentary

Then on a new line after the corpus, output exactly:
CONFIDENCE: <0.00–1.00>
REASONING: <one sentence explaining your main boundary criterion>

Raw corpus:
${input.rawText.slice(0, 8000)}`;
}

// ── Parse model response ───────────────────────────────────────────────────────

function parseResponse(raw: string, delimiter = "."): { signGroups: string[][], confidence: number, reasoning: string } {
  const lines = raw.split("\n");
  const groups: string[][] = [];
  let confidence = 0.7;
  let reasoning = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CONFIDENCE:")) {
      confidence = parseFloat(trimmed.replace("CONFIDENCE:", "").trim()) || 0.7;
      continue;
    }
    if (trimmed.startsWith("REASONING:")) {
      reasoning = trimmed.replace("REASONING:", "").trim();
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const signs = trimmed.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
    if (signs.length > 0) groups.push(signs);
  }

  return { signGroups: groups, confidence: Math.min(1, Math.max(0, confidence)), reasoning };
}

// ── Ollama call ────────────────────────────────────────────────────────────────

export async function hermesTokenize(input: HermesTokenizeInput): Promise<HermesTokenizeOutput> {
  const model   = input.model ?? "hermes-local:latest";
  const prompt  = buildPrompt(input);
  const start   = Date.now();

  const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream:  false,
      options: {
        temperature:    0.2,   // low temp for deterministic segmentation
        top_k:          20,
        num_ctx:        8192,
        num_predict:    4096,
      },
    }),
    signal: AbortSignal.timeout(720_000),  // 12min — accounts for 6min cold-start load
  });

  if (!resp.ok) {
    throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
  }

  const json        = await resp.json();
  const rawResponse = (json.response as string) ?? "";
  const durationMs  = Date.now() - start;

  const { signGroups, confidence, reasoning } = parseResponse(rawResponse);

  return {
    signGroups,
    confidence,
    reasoning,
    model,
    tokensGenerated: json.eval_count ?? 0,
    durationMs,
  };
}

// ── Speed benchmark helper ────────────────────────────────────────────────────

export function tokensPerSecond(result: HermesTokenizeOutput): number {
  if (result.durationMs === 0) return 0;
  return Math.round(result.tokensGenerated / (result.durationMs / 1000));
}
