# Phase 1B — conditional contract freeze and decision register

**Decision date:** 2026-07-23
**State:** accepted for planning; blocked from implementation/submission by the
named Phase 0 gates

## Decision states

- **Frozen:** safe to design against now; reopening requires an explicit reason.
- **Conditional:** chosen default, automatically revisited when Phase 0 evidence
  arrives.
- **Deferred:** no responsible decision can be made yet.

## Decisions

| ID | State | Decision | Reason | Reopen when |
|---|---|---|---|---|
| D01 | Frozen | OpenAI integration is absolutely read-only | Matches product intent and reduces review/user risk | Product scope explicitly changes, requiring a new submission plan |
| D02 | Frozen | Preserve existing `/mcp`, `/sse`, and `/api/*` behavior | Current public/open-source users must not absorb OpenAI-specific breaking changes | A separately planned versioned migration is approved |
| D03 | Frozen | Use an additive OpenAI-facing MCP endpoint with a curated registry | Allows strict schemas/minimization and a smaller review surface without hiding or removing current tools | OpenAI requires the identical endpoint and an alternative compatibility mechanism is proven |
| D04 | Frozen | No custom UI in v1 | Structured text results cover the core use cases; avoids unnecessary image/CSP/UI scope | A UI becomes necessary for a high-value reviewed workflow |
| D05 | Frozen | Use `ToolEnvelope<T>`, structured content, text mirror, attribution, sources, warnings, and freshness | Provides stable machine-readable and human-readable results with required provenance | OpenAI protocol requirements change |
| D06 | Frozen | Exclude `ping`, `auth_status`, and `server_info` from the submitted inventory | They add model-visible operational/identity data but no user workflow | Review tooling explicitly requires one of them |
| D07 | Conditional | Exclude `explore_user_collection` and current `discover_similar` from v1 | Cross-user Restricted Data and high fan-out are unnecessary for first release | Written Discogs permission and an independently reviewed cross-user design exist |
| D08 | Conditional | Submit `get_wantlist` as authenticated-user-only with no username input | Own wantlist supports a core workflow; cross-user access is unnecessary | Discogs permission or product scope changes |
| D09 | Conditional | Marketplace fields are optional schema branches | Value scoring uses them, but they are Restricted Data and dynamic | Discogs approves/denies field use and specifies conditions |
| D10 | Frozen | Omit cover images and arbitrary external URLs in text-only v1 | They are not necessary without UI and expand rights/security surface | A reviewed UI needs them and permission is confirmed |
| D11 | Frozen | Omit username, numeric user ID, date added, folder/instance IDs, cache keys, internal telemetry, and raw logs by default | Data minimization and user intent do not require them | A narrowly defined workflow proves necessity and disclosures are updated |
| D12 | Frozen | Treat every Discogs-returned string as untrusted data | Catalogue and user content can contain adversarial text | Never; this is a trust-boundary invariant |
| D13 | Conditional | Use one minimal OAuth scope, provisionally `discogs.read`, per submitted tool | Entire submitted surface has the same read-only privilege | OpenAI/Discogs requirements call for narrower scopes |
| D14 | Frozen | Existing MCP prompts/resources are not registered on the OpenAI endpoint in v1 | Some are cross-user or return broader raw objects than the reviewed tool schemas | Individually inventoried and reviewed resources/prompts are later required |
| D15 | Frozen | No GitHub/server release is created for Phase 1 documentation | Phase 1 has no runtime or packaged-product change | Runtime implementation ships or a separately versioned specification release is desired |
| D16 | Deferred | Permanent origin and exact OpenAI MCP path | OAuth resource and review lifecycle depend on it | Owner completes Phase 0 origin decision |
| D17 | Deferred | Publisher identity and OpenAI organization | Requires owner verification and permissions | Owner completes publisher verification |
| D18 | Deferred | Final approved Discogs data categories, TTL, and attribution form | Written Discogs response controls these | Discogs conditions are received and archived |
| D19 | Deferred | Countries/regions for publication | Legal/support readiness and publisher decision required | Phase 0 and policy pages are complete |

## Proposed scanner-visible v1 inventory

Every tool below is conditional on Discogs authorizing the relevant data flow.

