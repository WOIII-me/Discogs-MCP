/**
 * Pull PUBLIC release text from Discogs into an unlabeled fixture file for
 * hand-labelling. Unauthenticated on purpose: the anonymous per-IP budget
 * (~25 req/min) is separate from any user's token budget, so this never
 * competes with real users of the Worker. Paced at one request per 2.6 s.
 *
 * Usage:
 *   node scripts/eval/jev/fetch-notes.mts --master 5460 --limit 24 --out scripts/eval/jev/fixtures/notes.unlabeled.json
 *   node scripts/eval/jev/fetch-notes.mts --ids 6276183,1234 --out ...
 *
 * Only fields the claims reader uses are kept (notes, identifiers, formats,
 * label/country/year/title for orientation). No community, price or user data.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { NotesFixture } from "./lib/types.mts";

const UA = "DiscogsMCP-eval/0.1 +https://github.com/WOIII-me/Discogs-MCP";
const BASE = "https://api.discogs.com";
const PACE_MS = 2600;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (res.status === 429) {
    console.error("429 from Discogs — waiting 65 s");
    await sleep(65_000);
    return get(path);
  }
  if (!res.ok) throw new Error(`Discogs ${res.status} for ${path}`);
  return (await res.json()) as T;
}

interface Version { id: number; label: string; format: string; country: string; released: string; title: string }
interface Release {
  id: number; title: string; year?: number; country?: string; notes?: string;
  labels?: { name: string }[]; formats?: { name: string; descriptions?: string[]; text?: string }[];
  identifiers?: { type: string; value: string; description?: string }[];
  companies?: { name: string; entity_type_name?: string }[];
}

/** Spread picks across labels so the set is not 20 Columbia reissues. */
function diversify(versions: Version[], limit: number): Version[] {
  const byLabel = new Map<string, Version[]>();
  for (const v of versions) {
    const k = v.label.toLowerCase().split(",")[0].trim();
    byLabel.set(k, [...(byLabel.get(k) ?? []), v]);
  }
  const out: Version[] = [];
  const buckets = [...byLabel.values()];
  let i = 0;
  while (out.length < limit && buckets.some((b) => b.length)) {
    const b = buckets[i % buckets.length];
    if (b.length) out.push(b.shift()!);
    i++;
  }
  return out;
}

async function main() {
  const out = arg("out") ?? "scripts/eval/jev/fixtures/notes.unlabeled.json";
  const limit = Number(arg("limit") ?? 24);
  let ids: number[] = [];

  if (arg("ids")) ids = arg("ids")!.split(",").map((s) => Number(s.trim())).filter(Boolean);
  if (arg("master")) {
    const master = Number(arg("master"));
    const first = await get<{ versions: Version[]; pagination: { pages: number } }>(`/masters/${master}/versions?per_page=100&page=1`);
    let versions = first.versions;
    for (let p = 2; p <= Math.min(first.pagination.pages, 3); p++) {
      await sleep(PACE_MS);
      versions = versions.concat((await get<{ versions: Version[] }>(`/masters/${master}/versions?per_page=100&page=${p}`)).versions);
    }
    const vinyl = versions.filter((v) => /vinyl|lp/i.test(v.format));
    const match = arg("match") ? new RegExp(arg("match")!, "i") : null;
    const pool = match ? vinyl.filter((v) => match.test(`${v.label} ${v.format} ${v.country}`)) : vinyl;
    ids = ids.concat(diversify(pool, limit).map((v) => v.id));
    console.error(`master ${master}: ${versions.length} versions, picked ${ids.length}`);
  }

  let existing: NotesFixture[] = [];
  try { existing = JSON.parse(await readFile(out, "utf8")); } catch { /* new file */ }
  const seen = new Set(existing.map((f) => f.releaseId));

  for (const id of ids) {
    if (seen.has(id)) continue;
    await sleep(PACE_MS);
    const r = await get<Release>(`/releases/${id}`);
    const notes = (r.notes ?? "").trim();
    if (!notes && !(r.identifiers ?? []).some((i) => i.description)) {
      console.error(`skip ${id}: no text`);
      continue;
    }
    existing.push({
      id: `r${r.id}`,
      releaseId: r.id,
      title: r.title,
      label: r.labels?.[0]?.name,
      country: r.country,
      year: r.year,
      notes,
      identifiers: (r.identifiers ?? []).slice(0, 30).map((i) => ({ type: i.type, value: i.value, ...(i.description ? { description: i.description } : {}) })),
      formats: (r.formats ?? []).map((f) => [f.name, ...(f.descriptions ?? []), f.text ?? ""].join(" ").trim()),
      companies: (r.companies ?? []).slice(0, 20).map((c) => ({ role: c.entity_type_name ?? "", name: c.name })),
      labels: {},
      labelStatus: "provisional",
      split: "dev",
    });
    console.error(`fetched ${id}: ${r.labels?.[0]?.name ?? "?"} ${r.country ?? "?"} ${r.year ?? "?"} — ${notes.length} chars`);
    await writeFile(out, JSON.stringify(existing, null, 2));
  }
  console.error(`wrote ${existing.length} fixtures → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
