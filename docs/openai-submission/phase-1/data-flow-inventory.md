# Phase 1A — data-flow and compatibility inventory

**Audited baseline:** `cfb0790` / server `v1.4.0`
**Scope:** the MCP surface in `src/mcp`, its shared Discogs client/cache, and
the shared core functions called by MCP tools
**Method:** static inspection of tool registrations, handlers, types, caching,
OAuth context, prompts, resources, and tests

## Classification legend

| Code | Meaning |
|---|---|
| `CC0` | Discogs catalogue content identified as CC0 in the Discogs API Terms |
| `USER-OWN` | Restricted Data belonging to the authenticated Discogs user |
| `USER-OTHER` | Restricted Data belonging to another Discogs user |
| `MARKET` | Marketplace-related Restricted Data, including prices and availability |
| `IMAGE` | Discogs-hosted or contributed image URL |
| `DERIVED` | DIG-computed score, profile, affinity, match, warning, or summary |
| `OPERATIONAL` | Health, version, timing, cache, rate, or diagnostic information |

This is a data classification for engineering review, not a legal conclusion.
Written Discogs guidance is required before any Restricted Data is submitted to
or returned through OpenAI.

## Transport and identity flow

```text
MCP client
  -> OAuth 2.1 authorization request at the Worker
  -> Discogs OAuth 1.0a authorization
  -> Worker-issued bearer token containing encrypted Discogs grant properties
  -> per-session ToolContext { CachedDiscogsClient, username, userId }
  -> Discogs API GET requests
  -> Cloudflare KV read-through cache
  -> derived logic / field projection
  -> MCP text result containing pretty-printed JSON
```

Current MCP result behavior:

- successful structured values are serialized only into `content[].text`;
- there is no `outputSchema` or `structuredContent`;
- tool errors use `isError: true` and free-form English text;
- errors have no stable code and authentication errors do not include an MCP
  `mcp/www_authenticate` challenge;
- all tools are registered on the same authenticated MCP server surface.

## Current cache inventory

| Data | Cache keys | Current TTL | Scope | Observations |
|---|---|---:|---|---|
| Search results | `search:{query}:{sortedParams}` | 6 h | shared | Public catalogue query; key has no user identity |
| Release | `release:{id}` | 24 h | shared | Includes catalogue, community, image, and marketplace fields |
| Master | `master:{id}` | 24 h | shared | Includes catalogue, image, and marketplace fields |
| Master versions | `versions:{id}:{sortedParams}` | 12 h | shared | Includes aggregate in-collection/in-wantlist counts |
| User profile | `profile:{username}` | 24 h | username | Client method exists; not currently used by an MCP tool |
| Collection pages | `collection:{username}:{sortedParams}` | 4 h | username | Restricted user data; authorization/visibility partitioning must be verified |
| Collection aggregate | `collection-full:{username}` | 4 h | username | Up to 3,000 slim records, including rating and date added |
| Wantlist pages | `wants:{username}:{sortedParams}` | 4 h | username | Restricted user data; authorization/visibility partitioning must be verified |
| Wantlist aggregate | `wantlist-full:{username}` | 4 h | username | Up to 3,000 slim records, including rating and date added |
| Shelf counts | `shelf-counts:{username}` | 15 min | username | REST-only derived collection/wantlist totals |
| REST identity | `api-identity:{tokenPrefix}` | 24 h | token prefix | REST-only; contains username and numeric user ID |
| Pending OAuth state | `oauth-state:{requestToken}` | 10 min | request token | Contains the parsed auth request and temporary token secret |

The Discogs API Terms currently prohibit displaying API content more than six
hours older than Discogs and require storage only as long as necessary. The
12–24 hour catalogue TTLs therefore remain a Phase 2 blocker. Phase 1 records
the mismatch but does not change it.

## Tool-by-tool data flow

Cold-call estimates are upper bounds from the current loops. Cache hits can
reduce them to zero. “Collection pages” and “wantlist pages” mean 1–30 Discogs
requests each because aggregation stops after 3,000 records.

