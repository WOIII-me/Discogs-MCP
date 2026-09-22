/**
 * Layer-2 scenario runner: real MCP calls against the local dev server
 * (personal-token auth, no OAuth), with JSON-path assertions on the results.
 *
 *   npm run dev:token                # in another terminal (or the mcp-dev launch config)
 *   node scripts/scenarios/run.mts   # all cases
 *   node scripts/scenarios/run.mts --only lz2   # cases whose id contains "lz2"
 *   node scripts/scenarios/run.mts --url http://localhost:8787/mcp --max-calls 60
 *
 * Skips (exit 2) when the server is unreachable. Results go to
 * scripts/scenarios/results/<stamp>.{md,json} (gitignored).
 */
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { check, type Assertion } from "./lib/assert.mts";

interface Scenario {
  id: string;
  title: string;
  /** Why this exists — usually a real client session that went wrong. */
  origin?: string;
  tool: string;
  args: Record<string, unknown>;
  /** Expect the tool to return isError. */
  expectError?: boolean;
  /** Assertions against the parsed JSON text of the first content block (or the raw text when expectError). */
  expect: Assertion[];
  /** Skip when the previous run in this process already hit this many upstream-heavy calls. */
  weight?: number;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = arg("url") ?? "http://localhost:8787/mcp";
  const only = arg("only");
  const maxCalls = Number(arg("max-calls") ?? 40);
  const dir = new URL("./cases/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  let scenarios: Scenario[] = [];
  for (const f of files) scenarios.push(JSON.parse(await readFile(new URL(f, dir), "utf8")));
  if (only) scenarios = scenarios.filter((s) => s.id.includes(only));

  const client = new Client({ name: "discogs-scenarios", version: "0.1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  } catch (e) {
    console.error(`SKIP: cannot reach ${url} — start the dev server first (npm run dev:token). ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const info = client.getServerVersion();
  console.error(`connected to ${info?.name} ${info?.version} at ${url}; ${scenarios.length} scenarios`);

  const rows: { id: string; title: string; ok: boolean; ms: number; weight: number; checks: { label: string; ok: boolean; detail: string }[]; error?: string }[] = [];
  let spent = 0;
  for (const s of scenarios) {
    const weight = s.weight ?? 1;
    if (spent + weight > maxCalls) {
      rows.push({ id: s.id, title: s.title, ok: false, ms: 0, weight, checks: [], error: `skipped: call budget (${spent}+${weight} > ${maxCalls})` });
      continue;
    }
    spent += weight;
    const t0 = performance.now();
    let checks: { label: string; ok: boolean; detail: string }[] = [];
    let error: string | undefined;
    try {
      const res = (await client.callTool({ name: s.tool, arguments: s.args })) as { isError?: boolean; content: { type: string; text?: string }[] };
      const text = res.content?.[0]?.text ?? "";
      if (Boolean(res.isError) !== Boolean(s.expectError)) {
        error = s.expectError ? `expected a tool error, got success` : `tool error: ${text.slice(0, 200)}`;
      }
      let root: unknown = text;
      if (!res.isError) {
        try { root = JSON.parse(text); } catch { /* keep text */ }
      }
      checks = s.expect.map((a) => {
        const r = check(root, a);
        return { label: a.label ?? `${a.path} ${a.op}${a.value !== undefined ? " " + JSON.stringify(a.value) : ""}`, ok: r.ok, detail: r.detail };
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const ms = performance.now() - t0;
    const ok = !error && checks.every((c) => c.ok);
    rows.push({ id: s.id, title: s.title, ok, ms, weight, checks, error });
    console.error(`${ok ? "PASS" : "FAIL"} ${s.id} (${ms.toFixed(0)} ms)${error ? " — " + error : ""}`);
    for (const c of checks.filter((c) => !c.ok)) console.error(`     ✗ ${c.label}: ${c.detail}`);
  }
  await client.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = new URL("./results/", import.meta.url);
  await mkdir(outDir, { recursive: true });
  const md = [
    `# Scenario run — ${stamp} — ${info?.name} ${info?.version}`,
    "",
    `| id | result | ms | weight | failing checks |`,
    `|---|---|---:|---:|---|`,
    ...rows.map((r) => `| ${r.id} | ${r.ok ? "PASS" : "FAIL"} | ${r.ms.toFixed(0)} | ${r.weight} | ${r.error ?? r.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`).join("; ")} |`),
    "",
    `${rows.filter((r) => r.ok).length}/${rows.length} passed; approximate upstream weight spent: ${spent}/${maxCalls}.`,
  ].join("\n");
  await writeFile(new URL(`${stamp}.md`, outDir), md);
  await writeFile(new URL(`${stamp}.json`, outDir), JSON.stringify({ stamp, server: info, rows }, null, 2));
  console.log(md);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
