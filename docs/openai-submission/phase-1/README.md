# OpenAI submission readiness — Phase 1 contract package

**Status:** conditional contract freeze
**Baseline audited:** commit `cfb0790`, server `v1.4.0`
**Prepared:** 2026-07-23
**Runtime impact:** none

This directory contains the Phase 1A discovery baseline and the Phase 1B
contract proposed for a future OpenAI Plugin Directory submission. It is a
public, reviewable specification. Nothing here is imported by the Worker,
included in its bundle, or deployed to current MCP users.

## What is frozen

- The OpenAI integration remains read-only.
- Existing `/mcp`, `/sse`, and `/api/*` contracts remain unchanged.
- The submission should use a separate, additive OpenAI-facing MCP endpoint so
  its reviewed tool inventory can be narrower than the existing public server.
- Tool results use a versioned structured envelope with Discogs attribution,
  source links, warnings, and freshness information.
- Operational tools and cross-user discovery are not part of the proposed v1
  submission surface.
- Existing clients receive no field removals, renames, or behavior changes.

## What remains conditional

The word “frozen” describes the engineering contract, not permission to ship.
Implementation and submission remain gated by:

1. written Discogs guidance covering OpenAI processing, Restricted Data,
   permitted caching, attribution, derived scoring, and the product name;
2. the final publisher identity and OpenAI organization;
3. the permanent MCP hostname and OAuth resource identifier;
4. a reviewer account/fixture with suitable non-sensitive test data.

If Discogs imposes a stricter condition, that condition wins and this contract
must be revised before runtime implementation.

## Artifacts

| Artifact | Purpose |
|---|---|
| [Data-flow inventory](data-flow-inventory.md) | Every current tool, resource, prompt, data class, upstream call, cache, output, and compatibility concern |
| [Output contract](output-contract.md) | Named result schemas, shared envelope, field minimization, errors, and compatibility rules |
| [Threat model](threat-model.md) | Assets, trust boundaries, threats, mitigations, and verification requirements |
| [Acceptance tests](acceptance-tests.md) | Golden prompts plus the exact five positive and three negative portal cases |
| [Decision register](decision-register.md) | Phase 1B decisions, conditional branches, v1 tool inventory, and reopening rules |

## Phase 1 completion statement

Phase 1A is complete for the audited baseline: the current data flows, result
shapes, cache behavior, trust boundaries, and prompt surface are recorded.

Phase 1B is conditionally complete: the target contract is frozen wherever the
decision is independent of Phase 0, and every Phase 0 dependency is represented
as an explicit gate rather than an unstated assumption.

No Phase 2–4 implementation has started. In particular, the repository still
contains the current cache TTLs, tool registration metadata, OAuth behavior,
and text-only MCP results described in the inventory.

## Source hierarchy

When sources disagree, use this order:

1. written conditions supplied by Discogs for this application;
2. current Discogs API Terms of Use and trademark policy;
3. current OpenAI Plugin Directory and Apps SDK documentation;
4. this Phase 1 contract;
5. current implementation behavior, retained only for compatibility where it
   does not conflict with higher-priority requirements.

Relevant external sources:

- [OpenAI: Submit plugins](https://developers.openai.com/codex/submit-plugins)
- [OpenAI: Prepare an app for submission](https://developers.openai.com/apps-sdk/deploy/submission)
- [OpenAI: App guidelines](https://developers.openai.com/apps-sdk/app-guidelines)
- [OpenAI: Build an MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [OpenAI: Authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI: Optimize metadata](https://developers.openai.com/apps-sdk/guides/optimize-metadata)
- [Discogs: API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use)
- [Discogs: Application Name and Description Policy](https://support.discogs.com/hc/en-us/articles/360009207054-Application-Name-and-Description-Policy)