### Operational tools

| Tool | Intent | Inputs | Data read | Upstream/cache | Current output | Proposed v1 |
|---|---|---|---|---|---|---|
| `ping` | Connection health | None | `OPERATIONAL` server clock | No Discogs call; no cache | `status`, current `time` | Exclude; transport health is not a user workflow |
| `auth_status` | Show connected account | None | `USER-OWN` username and numeric user ID from bearer-token props | No Discogs call; no cache | `authenticated`, `username`, `discogsUserId` | Exclude; unnecessary identity disclosure to the model |
| `server_info` | Server version/capabilities | None | `OPERATIONAL` package version and static mood list | No Discogs call; no cache | `name`, `project`, `version`, `capabilities`, `supportedMoods` | Exclude; listing metadata should describe capability |

### Catalogue and pressing tools

| Tool | Intent | Data classes | Cold upstream cost | Cache paths | Material current outputs | Proposed v1 |
|---|---|---|---:|---|---|---|
| `search_discogs` | Search catalogue and mark owned releases | `CC0`, community counts, `USER-OWN` collection membership, `DERIVED` | 1 search + 1–30 collection pages | search; collection pages + aggregate | IDs/type/title/year/country/format/label/genre/style/master ID, have/want, `inCollection` | Include, conditional on own-data permission |
| `get_release` | Inspect one concrete edition | `CC0`, community counts, `MARKET`, `IMAGE`, `DERIVED`, raw user-contributed notes/identifiers | 1 release | release | Catalogue fields, notes, tracklist, ratings, have/want, lowest price, for-sale count, matrix/runout, credits, companies, pedigree, cover image | Include with minimization, source link, and UGC boundary |
| `get_master_release` | Inspect an abstract album/master | `CC0`, `MARKET`, `IMAGE` | 1 master | master | Catalogue fields, main release, tracklist, lowest price, for-sale count, cover image | Include with source link; marketplace/image fields conditional |
| `get_release_versions` | List/filter editions of a master | `CC0`, aggregate community counts, `DERIVED` ranking | 1–3 version pages | master versions | Version identity, label/catalog number, country/date/format, aggregate in-collection/in-wantlist counts | Include; cap and disclose truncation |
| `find_best_pressing` | Rank editions on sonic/collector/value axis | `CC0`, community counts, `MARKET`, `USER-OWN` membership, `DERIVED`, user-contributed evidence text | optional release + master + 1–3 version pages + 1–30 collection pages + up to 16 release details | release; master; versions; collection pages + aggregate | Album survey metadata, caveats, baseline, ranked pressing dossiers, `inYourCollection` | Include, conditional on own-data and marketplace permission |
| `compare_pressings` | Compare 2–5 specific release IDs | `CC0`, community counts, `MARKET`, `USER-OWN` membership, `DERIVED`, user-contributed evidence text | 2–5 release details + 1–30 collection pages | release; collection pages + aggregate | Axis, caveats, top-pick sentence, pressing dossiers, `inYourCollection` | Include, conditional on own-data and marketplace permission |

### Collection, wantlist, and recommendation tools

