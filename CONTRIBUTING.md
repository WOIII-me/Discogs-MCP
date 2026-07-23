# Contributing

Thanks for your interest! This is a [WOIII.me](https://github.com/WOIII-me) project.

## Dev setup

```sh
npm install
npm test          # vitest unit tests (no network)
npm run lint      # tsc --noEmit
npm run build     # wrangler dry-run bundle
```

Node 18+ is required. To exercise tools against the real Discogs API locally, use a
[personal access token](https://www.discogs.com/settings/developers) and `npm run dev:token`
(see the README's "Local testing with a personal token" section).

## The easiest, highest-value contribution: pressing reputation data

The "best pressing" scorer leans on curated audiophile knowledge in
[`src/utils/pressing-reputation.ts`](src/utils/pressing-reputation.ts). It's deliberately
seed-sized and benefits enormously from community curation. Great PRs:

- **Reputable reissue labels** — add to `AUDIOPHILE_LABEL_IDS` (keyed by the Discogs label id,
  the reliable match) and/or `AUDIOPHILE_LABEL_NAMES`. Find the label id from any release on
  discogs.com (`/label/<id>-Name`).
- **Mastering engineers** — add to `RENOWNED_ENGINEERS`.
- **Matrix/runout stamper marks** and **pressing studios** — extend `STAMPER_SIGNALS` /
  `REPUTABLE_STUDIOS`.

Please include a one-line rationale (why the label/engineer is well-regarded) in the PR, and
keep weights consistent with the existing entries. Add or update a test in
`test/pressing-reputation.test.ts` when you add a signal.

## Guidelines

- Keep the server **read-only** — no collection/marketplace writes (a deliberate scope decision).
- Run `npm test` and `npm run lint` before opening a PR; CI runs both.
- Match the surrounding code style. Tools live under `src/mcp/tools/`, scoring under `src/utils/`.
- Describe user-data, caching, authentication, or external-service impact in the PR when applicable.
- Never commit Discogs/OpenAI reviewer credentials, OAuth grants, `.dev.vars`, private approval
  correspondence, or production logs.
- Changes to the proposed OpenAI surface should update the relevant
  [`docs/openai-submission/phase-1`](docs/openai-submission/phase-1/README.md) contract and state
  whether a new OpenAI scan/review would be required.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). For usage help,
see [SUPPORT.md](SUPPORT.md); report vulnerabilities through the private route in
[SECURITY.md](SECURITY.md), not through a public issue.
