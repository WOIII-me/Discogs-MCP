# Phase 1B — OpenAI tool and output contract

**Contract status:** conditionally frozen
**Target version:** `openai-v1`
**Compatibility rule:** additive endpoint; no change to existing `/mcp`

This document is the implementation specification for the future OpenAI-facing
MCP surface. Type notation is TypeScript-like for readability; Phase 3 will
translate the named schemas into the MCP SDK's supported Zod/JSON Schema form.

## 1. Endpoint boundary

The target is a dedicated MCP route on the final Phase 0 origin, provisionally:

```text
https://<canonical-origin>/openai/mcp
```

The exact origin and path are not final until the hostname/OAuth resource
decision is signed. The architectural boundary is final:

- `/mcp` retains all current tools, prompts, resources, text results, and input
  compatibility;
- the OpenAI route registers only the reviewed v1 inventory;
- both routes may call the same transport-independent core functions;
- the OpenAI route owns its tool metadata, output schemas, field projection,
  attribution, freshness, and stable error mapping;
- the OpenAI route does not register the current broad MCP resources.

This boundary is what makes the Phase 1B decisions non-disruptive to current
users.

## 2. Tool-level metadata contract

Every submitted tool must declare:

```text
title: human-readable action title
description: precise “Use this when…” guidance plus meaningful exclusions
inputSchema: minimal documented parameters
outputSchema: the matching named data schema below
securitySchemes: [{ type: "oauth2", scopes: ["discogs.read"] }]
annotations:
  readOnlyHint: true
  destructiveHint: false
  openWorldHint: true
```

`openWorldHint` is `true` because these tools read from the external Discogs
service/account even though they never write or publish anything. This value
must be rechecked in Developer Mode and justified consistently in the portal.

No tool may request a conversation transcript, opaque model context, arbitrary
URL, access token, password, or internal identifier.

## 3. Common successful result envelope

All submitted tools return `ToolEnvelope<T>` as `structuredContent`. For
non-UI clients and debuggability, `content[].text` contains a faithful JSON
serialization of the same envelope.

```ts
type ToolEnvelope<T> = {
  contractVersion: "openai-v1";
  data: T;
  attribution: {
    provider: "Discogs";
    notice: "Data provided by Discogs.";
  };
  sources: SourceRef[];
  warnings: Warning[];
  dataFreshness: DataFreshness;
};

type SourceRef = {
  kind: "release" | "master" | "collection" | "wantlist" | "search";
  id?: number;
  label: string;
  url: string; // HTTPS discogs.com URL, never an API URL or arbitrary upstream URL
};

type Warning = {
  code:
    | "PARTIAL_RESULT"
    | "TRUNCATED_RESULT"
    | "RATE_LIMITED"
    | "THIN_EVIDENCE"
    | "DYNAMIC_MARKET_DATA"
    | "UNTRUSTED_CATALOG_TEXT"
    | "FILTER_FALLBACK";
  message: string;
};

type DataFreshness = {
  retrievedAt: string; // RFC 3339 time at upstream retrieval, preserved in cache
  expiresAt: string;   // RFC 3339 cache expiry
  maxAgeSeconds: number; // never greater than the approved ceiling
  state: "fresh" | "near_expiry";
};
```

Rules:

- `sources` is non-empty whenever `data` includes Discogs-derived content.
- `retrievedAt` is the actual upstream retrieval time, not the current response
  time on a cache hit.
- Results at or beyond their approved maximum age must be refreshed or fail;
  they must not be labeled fresh.
- `warnings` uses stable codes and concise user-readable messages.
- Raw cache keys, request IDs, trace IDs, Worker internals, and upstream headers
  are forbidden.
- `_meta` is not a place to hide personal data; treat it as user-visible.

## 4. Shared domain schemas

