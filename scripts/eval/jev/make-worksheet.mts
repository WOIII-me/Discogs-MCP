/**
 * Render a fixture file as a Markdown labelling worksheet for a human reviewer.
 *
 *   node scripts/eval/jev/make-worksheet.mts --in fixtures/notes.heldout.unlabeled.json --out fixtures/heldout-worksheet.md
 *
 * Fill each `labels:` block with one of stated / denied / not_stated / contradictory,
 * or leave a claim blank to keep it unlabelled (borderline cases). Then:
 *
 *   node scripts/eval/jev/import-worksheet.mts --in fixtures/heldout-worksheet.md --out fixtures/notes.heldout.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { CLAIM_DEFINITIONS, CLAIM_KINDS } from "../../../src/utils/catalog-claims.ts";
import type { NotesFixture } from "./lib/types.mts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const inPath = arg("in") ?? "scripts/eval/jev/fixtures/notes.heldout.unlabeled.json";
  const outPath = arg("out") ?? "scripts/eval/jev/fixtures/heldout-worksheet.md";
  const fixtures: NotesFixture[] = JSON.parse(await readFile(inPath, "utf8"));
  const lines: string[] = [
    "# Held-out labelling worksheet",
    "",
    "One block per release. For each claim write exactly one of `stated`, `denied`, `not_stated`, `contradictory`,",
    "or leave it blank to keep that claim unlabelled (use blanks for genuinely borderline cases and say why in `notes:`).",
    "Do not look at any model output while labelling. Conventions: see scripts/eval/jev/README.md.",
    "",
    "Claim definitions:",
    ...CLAIM_KINDS.map((k) => `- **${k}** — ${CLAIM_DEFINITIONS[k].statement}`),
    "",
  ];
  for (const f of fixtures) {
    lines.push(`---`, ``, `## ${f.id} — ${f.label ?? "?"} · ${f.country ?? "?"} · ${f.year ?? "?"} · ${f.title}`, ``);
    lines.push(`Formats: ${f.formats.join(" | ") || "—"}`, ``);
    lines.push("```text", f.notes || "(no notes)", "```", "");
    const ids = f.identifiers.filter((i) => i.description || /matrix|runout/i.test(i.type));
    if (ids.length) lines.push("Identifiers:", ...ids.slice(0, 12).map((i) => `- ${i.type}: \`${i.value}\`${i.description ? ` (${i.description})` : ""}`), "");
    if (f.companies?.length) lines.push("Credits:", ...f.companies.slice(0, 12).map((c) => `- ${c.role}: ${c.name}`), "");
    lines.push("```yaml", `labels: # ${f.id}`, ...CLAIM_KINDS.map((k) => `  ${k}: ${f.labels?.[k] ?? ""}`), `notes: ${f.labelNotes ?? ""}`, "```", "");
  }
  await writeFile(outPath, lines.join("\n"));
  console.error(`wrote ${fixtures.length} blocks → ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
