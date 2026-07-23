# Security Policy

## Supported versions

Security fixes are applied to the latest released server and browser extension. Older tags remain
available for reproducibility but are not maintained as separate support branches.

| Component | Supported |
|---|---|
| Latest `v*` server release | Yes |
| Latest `ext-v*` extension release | Yes |
| Older releases and forks | No guaranteed fixes |

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
[private vulnerability reporting](https://github.com/WOIII-me/Discogs-MCP/security/advisories/new)
on this repository. We'll respond as soon as we can.

Please include the affected endpoint/component, impact, reproduction conditions, and the smallest
safe proof needed to verify the issue. Do not include real access tokens, private collection data,
or another user's personal information. You can expect an acknowledgement within seven days; fix
and disclosure timing depends on severity and coordination needs.

## Scope & design notes

- The server is **read-only** — it never modifies your Discogs collection, wantlist, or
  marketplace data.
- Secrets (Discogs consumer key/secret) are stored as Cloudflare Worker **secrets**, never
  committed. `.dev.vars` is git-ignored.
- A deployed Worker is publicly reachable. Lock login to specific accounts by setting the
  `ALLOWED_DISCOGS_USERS` allowlist (see the README). Leaving it unset allows any Discogs user to
  authenticate to *their own* data via OAuth.
- Auth bridges MCP OAuth 2.1 to Discogs OAuth 1.0a; the Discogs token is encrypted into the MCP
  access token and not stored server-side.
- Discogs catalogue and user-provided fields are untrusted external data. Security reports about
  cache isolation, OAuth audience/scope handling, or prompt injection are in scope.
