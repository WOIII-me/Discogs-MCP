/**
 * Phase 1 notes eval (plans/jev-and-mcp-apps-plan.md §1).
 *
 * Runs one or more interpreters over a labelled fixture set and its paired
 * adversarial variants, then writes JSON + Markdown reports.
 *
 *   node scripts/eval/jev/run-notes.mts --set dev --interpreters rules,jev
 *   node scripts/eval/jev/run-notes.mts --set dev --interpreters jev-noguard,jev-noulguard,jev-regexguard   # guard ablations
 *   node scripts/eval/jev/run-notes.mts --set heldout --interpreters rules,jev,haiku --reviewed-only
 *
 * Env: JEV_API_KEY (or TYPESAFE_API_KEY) for jev; ANTHROPIC_API_KEY (or an
 * `ant auth login` profile) plus a local `@anthropic-ai/sdk` install for haiku.
 * `.dev.vars` is read for JEV_* values when present (never committed).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { computeReport, renderMarkdown, type Report } from "./lib/metrics.mts";
import { makeInjectedVariants } from "./lib/inject.mts";
import { rulesInterpreter } from "./lib/rules.mts";
import { jevInterpreter } from "./lib/jev.mts";
import type { Interpreter, InterpretationResult, NotesFixture } from "./lib/types.mts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function loadDevVars(): Promise<Record<string, string>> {
  try {
    const text = await readFile(".dev.vars", "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1).trim()];
        })
    );
  } catch {
    return {};
  }
}

async function runAll(interp: Interpreter, fixtures: NotesFixture[], concurrency: number): Promise<InterpretationResult[]> {
  const results: InterpretationResult[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < fixtures.length) {
        const f = fixtures[next++];
        const r = await interp.interpret(f);
        results.push(r);
        if (r.error) console.error(`  ${interp.name} ${f.id}: ${r.error}`);
      }
    })
  );
  return results;
}

async function main() {
  const set = arg("set") ?? "dev";
  const names = (arg("interpreters") ?? "rules").split(",").map((s) => s.trim());
  const outDir = arg("out") ?? "scripts/eval/jev/results";
  const injectPerItem = Number(arg("inject") ?? 2);
  const concurrency = Number(arg("concurrency") ?? 3);
  const devVars = await loadDevVars();
  const env = { ...devVars, ...process.env } as Record<string, string | undefined>;

  const path = `scripts/eval/jev/fixtures/notes.${set}.json`;
  let fixtures: NotesFixture[] = JSON.parse(await readFile(path, "utf8"));
  if (flag("reviewed-only")) fixtures = fixtures.filter((f) => f.labelStatus === "reviewed");
  fixtures = fixtures.filter((f) => Object.keys(f.labels).length > 0);
  if (fixtures.length === 0) throw new Error(`no labelled fixtures in ${path}`);
  const injected = injectPerItem > 0 ? makeInjectedVariants(fixtures, injectPerItem) : [];
  const all = [...fixtures, ...injected];
  console.error(`${set}: ${fixtures.length} labelled items + ${injected.length} injected variants`);

  const interpreters: Interpreter[] = [];
  for (const n of names) {
    if (n === "rules") interpreters.push(rulesInterpreter);
    else if (n === "jev") {
      const apiKey = env.JEV_API_KEY ?? env.TYPESAFE_API_KEY;
      if (!apiKey) throw new Error("jev interpreter needs JEV_API_KEY (env or .dev.vars)");
      interpreters.push(jevInterpreter({ apiKey, model: env.JEV_MODEL || undefined }));
    } else if (n === "jev-noguard" || n === "jev-noulguard" || n === "jev-regexguard") {
      // Ablations: how much of the injection resistance is the model's own
      // per-sentence judgement vs the deterministic regex (which was written
      // with knowledge of the injection bank, so it flatters itself).
      const apiKey = env.JEV_API_KEY ?? env.TYPESAFE_API_KEY;
      if (!apiKey) throw new Error("jev interpreter needs JEV_API_KEY (env or .dev.vars)");
      const guards =
        n === "jev-noguard" ? { regexGuard: false, noulGuard: false } : n === "jev-noulguard" ? { regexGuard: false } : { noulGuard: false };
      interpreters.push(jevInterpreter({ apiKey, model: env.JEV_MODEL || undefined, guards, nameSuffix: `:${n.slice(4)}` }));
    } else if (n === "haiku") {
      const { haikuInterpreter } = await import("./lib/haiku.mts");
      interpreters.push(await haikuInterpreter());
    } else throw new Error(`unknown interpreter ${n}`);
  }

  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reports: Report[] = [];
  const raw: Record<string, InterpretationResult[]> = {};
  for (const interp of interpreters) {
    console.error(`running ${interp.name} on ${all.length} items…`);
    const results = await runAll(interp, all, interp.name === "rules" ? 16 : concurrency);
    raw[interp.name] = results;
    const report = computeReport(interp.name, set, all, results);
    reports.push(report);
    console.error(
      `  macro P/R (informative): ${report.macroInformative.precision?.toFixed(2) ?? "—"} / ${report.macroInformative.recall?.toFixed(2) ?? "—"}; ` +
        `flip rate ${report.injection.flipRate?.toFixed(2) ?? "—"}; p50 ${report.latency.p50.toFixed(0)} ms, p95 ${report.latency.p95.toFixed(0)} ms; errors ${report.errors}`
    );
  }

  const base = `${outDir}/${set}-${stamp}`;
  await writeFile(`${base}.json`, JSON.stringify({ set, fixtures: all.map((f) => f.id), reports, raw }, null, 2));
  await writeFile(`${base}.md`, renderMarkdown(reports));
  console.error(`wrote ${base}.md and .json`);
  console.log(renderMarkdown(reports));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
