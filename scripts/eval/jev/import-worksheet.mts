/**
 * Parse a filled labelling worksheet back into a fixture file with
 * labelStatus "reviewed" and split "heldout".
 *
 *   node scripts/eval/jev/import-worksheet.mts --in fixtures/heldout-worksheet.md --source fixtures/notes.heldout.unlabeled.json --out fixtures/notes.heldout.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { CLAIM_KINDS, CLAIM_STATUSES, type ClaimKind, type ClaimStatus } from "../../../src/utils/catalog-claims.ts";
import type { NotesFixture } from "./lib/types.mts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const wsPath = arg("in") ?? "scripts/eval/jev/fixtures/heldout-worksheet.md";
  const srcPath = arg("source") ?? "scripts/eval/jev/fixtures/notes.heldout.unlabeled.json";
  const outPath = arg("out") ?? "scripts/eval/jev/fixtures/notes.heldout.json";
  const ws = await readFile(wsPath, "utf8");
  const source: NotesFixture[] = JSON.parse(await readFile(srcPath, "utf8"));
  const byId = new Map(source.map((f) => [f.id, f]));

  const blocks = [...ws.matchAll(/```yaml\nlabels: # (\S+)\n([\s\S]*?)```/g)];
  const out: NotesFixture[] = [];
  let labelled = 0;
  const problems: string[] = [];
  for (const m of blocks) {
    const id = m[1];
    const f = byId.get(id);
    if (!f) { problems.push(`${id}: not in source`); continue; }
    const labels: Partial<Record<ClaimKind, ClaimStatus>> = {};
    let notes = "";
    for (const line of m[2].split("\n")) {
      const kv = /^\s{2}(\w+):\s*(.*)$/.exec(line);
      const nm = /^notes:\s*(.*)$/.exec(line);
      if (nm) { notes = nm[1].trim(); continue; }
      if (!kv) continue;
      const [, key, raw] = kv;
      const val = raw.trim();
      if (!val) continue;
      if (!(CLAIM_KINDS as readonly string[]).includes(key)) { problems.push(`${id}: unknown claim ${key}`); continue; }
      if (!(CLAIM_STATUSES as readonly string[]).includes(val)) { problems.push(`${id}: ${key} has invalid status '${val}'`); continue; }
      labels[key as ClaimKind] = val as ClaimStatus;
    }
    if (Object.keys(labels).length === 0) continue; // untouched block → not part of the held-out set yet
    labelled++;
    out.push({ ...f, labels, labelStatus: "reviewed", labelNotes: notes || undefined, split: "heldout" });
  }
  if (problems.length) { console.error("Problems:\n" + problems.map((p) => "  - " + p).join("\n")); process.exit(1); }
  await writeFile(outPath, JSON.stringify(out, null, 2));
  console.error(`imported ${labelled} reviewed fixtures (${blocks.length - labelled} untouched) → ${outPath}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
