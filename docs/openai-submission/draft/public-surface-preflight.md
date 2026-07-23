# OpenAI public-surface preflight

**Observed:** 2026-07-23

This is a read-only check of the public website, privacy policy, Terms of
Service, and support routes expected by the submission workbook. It sends four
unauthenticated `GET` requests, does not submit forms, and never changes website
or repository state.

## Run it

Report mode records gaps without failing the command:

```sh
npm run check:surfaces -- --site-url https://woiii.me
```

After the owner has approved and published the final policy/support surfaces,
use strict mode as a staging or release gate:

```sh
npm run check:surfaces -- --site-url https://woiii.me --strict
```

Add `--json` for machine-readable evidence.

## Current public observation

On 2026-07-23, `https://woiii.me` passed 14 of 25 project readiness checks.

The website itself passed:

- HTTP 200 and HTML response;
- consistent DIG for Discogs product name;
- consistent WOIII.me publisher identity.

The privacy page is reachable and already identifies the product, publisher,
Discogs, ChatGPT, retention/storage, user controls, and a contact address. Its
three detected gaps are:

1. Cloudflare is not identified as infrastructure/processor;
2. username and rating data categories are not disclosed alongside collection
   and wantlist data;
3. absolute phrases such as “collects nothing,” “no data collection,” and
   “nowhere else” conflict with the documented service-provider data flow.

The `/terms` route does not provide usable terms content. It lacks an HTTP 200
response, product/publisher identity, the Discogs dependency, and the required
non-affiliation statement.

The `/support` route does not provide usable support content. It lacks an HTTP
200 response, product/publisher identity, a canonical contact, and guidance not
to submit passwords, tokens, secrets, or credentials.

## Coverage boundary

This is a deterministic content-presence check, not legal review or approval.
A strict pass cannot establish that a disclosure is complete, accurate under
applicable law, or consistent with final Discogs conditions. The owner must
still review and approve the actual language against the final data flow,
retention behavior, subprocessors, user controls, and written Discogs guidance.

The checks operationalize the public-surface and retention principles in
[OpenAI's app guidelines](https://developers.openai.com/apps-sdk/app-guidelines)
and [security/privacy guidance](https://developers.openai.com/apps-sdk/guides/security-privacy).
