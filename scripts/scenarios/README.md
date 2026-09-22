# Scenario runner (Layer 2)

Real MCP calls against the **local dev server** with JSON-path assertions. It turns the manual
checks from client sessions into one command, and every case records the real session that
motivated it (`origin`).

```bash
npm run dev:token                      # or the `mcp-dev` launch config
npm run scenarios                      # all cases
node scripts/scenarios/run.mts --only lz2
node scripts/scenarios/run.mts --max-calls 60   # approximate upstream budget guard (default 40)
```

Exit codes: 0 all pass, 1 a failure, 2 server unreachable (skipped). Reports land in
`results/` (gitignored). Weights approximate first-run Discogs calls; cached reruns cost
nearly nothing, so run twice when a first run is rate-limited.

## Writing a case

`cases/NN-id.json`:

```json
{
  "id": "short-id", "title": "…", "origin": "which real session went wrong and how",
  "tool": "find_best_pressing", "args": { "…": "…" }, "weight": 17,
  "expectError": false,
  "expect": [ { "path": "topPressings[*].signals", "op": "matches", "value": "George Piros", "label": "…" } ]
}
```

Paths: dot segments, `[n]`, `[*]` (fan-out). Ops: `eq neq gte lte gt lt exists absent truthy falsy
includes matches notMatches lengthGte lengthLte lengthEq every some none` (`every/some/none` take
an `each` assertion evaluated per element; `$` is the element itself). Use `valuePath` instead of `value` to compare
against another path in the same result.

Cases that assert on `catalogClaims` need Jev enabled in `.dev.vars`; they are the only ones that
call a third party.

## What this layer does not cover

Model behaviour (which tools a client picks, how many times it loops, whether it hedges claims).
That is Layer 3: headless `claude -p` / `codex exec` runs graded on the transcript. Its prompts are
the natural-language versions of these cases.
