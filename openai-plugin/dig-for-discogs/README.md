# DIG for Discogs plugin package

This directory is the unpublished, consent-independent plugin scaffold for the future
OpenAI submission. It currently packages one read-only workflow skill. It intentionally
does not contain an app reference, MCP URL, OAuth client configuration, reviewer
credentials, secrets, final legal attestations, or production listing assets.

The app portion remains gated by written Discogs guidance, verified publisher identity,
the permanent MCP origin, and a reviewer-safe account fixture. Adding `apps`,
`mcpServers`, a terms URL, or release-ready assets to the manifest requires those gates
to be resolved and the complete submission validation to be rerun.

Validate this draft from the repository root:

```sh
npm run validate:submission
```

This package is not imported by the Cloudflare Worker and has no effect on `/mcp`,
`/sse`, `/api/*`, or current users.