```ts
type PageInfo = {
  offset: number;
  returned: number;
  total: number;
  hasMore: boolean;
  truncated: boolean;
};

type CatalogIdentity = {
  id: number;
  title: string;
  artists: string[];
  year: number | null;
  genres: string[];
  styles: string[];
  formats: string[];
  labels: string[];
};

type PersonalCollectionItem = CatalogIdentity & {
  rating?: number; // include only when used by the requested workflow
};

type CountBreakdown = {
  name: string;
  count: number;
};

type ShareBreakdown = {
  name: string;
  sharePercent: number;
};

type MatrixRunout = {
  type: string;
  value: string;
  description?: string;
};

type PressingCompany = {
  name: string;
  entityTypeName?: string;
};

type ScoreFactor = {
  score: number;      // 0–100
  confidence: number; // 0–1
  weight: number;     // 0–1
};

type ReputationDetail = {
  label?: {
    id?: number;
    name: string;
    weight: number;
  };
  engineers: string[];
  stampers: string[];
  studio?: string;
  formatCues: string[];
};

type PressingDossier = {
  releaseId: number;
  title: string;
  country?: string;
  year: number;
  released?: string;
  label: string;
  catalogNumber: string;
  format: string;
  communityRating: number;
  communityRatingCount: number;
  communityHave: number;
  communityWant: number;
  lowestPrice?: number | null; // conditional on Discogs marketplace permission
  currency?: string;           // required whenever lowestPrice is present
  numberForSale?: number;      // conditional on Discogs marketplace permission
  notesExcerpt?: string;       // bounded, sanitized, and labeled untrusted
  overallScore: number;
  evidenceCoverage: number;
  verdict: string;
  factors: Record<string, ScoreFactor>;
  signals: string[];
  reputationDetail: ReputationDetail;
  masteringCredits: string[];
  matrixRunout: MatrixRunout[];
  pressingCompanies: PressingCompany[];
  ratingDelta: {
    value: number | null;
    albumBaselineRating: number;
  };
  whyItScores: string;
  inAuthenticatedUsersCollection?: boolean;
  rank?: number;
};
```

Field renames such as `catno` → `catalogNumber`, `rating` →
`communityRating`, and `have` → `communityHave` apply only to the additive
OpenAI contract. Existing `/mcp` fields do not change.

## 5. Named schemas for the proposed v1 inventory

### 5.1 `SearchCollectionOutput`

Tool: `search_collection`
Title: **Search your Discogs collection**

```ts
type SearchCollectionData = {
  query: string | null;
  detectedMood: string | null;
  appliedFilters: {
    genres: string[];
    styles: string[];
    decades: string[];
    minimumRating?: number;
  };
  collectionSize: number;
  page: PageInfo;
  items: PersonalCollectionItem[];
};

type SearchCollectionOutput = ToolEnvelope<SearchCollectionData>;
```

Do not return username, numeric user ID, instance/folder IDs, or `dateAdded`.

### 5.2 `SearchDiscogsOutput`

Tool: `search_discogs`
Title: **Search the Discogs catalog**

```ts
type SearchDiscogsData = {
  totalResults: number;
  results: Array<{
    id: number;
    type: "release" | "master" | "artist" | "label";
    title: string;
    year?: number;
    country?: string;
    formats: string[];
    labels: string[];
    genres: string[];
    styles: string[];
    masterId?: number;
    communityHave?: number;
    communityWant?: number;
    inAuthenticatedUsersCollection?: boolean;
  }>;
};

type SearchDiscogsOutput = ToolEnvelope<SearchDiscogsData>;
```

Each result must have its own source link. No image or arbitrary external URL
is returned.

### 5.3 `GetReleaseOutput`

Tool: `get_release`
Title: **Get a Discogs release**

```ts
type GetReleaseData = {
  releaseId: number;
  title: string;
  artists: string[];
  year: number;
  released?: string;
  country?: string;
  masterId: number | null;
  labels: Array<{ name: string; catalogNumber: string }>;
  formats: string[];
  genres: string[];
  styles: string[];
  notesExcerpt?: string;
  tracklist: Array<{ position: string; title: string; duration?: string }>;
  community: {
    ratingAverage?: number;
    ratingCount?: number;
    have?: number;
    want?: number;
  } | null;
  marketplace?: {
    lowestPrice: number | null;
    currency: string;
    numberForSale: number;
  };
  matrixRunout: MatrixRunout[];
  masteringCredits: string[];
  pressingCompanies: PressingCompany[];
  pedigree: {
    score: number;
    confidence: number;
    signals: string[];
    detail: ReputationDetail;
  };
};

type GetReleaseOutput = ToolEnvelope<GetReleaseData>;
```

`marketplace` is omitted entirely if permission is absent. Cover images are
omitted from the text-only v1.

### 5.4 `GetMasterReleaseOutput`

Tool: `get_master_release`
Title: **Get a Discogs master release**

