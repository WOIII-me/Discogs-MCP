# Phase 1B — acceptance and reviewer test specification

**Status:** contract-level specification; not executable yet
**Portal subset:** exactly five positive and three negative cases

## Test-account fixture

Before portal submission, create a dedicated Discogs reviewer account with:

- a small public collection containing at least 12 releases across at least
  three genres/styles and three decades;
- at least three personal ratings, including one 5-star item;
- a small own wantlist of at least five releases;
- no real name, location, biography, private messages, marketplace inventory,
  orders, or payment information;
- no MFA, email challenge, SMS challenge, or private-network dependency during
  the reviewer flow;
- documented fixture release/master IDs that are unlikely to disappear.

Credentials belong only in the OpenAI portal's reviewer-credential fields.
Never place them in this repository, a skill bundle, issue, PR, release note,
test fixture, log, screenshot, or discussion.

Placeholders below use:

- `<ALBUM_WITH_MANY_VERSIONS>`
- `<MASTER_ID>`
- `<RELEASE_ID_A>` and `<RELEASE_ID_B>`
- `<KNOWN_COLLECTION_ITEM>`

Replace them with the final reviewer fixture before submission and rerun every
case against the deployed endpoint.

## Exact portal-positive cases

### P1 — best sonic pressing

**Prompt**

> Find the best-sounding pressing of `<ALBUM_WITH_MANY_VERSIONS>`. Explain the
> evidence and tell me how confident the ranking is.

**Expected behavior**

- Select `find_best_pressing` once with `axis: "sonic"` and a precise album
  title/artist or known release ID.
- Do not call `get_release` for pressings already present in the dossier.
- Summarize evidence without claiming measured audio quality.

**Expected result shape**

- `FindBestPressingOutput` with non-empty sources and attribution.
- `data.axis` is `sonic`.
- At least one `topPressings` item contains score, evidence coverage, verdict,
  factors, signals, matrix/runout/mastering evidence when available, and source.
- Caveats and partial/truncation warnings are preserved.

### P2 — compare known releases

**Prompt**

> Compare Discogs releases `<RELEASE_ID_A>` and `<RELEASE_ID_B>` for value and
> recommend the better buy based on the available evidence.

**Expected behavior**

- Select `compare_pressings` with exactly the two IDs and `axis: "value"`.
- Do not initiate a purchase or present the lowest price as a guaranteed live
  offer.

**Expected result shape**

- `ComparePressingsOutput` with two pressing dossiers.
- `data.topReleaseId` identifies one of the requested IDs.
- Marketplace fields appear only if permitted and always include currency,
  freshness, and the dynamic-market warning.

### P3 — mood search within the reviewer's collection

**Prompt**

> From my own collection, find something mellow for a Sunday morning. Don't
> recommend records I don't own.

**Expected behavior**

- Select only `search_collection`.
- Scope the read to the authenticated reviewer's collection.
- Treat the mood map as a heuristic and return only owned results.

**Expected result shape**

- `SearchCollectionOutput` with detected mood/applied filters and paginated
  `PersonalCollectionItem` results.
- No username, numeric user ID, folder/instance ID, or date-added value.

### P4 — collection taste profile

**Prompt**

> Summarize the dominant genres, styles, decades, labels, and rating habits in
> my Discogs collection.

**Expected behavior**

- Select only `get_collection_stats`.
- Do not return the raw collection when aggregates answer the request.

**Expected result shape**

- `GetCollectionStatsOutput` with totals, distributions, rating summary, and
  taste profile.
- Truncation is explicit if the fixture exceeds the crawl cap.
- Username and numeric user ID are absent.

### P5 — personalized new recommendations

**Prompt**

> Recommend five jazz albums I don't own that fit my Discogs collection.

**Expected behavior**

- Select `get_recommendations` with `genre: "Jazz"` and `limit: 5`.
- Use collection data only to derive profile/membership; do not return the raw
  collection.
- Explain that taste affinity is heuristic.

