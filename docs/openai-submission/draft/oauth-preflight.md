# OpenAI OAuth public-contract preflight

**Observed:** 2026-07-23

This is a read-only check of the public metadata and unauthenticated challenge
that ChatGPT uses to discover an MCP server's OAuth configuration. It sends
only three unauthenticated `GET` requests and never creates a client, starts an
authorization flow, calls a tool, or changes server state.

## Run it

Report mode always exits successfully after a completed inspection, even when
it identifies readiness gaps:

```sh
npm run check:oauth -- --base-url https://discogs-mcp.woiii.workers.dev
```

Use strict mode as a staging or release gate after the Phase 0 origin and Phase
4 OAuth work are complete:

```sh
npm run check:oauth -- --base-url https://mcp.woiii.me --strict
```

Add `--json` for machine-readable evidence. The command never accepts or emits
tokens, client secrets, reviewer credentials, or authorization codes.

## Current production observation

On 2026-07-23, the existing Workers endpoint passed 14 of 18 public checks:

- protected-resource and authorization-server discovery return HTTP 200;
- the canonical protected resource is the current `/mcp` URL;
- the authorization, token, and dynamic-registration endpoints are HTTPS;
- bearer tokens in the `Authorization` header are advertised;
- PKCE `S256` is advertised;
- unauthenticated `/mcp` returns HTTP 401 with the correct path-specific
  `resource_metadata` challenge.

The four submission-readiness gaps were:

1. protected-resource metadata does not advertise `discogs.read`;
2. protected-resource metadata has no HTTPS `resource_documentation` URL;
3. authorization-server metadata does not advertise `discogs.read`;
4. the HTTP Bearer challenge does not request `discogs.read`.

These findings are evidence for Phase 4 planning, not permission to modify or
deploy the current OAuth provider. The final strict run must target the chosen
permanent origin and must be followed by authenticated DCR, PKCE, resource,
scope, refresh, revocation, and tool-level challenge tests.

## Coverage boundary

This preflight cannot prove that tokens are correctly issued or validated. It
does not cover issuer/signature verification, audience, expiry, scope
enforcement, refresh, revocation, callback compatibility, reviewer-account
login, per-tool `securitySchemes`, or `_meta["mcp/www_authenticate"]`. Those
remain Phase 4 and Phase 8 acceptance tests.

The checks follow [OpenAI's current Apps SDK authentication guidance](https://developers.openai.com/apps-sdk/build/auth).
