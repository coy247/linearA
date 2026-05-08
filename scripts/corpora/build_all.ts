#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * build_all.ts — Convert all raw corpora → inscription files + index.
 *
 * For each script in the difficulty queue, reads
 * corpus/<id>/raw/<id>_raw.txt and writes:
 *   corpus/<id>/inscriptions/<id>_NNNN.<id>   (one sign group per file)
 *   corpus/<id>/inscription.index.yaml
 *
 * Also creates corpus/<id>/<id>_flat.txt — all sign groups, one per line,
 * ready for hermes_decipher.ts --corpus flag.
 *
 * Usage:
 *   deno run --allow-read --allow-write scripts/corpora/build_all.ts
 *   deno run --allow-read --allow-write scripts/corpora/build_all.ts --id proto_elamite
 */

const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname);

interface CorpusMeta {
  id:          string;
  name:        string;
  era:         string;
  delimiter:   string;
  ext:         string;
}

const CORPORA: CorpusMeta[] = [
  { id: "rongorongo",         name: "Rongorongo",              era: "1200–1877 CE",  delimiter: ".", ext: "rongorongo" },
  { id: "proto_elamite",      name: "Proto-Elamite",           era: "3200–2900 BCE", delimiter: ".", ext: "pe" },
  { id: "byblos_syllabary",   name: "Byblos Syllabary",        era: "1800–1400 BCE", delimiter: ".", ext: "byblos" },
  { id: "cretan_hieroglyphic",name: "Cretan Hieroglyphic",     era: "2100–1700 BCE", delimiter: ".", ext: "cret" },
  { id: "indus_valley",       name: "Indus Valley / Harappan", era: "2600–1900 BCE", delimiter: ".", ext: "indus" },
];

function parseRaw(text: string, delimiter: string): string[][] {
  const groups: string[][] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const signs = trimmed.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
    if (signs.length > 0) groups.push(signs);
  }
  return groups;
}

function buildIndex(meta: CorpusMeta, groups: string[][], isSynthetic: boolean): string {
  const totalSigns = groups.reduce((s, g) => s + g.length, 0);
  const avgLen = (totalSigns / groups.length).toFixed(2);
  const uniqueSigns = new Set(groups.flat()).size;
  return [
    `# ${meta.name} Inscription Index`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    `# Source: corpus/${meta.id}/raw/${meta.id}_raw.txt`,
    isSynthetic ? `# Note: SYNTHETIC corpus — generated from known statistical parameters` : `# Note: sourced from public data`,
    ``,
    `corpus_id: ${meta.id}`,
    `script_name: "${meta.name}"`,
    `era: "${meta.era}"`,
    `total_groups: ${groups.length}`,
    `total_signs: ${totalSigns}`,
    `unique_signs: ${uniqueSigns}`,
    `avg_group_length: ${avgLen}`,
    `synthetic: ${isSynthetic}`,
  ].join("\n") + "\n";
}

async function buildCorpus(meta: CorpusMeta) {
  const rawPath  = `${REPO_ROOT}corpus/${meta.id}/raw/${meta.id}_raw.txt`;
  const outDir   = `${REPO_ROOT}corpus/${meta.id}/inscriptions`;
  const flatPath = `${REPO_ROOT}corpus/${meta.id}/${meta.id}_flat.txt`;
  const idxPath  = `${REPO_ROOT}corpus/${meta.id}/inscription.index.yaml`;

  let rawText: string;
  try {
    rawText = Deno.readTextFileSync(rawPath);
  } catch {
    console.log(`  SKIP ${meta.id} — raw file not found: ${rawPath}`);
    console.log(`         Run: deno run --allow-net --allow-write scripts/corpora/${meta.id}_fetch.ts`);
    return;
  }

  const isSynthetic = rawText.includes("SYNTHETIC");
  const groups = parseRaw(rawText, meta.delimiter);

  if (groups.length === 0) {
    console.log(`  SKIP ${meta.id} — no sign groups parsed from ${rawPath}`);
    return;
  }

  Deno.mkdirSync(outDir, { recursive: true });

  // Write individual inscription files (groups of ~20 for readability)
  const chunkSize = 20;
  let fileCount = 0;
  for (let i = 0; i < groups.length; i += chunkSize) {
    const chunk = groups.slice(i, i + chunkSize);
    const num   = String(fileCount + 1).padStart(4, "0");
    const fname = `${meta.id}_${num}.${meta.ext}`;
    const signs = chunk.map(g => g.length).reduce((a, b) => a + b, 0);
    const lines = [
      `# ${meta.name} — ${meta.id}_${num}`,
      `# Era:    ${meta.era}`,
      `# Groups: ${chunk.length}`,
      `# Signs:  ${signs}`,
      isSynthetic ? `# SYNTHETIC` : "",
      "",
      ...chunk.map(g => g.join(".")),
      "",
    ].filter(l => l !== null);
    Deno.writeTextFileSync(`${outDir}/${fname}`, lines.join("\n"));
    fileCount++;
  }

  // Write flat corpus (for hermes_decipher.ts --corpus)
  const flatLines = [
    `# ${meta.name} flat corpus`,
    `# ${isSynthetic ? "SYNTHETIC — generated from known statistical parameters" : "sourced from public data"}`,
    `# One sign group per line, signs separated by '.'`,
    `#`,
    ...groups.map(g => g.join(".")),
  ];
  Deno.writeTextFileSync(flatPath, flatLines.join("\n") + "\n");

  // Write index
  Deno.writeTextFileSync(idxPath, buildIndex(meta, groups, isSynthetic));

  const totalSigns = groups.reduce((s, g) => s + g.length, 0);
  const unique = new Set(groups.flat()).size;
  console.log(`  ✓ ${meta.id.padEnd(24)} ${groups.length} groups  ${totalSigns} signs  ${unique} unique  ${fileCount} files  ${isSynthetic ? "[SYNTHETIC]" : "[real]"}`);
}

// CLI
const args = Object.fromEntries(
  Deno.args.flatMap((a, i, arr) => a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])
);
const targetId = args["id"];

const targets = targetId ? CORPORA.filter(c => c.id === targetId) : CORPORA;
if (targets.length === 0) {
  console.error(`Unknown corpus id: ${targetId}`);
  Deno.exit(1);
}

console.log("\nBuilding corpora:\n");
for (const meta of targets) {
  await buildCorpus(meta);
}
console.log("\nDone. Flat corpus files ready for hermes_decipher.ts --corpus");
console.log("Example: deno task hermes:decipher --id rongorongo --corpus corpus/rongorongo/rongorongo_flat.txt");
