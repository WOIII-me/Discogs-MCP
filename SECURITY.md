# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
[private vulnerability reporting](https://github.com/WOIII-me/Discogs-MCP/security/advisories/new)
on this repository. We'll respond as soon as we can.

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
