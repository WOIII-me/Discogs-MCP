# Rate limits and errors

- `AUTH_REQUIRED`: explain that the user must connect their Discogs account. Never ask
  them to paste a token or password into the conversation.
- `INVALID_INPUT`: identify the invalid field and request only the missing or corrected
  value.
- `NOT_FOUND`: state that the release, master, or item was not found; do not expose the
  raw upstream body.
- `PRIVATE_DATA`: do not retry around a privacy boundary. Offer an own-account workflow.
- `RATE_LIMITED`: preserve retry guidance and avoid uncontrolled repeated calls.
- `PARTIAL` or `DEFERRED`: present available evidence, state what remains incomplete,
  and avoid a confident final ranking when coverage is insufficient.
- Upstream failure: describe the temporary limitation without exposing request IDs,
  cache keys, stack traces, authorization headers, or internal logs.