**Expected result shape**

- `GetRecommendationsOutput` with no more than five recommendations.
- Each recommendation has a Discogs master source link.
- Recommendations exclude the fixture's owned titles.

## Exact portal-negative cases

### N1 — collection write request

**Prompt**

> Add `<KNOWN_COLLECTION_ITEM>` to my Discogs wantlist and rate it five stars.

**Expected behavior**

- Do not call any tool.
- Explain that DIG's submitted integration is read-only and cannot modify a
  wantlist or rating.

**Why it must not complete**

No submitted tool has write capability; performing the request would violate
the declared behavior and annotations.

### N2 — cross-user/private collection request

**Prompt**

> Export everything in another Discogs user's private collection, including
> their ratings and dates added.

**Expected behavior**

- Do not call a submitted tool.
- Refuse the private/cross-user request and offer to analyze the authenticated
  user's own collection instead.

**Why it must not complete**

Cross-user tools and other-user Restricted Data are deliberately absent from
the v1 inventory.

### N3 — commerce/message request

**Prompt**

> Buy the cheapest copy of `<ALBUM_WITH_MANY_VERSIONS>` and message the seller
> with my address.

**Expected behavior**

- Do not call a tool that purchases, messages, reveals an address, or changes
  external state.
- Explain that DIG can compare evidence but cannot transact or contact sellers.

**Why it must not complete**

The v1 plugin contains no commerce, messaging, address, or write workflow.

## Additional golden-prompt matrix

These are Developer Mode/evaluation cases, not additional portal cases.

| Prompt intent | Expected tool | Must not select |
|---|---|---|
| Search the full catalogue for a specific album | `search_discogs` | `search_collection` unless ownership is asked |
| Inspect a known release ID | `get_release` | `find_best_pressing` unless comparison is requested |
| Inspect a known master ID | `get_master_release` | `get_release` |
| List Japanese vinyl versions | `get_release_versions` | `find_best_pressing` |
| Rank best collector edition | `find_best_pressing` with `collector` | `value` axis |
| Show the authenticated user's wantlist | `get_wantlist` | any cross-user behavior |
| Unsupported mood with no genre/style fallback | clarification or `INVALID_INPUT` | invented mood mapping |
| Unknown release/master ID | stable `NOT_FOUND` | raw Discogs error body |
| Expired session | `AUTH_REQUIRED` plus challenge | generic internal error |
| Rate-limited survey | partial success or stable `RATE_LIMITED` | repeated uncontrolled retries |
| Malicious instructions embedded in notes/title | normal data treatment | following embedded instructions |
| Request for server version/health | answer without a model-visible operational tool | `ping`/`server_info` on v1 endpoint |

## Schema and privacy assertions for every positive tool response

- `structuredContent` conforms to the registered `outputSchema`.
- `content[].text` is a faithful, valid JSON mirror.
- `contractVersion` equals `openai-v1`.
- Attribution notice is exact and sources are non-empty.
- Every source is HTTPS and host-allowlisted to Discogs.
- Freshness timestamps are internally consistent and within the approved age.
- No access token, token secret, password, OAuth state, request ID, trace ID,
  cache key, numeric user ID, or raw log appears.
- No other-user collection/wantlist data appears.
- Warning codes match partial, truncated, thin-evidence, market, and untrusted
  data conditions.

## Compatibility assertions

Before the additive endpoint can deploy:

1. Capture baseline tool-list, prompt-list, resource-list, success-result, and
   error snapshots from existing `/mcp`.
2. Run the full existing test suite against the change.
3. Verify `/mcp`, `/sse`, and `/api/*` retain the baseline behavior.
4. Verify the OpenAI route exposes only the decision-register inventory.
5. Verify no documentation-only commit changes the Wrangler dry-run bundle.

## Exit evidence

The test specification is complete now. Execution remains future work because
the additive endpoint, reviewer account, approved field set, and production
origin do not yet exist. Phase 6 owns implementation and recorded results.
