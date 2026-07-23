# DIG for Discogs

> A [WOIII.me](https://github.com/WOIII-me) project

[![CI](https://github.com/WOIII-me/Discogs-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/WOIII-me/Discogs-MCP/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/WOIII-me/Discogs-MCP?label=server)](https://github.com/WOIII-me/Discogs-MCP/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for Discogs, hosted on Cloudflare Workers. Two things it's good at:

1. **Finding the best-sounding pressing of an album** — surveys every version of a master release, scores each on community ratings, collector demand, format quality, and audiophile markers (MFSL, half-speed masters, renowned mastering engineers, Japanese pressings…), and returns a ranked comparison.
2. **Mood & taste based recommendations** — mood-aware search of your own collection ("mellow Sunday morning"), catalog discovery ranked against your taste profile, and cross-user discovery that mines other collectors' public collections.

Auth is browser-based Discogs OAuth: connect an MCP client to the server URL and you'll be redirected to Discogs to log in. Read-only — the server never modifies your collection.

> **OpenAI directory status:** DIG is not currently listed in OpenAI's Plugin Directory. The
> documentation-only [Phase 1 readiness package](docs/openai-submission/phase-1/README.md) records
> the proposed tool/data contract and remaining approval gates. Its contract tests and
> [unpublished plugin scaffold](openai-plugin/dig-for-discogs/README.md) are development artifacts;
> they do not change the hosted server or existing MCP clients. A conditional
> [portal content draft](docs/openai-submission/draft/README.md) prepares listing fields,
> annotations, tests, and sign-off evidence without filling unresolved approvals.

## Use the hosted server

A public instance runs at **`https://discogs-mcp.woiii.workers.dev`** — open to any Discogs user, no invite needed. Connecting is a one-time browser login per client:

- **Claude Code**: `claude mcp add --transport http --scope user discogs https://discogs-mcp.woiii.workers.dev/mcp`
- **Claude Desktop / claude.ai**: add a custom connector with URL `https://discogs-mcp.woiii.workers.dev/mcp` (requires a plan that allows custom connectors).
- **OpenAI Codex**: add to `~/.codex/config.toml`, then run `codex mcp login discogs`:
  ```toml
  [mcp_servers.discogs]
  url = "https://discogs-mcp.woiii.workers.dev/mcp"
  ```
- Legacy SSE clients can use `/sse` instead of `/mcp`.

The hosted instance is best-effort: Discogs allows 60 requests/min per authenticated user (your own budget — other users don't eat into it), and heavy tools like `find_best_pressing` are bounded to stay inside it. For anything serious, self-host — it's one `wrangler deploy`.

## Quick start (self-hosting)

Prerequisites: Node 18+, a Cloudflare account, and a [Discogs developer app](https://www.discogs.com/settings/developers).

```sh
npm install
npm run setup:kv          # creates OAUTH_KV and CACHE_KV; paste the IDs into wrangler.toml
cp .dev.vars.example .dev.vars   # fill in your Discogs consumer key/secret
npm run dev               # local dev on http://localhost:8787
```

Register the Discogs app with callback URL `http://localhost:8787/callback` for dev. Test with the MCP Inspector:

```sh
npm run inspect
```

### Deploy

```sh
wrangler secret put DISCOGS_CONSUMER_KEY
wrangler secret put DISCOGS_CONSUMER_SECRET
npm run deploy
```

Then update your Discogs app's callback URL to `https://<your-worker>.workers.dev/callback`.

> **Forking?** `wrangler.toml` is checked in with the maintainer's KV namespace IDs. To run your
> own: change `name` (the Worker URL) and replace both KV IDs with the ones from
> `npm run setup:kv`. KV IDs aren't secrets — they're useless without your Cloudflare account.
> To lock login to your account, set the allowlist as a secret (keeps your username private):
> `echo "your_username" | wrangler secret put ALLOWED_DISCOGS_USERS`. Leave it unset to allow any
> Discogs user.

### Connect a client (self-hosted)

Same as the hosted instance, with your own Worker URL:

- **Claude Code**: `claude mcp add --transport http --scope user discogs https://<your-worker>.workers.dev/mcp`
- **Claude Desktop / claude.ai**: add a custom connector with URL `https://<your-worker>.workers.dev/mcp` (requires a plan that allows custom connectors).
- **OpenAI Codex**: add to `~/.codex/config.toml`, then log in:
  ```toml
  [mcp_servers.discogs]
  url = "https://<your-worker>.workers.dev/mcp"
  ```
  ```sh
  codex mcp login discogs
  ```
- Legacy SSE clients can use `/sse` instead of `/mcp`.

The server's prompts surface as **slash commands** in clients that support them (`/find-best-pressing`, `/best-value-pressing`, `/rank-my-wantlist`, …), each scoped to the right tools.

Access control is optional: leave `ALLOWED_DISCOGS_USERS` unset to allow any Discogs user (how the hosted instance runs), or set it to a comma-separated list of Discogs usernames and/or numeric user IDs to keep a private deployment to yourself.

## Local testing with a personal token (no OAuth app)

To try the server against your own Discogs data without registering an OAuth app, use a [personal access token](https://www.discogs.com/settings/developers) and the dev entry point, which serves `/mcp` directly and authenticates from the token:

```sh
echo 'DISCOGS_PERSONAL_TOKEN=your_personal_token' >> .dev.vars
npm run dev:token        # serves http://localhost:8787/mcp, no browser login
```

Then point a client at `http://localhost:8787/mcp` (e.g. `claude mcp add --transport http discogs-local http://localhost:8787/mcp`) and ask away. This path is for **local development only** — it has no OAuth gate. Production (`src/index.ts`) always uses OAuth.

## REST API (for non-LLM clients)

Alongside the MCP interface, the Worker exposes a small read-only **REST API** over the same
engine — intended for a browser extension or other non-LLM clients. It authenticates with
`Authorization: Bearer <token>` where the token is either a **Worker-issued OAuth access
token** (obtained through the same `/authorize` → `/token` flow MCP clients use — this is how
the extension's "Sign in with Discogs" works) or a Discogs **personal access token** (handy
for self-hosters and curl). It enforces the same `ALLOWED_DISCOGS_USERS` allowlist when one
is set, and returns JSON with CORS enabled.

- `GET /api/health` — unauthenticated connectivity check
- `GET /api/whoami` — the authenticated Discogs username
- `GET /api/analyze?release=<id>&axis=&mode=` — compact verdict for one release: this
  pressing's dossier, the album's best pressing, taste-fit, owned/wanted.
  `mode=summary` returns the viewed pressing only (≤1 cold Discogs call; personalization
  `null` when uncached); omitted `mode` = `full`. Responses carry `meta`
  (`level`, `cacheStatus`, `candidatesScored/Target`, `upstreamCalls`); a full analysis
  that can't safely start under the rate budget answers `202 {status:"deferred", retryAfter}`
- `GET /api/analyze?title=<album>&artist=<artist>&axis=` — same, by album
- `GET /api/best-pressing?master=<id>|release=<id>&axis=` — full ranking
- `GET /api/compare?releases=<id,id[,id]>&axis=` — side-by-side comparison
- `GET /api/versions?master=<id>` — list pressings
- `GET /api/taste-fit?release=<id>` — affinity of a release to your collection
- `GET /api/profile` — your shelf, profiled: counts, dominant styles/genres/decades,
  top labels, format split, recently added (served from cached aggregates)
- `GET /api/spin?mood=<mood>` — 1–3 rating-weighted picks *from your own collection*
  matching a mood ("mellow", "latenight", …)

## Browser extension

**Discogs Copilot** — a Chrome side panel that shows pressing intelligence for whatever
Discogs page you're on: verdict + score for the pressing you're viewing, the album's best
pressing on a sonic / collector / value axis, taste-fit against your collection,
owned/wanted badges, an evidence dossier (matrix runouts, mastering credits, plants,
data caveats), and a logged-in home screen with your taste profile and mood-based
what-to-spin picks. Analysis renders progressively (verdict first, survey on intent) so
browsing never exhausts your Discogs rate budget. It consumes the REST API above —
read-only, one-click **Sign in with Discogs** (or a personal access token for
self-hosters), no build step, plain JS.

Install (load unpacked, Chrome 114+) and usage: **[extension/README.md](extension/README.md)**.
Extension releases are tagged `ext-v*`.

## Tools

| Tool | What it does |
|------|--------------|
| `ping`, `auth_status`, `server_info` | Health, identity, capabilities |
| `search_collection` | Mood-aware search of your collection (`query`, `genres`, `styles`, `decades`, `minRating`) |
| `search_discogs` | Full catalog search; results marked `inCollection` |
| `get_release` / `get_master_release` | Release / master details with community data |
| `get_release_versions` | All pressings of a master, filterable by country/format |
| `find_best_pressing` | Rank pressings of an album along an `axis` (`sonic`/`collector`/`value`) using multi-signal evidence-weighted scoring |
| `compare_pressings` | Side-by-side comparison of 2–5 release IDs along a chosen `axis` |
| `get_collection_stats` | Genre/style/decade/format/label analytics + taste profile |
| `explore_user_collection` | Browse another user's public collection |
| `get_wantlist` | Your wantlist, or another user's |
| `get_recommendations` | Recommendations by mood, genre/style, or reference release |
| `discover_similar` | Profile-based discovery; cross-user mining with `otherUsernames` |

## Example conversations

> *"What's the best pressing of OK Computer?"* → `find_best_pressing` ranks the top versions with score breakdowns and audiophile signals.

> *"What should I listen to on a rainy evening — something I already own?"* → `search_collection` maps "rainy" to Cool Jazz / Ambient / Shoegaze / Post-Rock / Trip Hop and filters your collection.

> *"Compare my collection with user xyz and tell me what to buy next."* → `discover_similar` reports your profile similarity and their albums that best match your taste.

## Architecture notes

- **Auth bridge**: MCP clients speak OAuth 2.1 to the Worker (via `@cloudflare/workers-oauth-provider`); the Worker speaks OAuth 1.0a to Discogs. Discogs tokens live encrypted inside the MCP access token (`props`) — no server-side session store.
- **Caching**: all Discogs reads go through a KV read-through cache (releases/masters 24 h, versions 12 h, search 6 h, collections/wantlists 4 h). Collections are additionally cached as a single slim aggregate, so mood search, stats, and recommendations cost zero API calls when warm.
- **Pressing scoring**: pressings are graded along an explicit axis (`sonic` best-sounding / `collector` most desirable / `value` best-per-dollar) from multiple weighted signals — mastering pedigree (reputable label by Discogs id, renowned engineer credits, matrix/runout stamper marks, pressing studio), format/medium, used-market price & scarcity, collector demand, and community rating *delta vs. the album baseline*. Scoring is evidence-weighted (`wᵢ·confidenceᵢ`) so missing data doesn't penalise a pressing. Candidate selection is stratified so audiophile reissues and in-demand originals are both always scored. Non-retail copies (test pressings, promos, acetates, white labels) and non-album items (single / alt-take / bonus discs that ride under the same master) are demoted and flagged so they can't top a "best pressing to buy" ranking despite a reputable label's pedigree.
- **Evidence dossiers**: `find_best_pressing` / `compare_pressings` return a full dossier per pressing, not just a number — the concrete signals found, mastering credits, matrix/runout, a one-line `whyItScores`, an `evidenceCoverage` (0–1) showing how well-supported the score is, and a provisional `verdict`. Verdicts are provisional: read them alongside coverage, and treat the scoring as reputation/community-data-based, not measured sound (the response's `dataCaveats` spell this out).
- **Rate limits**: Discogs allows 60 req/min authenticated. Database calls do not retry a 429 inside the same rate window; expensive surveys stop early and report partial/retry guidance, while OAuth exchanges retry bounded transient failures. The client soft-throttles when the remaining budget is low. `find_best_pressing` fetches details for a bounded candidate set (~16, because the versions endpoint carries no ratings).
- Collections are fetched at 100 items/page up to 3,000 items; beyond that results are truncated and flagged (`truncated: true`).

## Roadmap

Current priorities are additive and preserve the existing MCP/REST contracts:

1. **OpenAI submission readiness** — the [Phase 1 contract package](docs/openai-submission/phase-1/README.md) is complete as a conditional specification. Runtime implementation waits for the documented Discogs, publisher, and origin gates.
2. **Submission hardening** — freshness/attribution enforcement, minimized structured MCP results, tool metadata, OAuth scope validation, and reviewer-safe tests on a separate OpenAI-facing endpoint.
3. **External sonic consensus (opt-in)** — a future enrichment pipeline that summarizes audiophile-community consensus (with source attribution) into an `externalSonic` scoring factor. Off by default; derived verdicts plus source links only, never republished content.

Ideas and feedback → [Discussions](https://github.com/WOIII-me/Discogs-MCP/discussions). Know a reissue label, engineer, or stamper mark the scorer should recognize? [Contributions welcome](https://github.com/WOIII-me/Discogs-MCP/discussions/6) — no code required.

## Development

```sh
npm test        # vitest unit tests (scoring, mood mapping, similarity)
npm run lint    # tsc --noEmit
npm run validate:submission # validate the unpublished plugin and submission contract
npm run build   # wrangler dry-run bundle
```

Project policies and maintenance guides:

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Release process](docs/RELEASING.md)
- [GitHub releases](https://github.com/WOIII-me/Discogs-MCP/releases)