| Tool | Status | Data scope | Output schema |
|---|---|---|---|
| `search_collection` | Candidate include | Authenticated user's collection only | `SearchCollectionOutput` |
| `search_discogs` | Candidate include | Catalogue plus authenticated user's membership signal | `SearchDiscogsOutput` |
| `get_release` | Candidate include | One catalogue release; marketplace branch conditional | `GetReleaseOutput` |
| `get_master_release` | Candidate include | One master; marketplace branch conditional | `GetMasterReleaseOutput` |
| `get_release_versions` | Candidate include | Versions of one master | `GetReleaseVersionsOutput` |
| `find_best_pressing` | Candidate include | Catalogue evidence plus authenticated user's owned signal; market branch conditional | `FindBestPressingOutput` |
| `compare_pressings` | Candidate include | 2–5 catalogue releases plus authenticated user's owned signal; market branch conditional | `ComparePressingsOutput` |
| `get_collection_stats` | Candidate include | Aggregates over authenticated user's collection | `GetCollectionStatsOutput` |
| `get_wantlist` | Candidate include | Authenticated user's wantlist only | `GetOwnWantlistOutput` |
| `get_recommendations` | Candidate include | Catalogue candidates derived from authenticated user's collection profile | `GetRecommendationsOutput` |

Explicitly absent:

- `ping`, `auth_status`, `server_info`;
- `explore_user_collection`;
- the current combined `discover_similar`;
- all current MCP resources;
- cross-user prompt workflows;
- write, commerce, seller-message, or marketplace-order tools.

## Conditional branches after Discogs response

### Branch A — own-account Restricted Data approved

Keep the ten-tool candidate inventory, subject to any field/retention conditions.

### Branch B — own-account Restricted Data not approved for OpenAI processing

Remove collection/wantlist/profile tools and all ownership/personalization fields.
Redesign as catalogue-only before implementation; do not submit a misleading
personalized listing.

### Branch C — marketplace fields not approved

- Remove `marketplace` from release/master schemas.
- Remove lowest price and number-for-sale from pressing dossiers.
- Rework or remove the `value` axis so the name and behavior remain truthful.
- Update descriptions, prompts, scoring tests, privacy mapping, and portal cases.

### Branch D — cross-user access explicitly approved

Do not silently add it to v1. Design separate tools with independent schemas,
abuse limits, visibility/cache isolation, privacy disclosures, and a new OpenAI
review.

## Privacy-policy mapping for the proposed v1

| Disclosure category | Tools | Purpose | Returned to OpenAI/model? | Retention |
|---|---|---|---|---|
| Discogs account identifier | Authentication/session | Bind OAuth grant to account | Username generally not returned; identity necessarily processed server-side | OAuth grant lifetime; exact provider behavior to document |
| Collection catalogue entries | Search, stats, recommendations, ownership signals | User-requested personalization | Only minimized matching items, aggregates, or booleans | Approved cache ceiling, no longer than necessary |
| Personal ratings | Collection search/stats/recommendation weighting | Rating-aware personalization | Only when necessary or as aggregates | Approved cache ceiling |
| Wantlist entries | Own wantlist tool | User-requested wantlist analysis | Minimized requested page | Approved cache ceiling |
| Catalogue/community data | Search/release/master/version/pressing tools | Identify and compare music releases | Yes, attributed and source-linked | Approved cache ceiling |
| Marketplace data | Release/master/pressing tools | Value/availability evidence | Only if Discogs approves; marked dynamic | Approved cache ceiling, at most six hours under current public terms |
| Derived scores/profiles | Pressing and recommendation tools | Explain rankings and taste fit | Yes, with caveats and evidence coverage | Recomputed from permitted cached inputs; retention decision required |
| Tool request metadata | All tools | Route and secure requests | Only minimal parameters; no full conversation required | Operational retention must be documented |
| OpenAI processing | All submitted tools | Fulfill user requests in ChatGPT/Codex | OpenAI receives tool request/results under its applicable terms | Disclose OpenAI as recipient/processor and link applicable policy |

The current public privacy page must be revised before submission because it
states that data is not shared beyond the user, DIG, and Discogs and documents
current 12–24 hour cache periods.

## Contract-freeze acceptance criteria

Phase 1B is considered conditionally frozen because:

- every current tool has a documented data flow and named baseline schema;
- every proposed v1 tool has a named target schema;
- stable success/error envelopes and compatibility rules are defined;
- scanner-visible include/exclude decisions are explicit;
- privacy categories and attribution/freshness rules are mapped;
- exactly five positive and three negative portal tests are specified;
- unresolved matters are explicit Phase 0 gates with deterministic branches;
- no runtime source, deployment, OAuth configuration, cache behavior, or
  existing user contract has changed.

It is not implementation-ready until D16–D18 are resolved. When they are, add a
dated decision record, revise affected branches, and obtain owner sign-off
before starting Phases 2–4.