| Tool | Intent | Data classes | Cold upstream cost | Cache paths | Material current outputs | Proposed v1 |
|---|---|---|---:|---|---|---|
| `search_collection` | Filter authenticated user's collection, including mood mapping | `USER-OWN` collection, ratings, dates; `CC0`; `DERIVED` | 1–30 collection pages | collection pages + aggregate | Query/mood, counts, truncation/pagination, full slim items including rating and date added | Include; minimize date fields unless explicitly needed |
| `get_collection_stats` | Aggregate authenticated user's taste | `USER-OWN` collection and ratings; `CC0`; `DERIVED` | 1–30 collection pages | collection pages + aggregate | Username, counts, distributions, average personal rating, taste profile | Include but omit username by default |
| `explore_user_collection` | Browse another user's public collection | `USER-OTHER` collection, ratings, dates; `CC0`; `DERIVED` | 1–30 target-user collection pages | target collection pages + aggregate | Target username, counts/truncation/pagination, full slim items | Exclude from v1 pending explicit Discogs permission and visibility isolation |
| `get_wantlist` | Browse own or another user's wantlist | `USER-OWN` or `USER-OTHER` wantlist, ratings, dates; `CC0` | 1–30 wantlist pages | wantlist pages + aggregate | Username, counts/truncation/pagination, full slim items | Include as own-account-only in v1; cross-user form excluded |
| `get_recommendations` | Recommend unowned catalogue masters from mood/style/reference | `USER-OWN` collection; `CC0`; community counts; `DERIVED` profile/affinity | optional release + 1–30 collection pages + up to 4 searches | release; collection pages + aggregate; search | Basis/styles plus ranked candidates, affinity, have/want | Include, conditional on own-data permission |
| `discover_similar` | Profile-based catalogue or cross-user discovery | `USER-OWN`, optional own wantlist, optional `USER-OTHER`, `CC0`, community counts, `DERIVED` | catalogue: 1–30 collection + optional 1–30 wantlist + up to 4 searches; cross-user: add up to 90 collection pages | collection/wantlist pages + aggregates; search | Mode/profile basis; catalog suggestions or target usernames, similarity, their ratings and suggestions | Exclude current combined tool from v1; later split a catalog-only tool from cross-user behavior |

## Shared result structures

### Slim collection/wantlist item

Current collection and wantlist tools can return:

`id`, `title`, `artists`, `year`, `genres`, `styles`, `labels`, `formats`,
personal `rating`, and `dateAdded`.

The release and catalogue fields are necessary for identification and matching.
Rating is necessary only for explicitly personalized ranking. `dateAdded` is
not necessary for the proposed v1 OpenAI workflows and should be omitted unless
a future tool explicitly offers recent-addition analysis.

### Pressing dossier

Current pressing results can return:

- edition identity: release ID, title, country, year/date, label, catalogue
  number, and format;
- community data: rating/rating count and have/want counts;
- marketplace data: lowest price and number for sale;
- evidence: notes excerpt, signals, reputation detail, mastering credits,
  matrix/runout, and pressing companies;
- derived fields: score, evidence coverage, verdict, factor scores/weights,
  rating delta, explanation, rank, and owned status.

Raw notes, names, credits, labels, companies, identifiers, titles, and URLs are
untrusted external text/data. They must never be interpreted as instructions.

## Field necessity and disclosure inventory

| Field/category | Current use | Necessity for proposed v1 | Privacy/terms treatment |
|---|---|---|---|
| Authenticated username | Context, stats/wantlist echo, auth status | Usually unnecessary in results | Restricted user identifier; omit by default |
| Numeric Discogs user ID | Auth context and `auth_status` | Not necessary for user workflows | Internal authorization value; never return in v1 |
| Own collection contents | Search, ownership checks, profiles, recommendations | Necessary for explicitly personalized requests | Restricted Data; disclose and require user authorization plus Discogs approval |
| Own wantlist contents | Wantlist view and optional profile boost | Necessary only when explicitly requested | Restricted Data; disclose and require approval |
| Personal ratings | Ranking and profile weighting | Necessary for rating-aware personalization | Restricted Data; return only when relevant |
| Date added | Returned on slim items; REST recent-additions feature | Not necessary for proposed OpenAI v1 | Omit from OpenAI tool results |
| Other users' collections/wantlists | Cross-user discovery | Not necessary for v1 | Exclude unless Discogs explicitly approves |
| Community have/want counts | Popularity, collector-demand, version ranking | Useful evidence | Discogs-derived; attribute and link to source |
| Community rating/count | Pressing evidence | Useful evidence | Discogs-derived; attribute and link to source |
| Lowest price / number for sale | Value and collector scoring | Conditional; useful for value axis | Marketplace Restricted Data; approval required |
| Release notes | Edition evidence | Only short excerpts where materially useful | CC0 per current terms but untrusted UGC; sanitize/limit |
| Matrix/runout | Pressing identification and pedigree | Necessary for evidence dossiers | CC0 identifier; untrusted text; source link required |
| Credits/labels/companies | Mastering and pressing pedigree | Necessary for evidence dossiers | CC0 catalogue content; source link required |
| Cover image URL | Display only | Not needed without a custom UI | Omit from text-only v1 unless later approved and used |
| Third-party URLs | Present in raw API/resources | Not necessary in tool output | Do not pass through; generate only approved Discogs links |
| Cache keys/request IDs/logs | Internal operation | Never necessary | Never return |
| Cache age/freshness | Not currently returned | Necessary for honest use of cached data | Return normalized freshness metadata, not internal keys |
| Rate-limit diagnostics | Partial notes; REST has call counts | User-facing retry guidance may be necessary | Return bounded warning/retry information, not internal telemetry |

