# Jev notes eval (plan Phase 1)

Measures how well a reader extracts **catalog claims** from Discogs release
text, against `plans/jev-and-mcp-apps-plan.md` §1.5. Nothing here runs in the
Worker; it imports the production question set (`src/utils/catalog-claims.ts`)
and client (`src/clients/jev.ts`) so the eval measures the shipped path.

## Files

| Path | What |
|---|---|
| `fixtures/notes.dev.json` | Development set: real public Discogs text, labels drafted by an assistant (`labelStatus: "provisional"`). Used to tune criteria. |
| `fixtures/notes.heldout.json` | Held-out set. **Must be labelled by a human collector** (`labelStatus: "reviewed"`) and never looked at while tuning. Go/no-go counts only this file with `--reviewed-only`. |
| `fetch-notes.mts` | Pulls public release text (unauthenticated, paced) into an unlabeled fixture file. |
| `fixtures/notes.heldout.unlabeled.json` | 63 real releases across 7 albums (Blue Train, Dark Side of the Moon, Rumours, Selected Ambient Works 85-92, OK Computer, Gould's Goldberg Variations, Con Todo El Mundo), unlabelled. |
| `fixtures/heldout-worksheet.md` | The same 63 as a Markdown worksheet for a human reviewer. |
| `make-worksheet.mts` / `import-worksheet.mts` | Render fixtures to the worksheet; parse the filled worksheet back into `notes.heldout.json` with `labelStatus: "reviewed"`. |
| `run-notes.mts` | Runs interpreters + paired injected variants, writes `results/<set>-<stamp>.{md,json}`. |
| `lib/rules.mts` | Baseline (a): the regex layer's effective beliefs (stated / not_stated only). |
| `lib/jev.mts` | Baseline (b): Jev via the production question set and mapping. |
| `lib/haiku.mts` | Baseline (c): Claude Haiku 4.5 with structured outputs. Optional; needs a local `@anthropic-ai/sdk` install. |
| `lib/inject.mts` | Paired adversarial variants. Two kinds: **instruction** sentences aimed at a reader/AI (the flip-rate gate) and plain **assertions** (uptake is informational — a text reader *should* report them; the cap on ranking influence is the defence there). |
| `lib/metrics.mts` | Per-label P/R, certainty-gate coverage and accepted-answer error, injection flips, latency, tokens. |

## Run

```bash
node scripts/eval/jev/run-notes.mts --set dev --interpreters rules,jev
node scripts/eval/jev/run-notes.mts --set dev --interpreters jev-noguard,jev-noulguard,jev-regexguard   # injection-guard ablations
node scripts/eval/jev/run-notes.mts --set heldout --interpreters rules,jev,haiku --reviewed-only
```

`JEV_API_KEY` (and optional `JEV_MODEL`) are read from the environment or from
`.dev.vars` (gitignored). `results/` is gitignored; copy a report into the PR
description when it matters.

## Labelling the held-out set (human step)

1. Open `fixtures/heldout-worksheet.md`. Do **not** run any interpreter on the held-out file first.
2. In each block's `labels:` YAML, write one of `stated` / `denied` / `not_stated` / `contradictory` per
   claim, or leave a claim blank for a genuinely borderline case and say why in `notes:`.
3. Import: `node scripts/eval/jev/import-worksheet.mts` (defaults to the paths above). Blocks left
   entirely blank are excluded, so the set can grow over several sittings.
4. Run: `node scripts/eval/jev/run-notes.mts --set heldout --interpreters rules,jev --reviewed-only`.
5. Compare with the go / no-go table below. Only this run counts for widening `JEV_BETA_USERS`.

## Labelling convention

Each claim gets exactly one of `stated`, `denied`, `not_stated`, `contradictory`
per `src/utils/catalog-claims.ts` `CLAIM_DEFINITIONS`.

- Format descriptors are part of the text. `Reissue`, `Repress` and `Remastered`
  **deny** `firstPressing`; `Promo`, `Test Pressing`, `White Label` **state**
  `nonConsumer`.
- Label or cover misprints are **not** `qcComplaints`. That claim is for
  defects of the record itself (noise, warps, off-centre, non-fill).
- A distributor or "manufactured by" company is not a `pressingPlant` unless a
  plant is actually named (RTI, Pallas, Terre Haute, Philips Walthamstow…).
- "audiophile vinyl", "180 g" and "remastered" are not source claims. Only an
  explicit analog/digital source statement counts.
- Record the reasoning for any borderline call in `labelNotes`.

## Go / no-go (held-out, reviewed labels only)

| Metric | Threshold |
|---|---|
| Per-label precision / recall, incl. rare labels | P ≥ 0.9, R ≥ 0.8 |
| Accepted-answer error at the chosen certainty gate | ≤ 5 % |
| Coverage after abstention | ≥ 70 % |
| Injection flip rate (paired not_stated → stated) | ≤ 2 % |
| p95 latency through the Worker | ≤ 800 ms |

The dev set is a smoke test. It is one album, jazz-heavy and assistant-labelled;
it can reject a model but cannot approve one. Before any go decision, build the
held-out set across ≥ 6 masters and genres (plan §1.3) and have it reviewed.