```ts
type GetMasterReleaseData = {
  masterId: number;
  title: string;
  artists: string[];
  year: number;
  genres: string[];
  styles: string[];
  mainReleaseId: number;
  tracklist: Array<{ position: string; title: string; duration?: string }>;
  marketplace?: {
    lowestPrice: number | null;
    currency: string;
    numberForSale: number;
  };
};

type GetMasterReleaseOutput = ToolEnvelope<GetMasterReleaseData>;
```

### 5.5 `GetReleaseVersionsOutput`

Tool: `get_release_versions`
Title: **List release versions**

```ts
type GetReleaseVersionsData = {
  masterId: number;
  totalVersions: number;
  matchingVersions: number;
  page: Pick<PageInfo, "returned" | "total" | "hasMore" | "truncated">;
  versions: Array<{
    releaseId: number;
    title: string;
    label: string;
    catalogNumber: string;
    country: string;
    released: string;
    format: string;
    communityInCollection: number;
    communityInWantlist: number;
  }>;
};

type GetReleaseVersionsOutput = ToolEnvelope<GetReleaseVersionsData>;
```

Every returned version receives a release source link, in addition to the
master link.

### 5.6 `FindBestPressingOutput`

Tool: `find_best_pressing`
Title: **Find the best pressing**

```ts
type FindBestPressingData = {
  album: {
    title: string;
    artists: string[];
    originalYear: number;
    masterId: number;
    totalVersionsSurveyed: number;
    candidatesScored: number;
    candidatesAttempted: number;
    versionsListTruncated: boolean;
  };
  axis: "sonic" | "collector" | "value";
  partial: boolean;
  albumBaselineRating: number;
  dataCaveats: string[];
  topPressings: PressingDossier[];
};

type FindBestPressingOutput = ToolEnvelope<FindBestPressingData>;
```

The result must never imply measured sound quality. `dataCaveats`, coverage,
and partial/truncation warnings are required, not optional presentation hints.

### 5.7 `ComparePressingsOutput`

Tool: `compare_pressings`
Title: **Compare Discogs pressings**

```ts
type ComparePressingsData = {
  axis: "sonic" | "collector" | "value";
  partial: boolean;
  albumBaselineRating: number;
  dataCaveats: string[];
  topReleaseId: number;
  pressings: PressingDossier[];
};

type ComparePressingsOutput = ToolEnvelope<ComparePressingsData>;
```

Replace the current free-form `topPick` sentence with `topReleaseId` on the
OpenAI endpoint; the model can summarize from structured evidence. Existing
`/mcp` retains `topPick`.

### 5.8 `GetCollectionStatsOutput`

Tool: `get_collection_stats`
Title: **Analyze your Discogs collection**

```ts
type GetCollectionStatsData = {
  totalItems: number;
  analyzedItems: number;
  truncated: boolean;
  genres: CountBreakdown[];
  styles: CountBreakdown[];
  decades: CountBreakdown[];
  formats: CountBreakdown[];
  topLabels: CountBreakdown[];
  topArtists: CountBreakdown[];
  ratings: {
    ratedCount: number;
    averagePersonalRating: number | null;
  };
  tasteProfile: {
    dominantStyles: ShareBreakdown[];
    dominantGenres: ShareBreakdown[];
  };
};

type GetCollectionStatsOutput = ToolEnvelope<GetCollectionStatsData>;
```

Omit the username because the result is implicitly scoped to the authenticated
account.

### 5.9 `GetOwnWantlistOutput`

Tool: `get_wantlist` on the OpenAI endpoint
Title: **Get your Discogs wantlist**

```ts
type GetOwnWantlistData = {
  totalItems: number;
  fetchedItems: number;
  page: PageInfo;
  items: PersonalCollectionItem[];
};

type GetOwnWantlistOutput = ToolEnvelope<GetOwnWantlistData>;
```

The OpenAI input schema has no `username` parameter. It always reads the
authenticated account. Existing `/mcp` keeps its optional username behavior.
`dateAdded` is omitted.

### 5.10 `GetRecommendationsOutput`

Tool: `get_recommendations`
Title: **Recommend music from your Discogs taste**

```ts
type GetRecommendationsData = {
  basis: string;
  searchedStyles: string[];
  recommendations: Array<{
    masterId: number;
    title: string;
    year?: number;
    genres: string[];
    styles: string[];
    matchedVia: string;
    tasteAffinity: number;
    communityHave?: number;
    communityWant?: number;
  }>;
};

type GetRecommendationsOutput = ToolEnvelope<GetRecommendationsData>;
```