## Source link and attribution requirements

Every result containing Discogs-derived data should carry:

- the notice `Data provided by Discogs.`;
- one or more ordinary, crawlable links to the corresponding `discogs.com`
  page(s), without `nofollow` behavior under DIG's control;
- a freshness indicator for cached data;
- a warning when the result is truncated, partial, thinly evidenced, or based on
  dynamic marketplace/community data.

Preferred link patterns, pending Discogs confirmation:

| Entity | Link pattern |
|---|---|
| Release | `https://www.discogs.com/release/{id}` |
| Master | `https://www.discogs.com/master/{id}` |
| User collection | `https://www.discogs.com/user/{encodedUsername}/collection` |
| User wantlist | `https://www.discogs.com/wantlist?user={encodedUsername}` or Discogs-approved equivalent |
| Search | Direct links for each returned entity, not a generic DIG page |

## Prompts and resources

The server currently exposes ten prompts and seven resources in addition to the
15 tools.

Prompts:

- `find-best-pressing`, `best-value-pressing`, `most-collectible-pressing`,
  `compare-pressings`;
- `recommend-by-mood`, `pick-from-my-collection`, `discover-new-music`,
  `rank-my-wantlist`, `my-taste-profile`, `cross-user-discovery`.

The `cross-user-discovery` prompt is outside the proposed v1 scope. The other
prompt text is a useful workflow baseline, but OpenAI starter prompts and the
bundled skill will be reviewed separately in later phases.

Resources:

- own collection and own wantlist;
- release, master, and first-page master versions;
- another user's collection and wantlist.

Some resources return broader/rawer objects than the tools, including full
master/version responses. The proposed OpenAI endpoint should not register
these resources in v1. Existing `/mcp` resources remain unchanged.

## Compatibility baseline

The following are externally observable today and must be treated as existing
contracts for `/mcp`:

- 15 tool names and their current input parameters;
- JSON serialized into `content[].text`;
- current top-level result fields and free-form error strings;
- current prompts and resources;
- legacy `/sse` transport;
- REST routes used by the browser extension.

Phase 1B therefore forbids modifying the existing endpoint to achieve the
OpenAI-specific inventory. The implementation path is additive:

1. retain current `/mcp`, `/sse`, and `/api/*` behavior;
2. add a separately registered OpenAI MCP surface at a final path chosen in
   Phase 0;
3. share transport-independent core logic where safe;
4. add the OpenAI envelope, metadata, authentication declarations, and field
   minimization only on the new surface;
5. test both surfaces to prevent regression.

## Discovery findings that block later phases

- Catalogue cache TTLs exceed the currently documented six-hour freshness
  ceiling.
- User-data cache partitioning and private-visibility behavior need explicit
  isolation tests before any broader distribution.
- Tool results lack structured content, output schemas, source links,
  attribution, stable errors, and freshness metadata.
- Current error handling can pass upstream/free-form messages to clients.
- Current combined tools expose cross-user modes that cannot be included in a
  conservative v1 inventory without splitting or isolating the endpoint.
- Resource responses are broader than the proposed minimum tool contract.
- OAuth scopes and per-tool security schemes are not yet a stable,
  reviewer-visible contract.
