# Phase 1A — threat model

**System:** DIG for Discogs, proposed OpenAI-facing MCP endpoint
**Baseline:** `cfb0790` / server `v1.4.0`
**Risk posture:** read-only does not mean risk-free

This is a public-safe threat model. It documents required security properties
without publishing credentials, private correspondence, operational secrets,
or step-by-step exploit instructions. Detailed vulnerability evidence should
be handled through the repository's private vulnerability reporting process.

## Assets to protect

- Discogs OAuth access tokens and token secrets.
- Worker-issued OAuth grants and access tokens.
- Temporary OAuth request-token state.
- Authenticated username and numeric user ID.
- Collection, wantlist, personal ratings, and dates added.
- Other users' data and its public/private visibility state.
- Discogs consumer key/secret and Cloudflare bindings.
- Reviewer credentials and fixture-account data.
- Integrity of pressing scores, recommendations, attribution, and freshness.
- Discogs API capacity and the availability of the hosted Worker.
- The trustworthiness of the published OpenAI listing and source repository.

## Trust boundaries

```text
User / ChatGPT
  |  untrusted prompt, OAuth bearer token, tool arguments
  v
OpenAI-facing MCP transport
  |  validated identity, scope, audience, arguments
  v
DIG tool projection and derived logic
  |  signed Discogs requests
  v
Discogs API
  |  untrusted catalogue/user content and response metadata
  v
Cloudflare cache / derived processing
  |  minimized, attributed, fresh structured output
  v
ChatGPT model and user
```

OpenAI/ChatGPT is an additional processor/recipient in the proposed flow. It
must not be described as if data travels only between the user, DIG, and
Discogs.

## Security invariants

1. No submitted tool creates, updates, deletes, purchases, messages, posts, or
   otherwise changes external state.
2. A user can receive only data authorized for the current principal and tool.
3. Cached user data cannot bypass an upstream privacy/visibility decision.
4. Tokens and secrets never appear in tool results, model-visible `_meta`, logs,
   source URLs, exceptions, or repository artifacts.
5. Discogs text is always data and never an instruction to the model or tool.
6. Every Discogs-derived result is fresh enough, attributed, and linked.
7. Derived scores state their evidence limits and never claim measured audio
   quality.
8. Expensive work is bounded by input limits, concurrency limits, and upstream
   rate budget.
9. Authentication validates issuer, audience/resource, expiry, and scope before
   accessing grant properties.
10. Existing endpoints remain behaviorally stable while the additive OpenAI
    endpoint is built and reviewed.

## Threat register