The description and response must present affinity as a heuristic derived from
the user's collection, not an objective quality score.

## 6. Named baseline schemas for tools excluded from v1

These names document the complete current public surface. They are not
registered on the proposed OpenAI endpoint.

```ts
type PingData = { status: "pong"; time: string };

type AuthStatusData = {
  authenticated: true;
  username: string;
  discogsUserId: number;
};

type ServerInfoData = {
  name: string;
  project: string;
  version: string;
  capabilities: string[];
  supportedMoods: string[];
};

type ExploreUserCollectionData = {
  username: string;
  totalItems: number;
  matchingItems: number;
  truncated: boolean;
  offset: number;
  returned: number;
  hasMore: boolean;
  items: Array<PersonalCollectionItem & { dateAdded?: string }>;
};

type DiscoverSimilarSuggestion = {
  releaseId?: number;
  masterId?: number;
  title: string;
  artists?: string[];
  year?: number;
  genres: string[];
  styles: string[];
  matchedVia?: string;
  theirRating?: number;
  tasteAffinity: number;
  communityHave?: number;
  communityWant?: number;
};

type DiscoverSimilarData =
  | {
      mode: "catalog";
      profileBoostedByWantlist: boolean;
      dominantStyles: string[];
      suggestions: DiscoverSimilarSuggestion[];
    }
  | {
      mode: "cross-user";
      profileBoostedByWantlist: boolean;
      users: Array<{
        username: string;
        collectionSize: number;
        profileSimilarity: number;
        suggestions: DiscoverSimilarSuggestion[];
      }>;
    };
```

Before a later submission can include cross-user discovery, `discover_similar`
must be split into independently reviewable catalog-only and cross-user tools
with separate inputs, schemas, descriptions, tests, and permission decisions.

## 7. Stable error contract

Failures return `isError: true`, concise text content, and structured error data:

```ts
type ToolError = {
  contractVersion: "openai-v1";
  error: {
    code:
      | "AUTH_REQUIRED"
      | "INSUFFICIENT_SCOPE"
      | "INVALID_INPUT"
      | "NOT_FOUND"
      | "PRIVATE_DATA"
      | "RATE_LIMITED"
      | "UPSTREAM_UNAVAILABLE"
      | "DEFERRED"
      | "INTERNAL_ERROR";
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
  };
};
```

Rules:

- `AUTH_REQUIRED` and `INSUFFICIENT_SCOPE` include
  `_meta["mcp/www_authenticate"]` with the protected-resource URL, error, and
  error description required to trigger ChatGPT's OAuth UI.
- Validate issuer, audience, expiry, and `discogs.read` before the handler uses
  token properties.
- `INTERNAL_ERROR` never includes exception text, stack traces, upstream bodies,
  tokens, usernames, cache keys, or request IDs.
- A Discogs 403 maps to `PRIVATE_DATA`; it must not be bypassed with cached data.
- A partial successful ranking remains a success with warnings. A result with no
  meaningful data is an error, not a misleading empty success.

## 8. Contract stability and versioning

Within `openai-v1`:

- adding an optional field is compatible;
- adding an enum member or warning code requires evaluation because models may
  reason over closed sets;
- removing/renaming a field, changing its type/meaning, broadening data access,
  or changing a tool's side effects is breaking;
- source/attribution/freshness fields are mandatory and cannot be silently
  removed;
- changes to names, descriptions, schemas, annotations, security schemes, or
  `_meta` require a new OpenAI scan and review as documented by OpenAI;
- the current `/mcp` contract has its own compatibility lifecycle and must not
  be coupled to OpenAI publication timing.

If a breaking change is required, create a new contract version and keep the
previous reviewed endpoint available until its users have migrated.

## 9. Phase 3 implementation checklist generated by this contract

- Define Zod output schemas matching every v1 named schema.
- Return both `structuredContent` and a text mirror.
- Implement a projection layer; do not return raw Discogs response objects.
- Store retrieval timestamps with cached values and reject expired content.
- Generate allowlisted `discogs.com` source URLs locally.
- Add attribution and warning builders shared across tools.
- Map errors centrally without raw exception leakage.
- Register per-tool OAuth security schemes and accurate annotations.
- Add schema conformance, source-link, freshness, minimization, and compatibility
  tests before deploying the additive endpoint.