| ID | Threat | Impact | Current observation | Required mitigation | Verification evidence |
|---|---|---|---|---|---|
| T01 | Missing/invalid OAuth token accepted | Unauthorized account access | MCP transport is OAuth-gated; per-tool scheme/challenge is absent | Declare OAuth per tool; verify token in handler; emit standards-compliant challenge | Anonymous, expired, wrong-audience, and wrong-scope tests |
| T02 | Forged or replayed Worker token | Unauthorized use of stored Discogs grant | Provider unwraps Worker tokens; explicit OpenAI contract validation is not implemented | Validate issuer, audience/resource, expiry, grant status, and scope on every call | Token matrix tests and revoked-grant test |
| T03 | OAuth state replay or substitution | Account/session confusion | Temporary state is deleted after callback and expires after 10 minutes | Bind state to auth request; enforce one-time use; preserve PKCE/resource; avoid detailed callback errors | Replay, expiry, mismatched-client, and PKCE tests |
| T04 | Cross-principal cache disclosure | Private collection/wantlist data exposure | User-data cache keys are username-scoped; isolation behavior is not proven | Partition by principal and visibility or cache only demonstrably public data; never serve a cached private response to a different principal | Two-account public/private isolation suite, including warm-cache order reversal |
| T05 | Username alias/case collision in cache | Incorrect account data returned | Keys use caller-provided username strings | Canonicalize only from trusted Discogs identity; include stable principal/visibility partition | Alias/case and rename tests |
| T06 | Prompt injection in catalogue/user text | Model follows malicious notes, titles, labels, credits, profiles, or identifiers | Raw notes and many user-generated strings can reach text output | Project only necessary fields; bound lengths; label as untrusted data; keep instructions outside returned data; add adversarial fixtures | Injection corpus demonstrates data is quoted/summarized, never executed |
| T07 | Malformed or extremely large upstream fields | Excessive tokens, crashes, or output truncation | Some fields are sliced; many arrays/strings have no explicit output caps | Enforce per-field length, array, item, and total-result limits after decoding | Boundary/property tests and oversized fixtures |
| T08 | Raw upstream/internal error disclosure | Personal data, tokens, or implementation detail leakage | Some upstream/error messages are returned as free-form text | Central stable error mapper; generic internal errors; redact logs; never return upstream body | Snapshot tests for every error class plus secret-canary tests |
| T09 | Stale Discogs content | Misleading catalogue/market data and terms violation | Some cache TTLs are 12–24 hours | Approved TTL ceiling at or below six hours; store retrieval time; reject expired entries | Fake-clock TTL tests and production freshness probe |
| T10 | Missing attribution/source links | Discogs terms violation and unverifiable answers | Current tool results lack standardized attribution and links | Mandatory attribution and allowlisted direct Discogs source links | Schema and URL allowlist tests for every success result |
| T11 | Arbitrary/unsafe URL propagation | Phishing or data exfiltration via returned links | Raw API types contain resource/external/image URLs; some resources return broad objects | Generate canonical HTTPS Discogs URLs locally; omit arbitrary third-party URLs | URL scheme/host tests and malicious URL fixtures |
| T12 | Marketplace data presented without context | Financially misleading recommendation | Lowest price and sale count feed scores; currency is not returned | Permission gate; include currency, retrieval time, dynamic-data warning; never describe as a live offer | Marketplace schema and stale-price tests |
| T13 | Derived score overclaim | User treats heuristic as measured sound quality | Caveats and evidence coverage exist on major pressing tools | Preserve caveats/coverage; use “heuristic/evidence-based”; avoid guaranteed claims | Golden response assertions and reviewer prompts |
| T14 | Collection inference beyond intent | Excess personal data exposed to model | Several tools fetch full collection to calculate membership/profile | Return only requested result/projection; omit username, date added, IDs, and raw collection unless needed | Field allowlist tests per tool |
| T15 | Cross-user enumeration | Profiling or bulk extraction of other collectors | Current public tools accept usernames and up to three comparison users | Exclude cross-user tools from v1 pending written permission and abuse controls | Scanner-visible inventory proves absence |
| T16 | Rate-budget exhaustion | Discogs 429s and degraded service | Collection crawls can reach 30 pages; cross-user mode can multiply work | Exclude high-fanout cross-user mode; bound pages/candidates/concurrency; reserve budget; honest retry hints | Cold-cache call-count tests and load test |
| T17 | Denial of service through concurrent scans | Worker/Discogs saturation | Candidate work is bounded and cache uses in-isolate single-flight | Add per-principal concurrency/rate limits and global backpressure; preserve cancellation/timeouts | Concurrency and soak tests |
| T18 | Shared-cache poisoning | Incorrect data served broadly | Public catalogue cache keys are shared | Validate upstream shapes before caching; namespace/version keys; never cache errors | Corrupt-cache and schema-version tests |
| T19 | Reviewer credential exposure | Account takeover or public fixture leakage | Reviewer account does not yet exist | Dedicated least-data account; store credentials only in portal secret fields; no MFA dependency; rotate after review | Repository/history secret scan and reviewer login rehearsal |
| T20 | Scope creep into write/commerce actions | Unexpected side effects or policy rejection | Current server is read-only | No write methods in submitted inventory; exact annotations; negative tests refuse add/buy/message actions | Tool scan plus negative portal cases |
| T21 | Resource/prompt bypass of tool minimization | Broad data exposed outside reviewed schemas | Current `/mcp` registers raw/broad resources and cross-user prompt | Do not register current resources/prompts on OpenAI endpoint; package only reviewed starter prompts/skill later | Capability scan of additive endpoint |
| T22 | Supply-chain or deployment compromise | Malicious Worker or leaked secrets | CI tests/dry-run builds; dependency/security automation limited | Lockfile install, dependency review, Dependabot, secret scanning/push protection where available, protected main, reviewed deploy | CI, repository settings, provenance/deploy runbook |
| T23 | Configuration drift after OpenAI scan | Published metadata differs from reviewed behavior | No OpenAI version exists yet | Treat names/schemas/annotations/security/meta as reviewed configuration; rescan and review changes | Release checklist and portal/version record |
| T24 | Privacy-policy mismatch | Users receive an inaccurate disclosure | Current policy states no sharing and lists 12–24 hour caches | Update policy before submission to name OpenAI processing and actual approved retention/data categories | Legal copy review against data-flow matrix |

## Input-abuse limits for the target contract

| Surface | Limit |
|---|---|
| Release comparison | 2–5 integer release IDs |
| Best-pressing candidates returned | 1–10; default 3 |
| Version pages fetched | Maximum three pages / 300 versions |
| Collection/wantlist crawl | Maximum 30 pages / 3,000 items; truncation warning required |
| Collection/wantlist page returned | Maximum 500 items; smaller defaults preferred for model context |
| Recommendation styles searched | Maximum four |
| Recommendation results | Maximum 30 |
| Free-text query/title/artist/style fields | Explicit bounded Unicode length in Phase 3 |
| Returned note excerpt | Bounded and sanitized; target maximum to be fixed by tests |
| Concurrent release details | Bounded batches; no unbounded `Promise.all` |

## Logging and observability requirements

The implementation needs enough telemetry to operate safely without building a
personal-data log:

- permit aggregate counts, latency, status class, tool name, cache hit/miss, and
  rate-limit events;
- do not log prompts, tool arguments containing usernames, result bodies,
  tokens, OAuth state, collection contents, wantlists, notes, or raw upstream
  errors;
- use ephemeral correlation IDs internally only and never return them to the
  model;
- document retention and access for any production logs before submission;
- alert on authentication failures, unusual high-cost call volume, elevated
  429/5xx rates, and cache isolation test failures.

## Security exit criteria before deployment

- All high-impact threats have implemented controls and automated regression
  tests.
- Private/public two-account cache isolation is demonstrated, not inferred.
- Authentication failure paths trigger OAuth UI without leaking detail.
- An adversarial UGC fixture suite passes across every tool returning external
  text.
- All returned URLs are generated from an allowlist.
- Secret scanning covers the repository and its history; private vulnerability
  reporting is enabled and the SECURITY link works.
- The exact production endpoint inventory matches the conditionally frozen
  inventory in the decision register.
