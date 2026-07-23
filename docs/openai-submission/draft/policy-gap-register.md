# Submission policy gap register

**Observed:** 2026-07-23

**Scope:** public repository and public WOIII.me routes

**Status:** working engineering assessment, not legal advice

This register separates facts that can be verified now from decisions that
require Discogs, OpenAI, or the project owner. Written Discogs conditions take
precedence over this assessment.

| ID | Current evidence | Submission risk | Required closure evidence | Owner | State |
|---|---|---|---|---|---|
| PG-01 | `https://woiii.me/` returns HTTP 200. | Low; website exists but must continue to identify the same publisher. | Final pre-submission URL check and publisher verification. | Project owner | Open |
| PG-02 | `https://woiii.me/privacy` returns HTTP 200, but its current claims include effectively no collection/sharing while the documented OAuth and OpenAI-facing flows transmit account and Discogs data to service providers. | High; the policy may not accurately disclose data categories, purposes, recipients, retention, and user controls. | Published policy reviewed against the final data-flow inventory and approved by the owner. | Project owner | Revision required |
| PG-03 | `https://woiii.me/terms` returns HTTP 404. | Blocking; the listing currently has no public Terms of Service URL. | Public HTTPS terms page returning 200 and matching the submitted product/publisher. | Project owner | Missing |
| PG-04 | `https://woiii.me/support` returns HTTP 404, and repository artifacts use both `support@woiii.me` and `help@woiii.me`. | Blocking; the canonical support route/contact is unresolved. | Owner-selected support contact, tested delivery, public support URL if required, and consistent listing/manifest/site values. | Project owner | Decision required |
| PG-05 | Current cache documentation states releases/masters 24 h and versions 12 h; Discogs' public API terms state a maximum API-content display age of six hours. | Blocking for the submitted endpoint unless written Discogs guidance permits the final behavior. | Written Discogs condition plus tests showing compliant freshness, purge, and response metadata. | Discogs + engineering | Pending external guidance |
| PG-06 | The public README identifies Discogs and the integration, but submission-specific attribution placement and the required non-affiliation notice are not yet tested on final model/UI output. | Blocking for final output compliance. | Golden-response evidence showing adjacent Discogs attribution/source links and the approved non-affiliation text wherever required. | Discogs + engineering | Pending implementation |
| PG-07 | The public Worker exposes a broader tool surface, including operational and cross-user tools, than the proposed ten-tool directory contract. | Blocking if the current endpoint were submitted unchanged. | Separate permanent endpoint whose scanned inventory exactly matches the frozen contract. | Engineering | Pending gated implementation |
| PG-08 | The production MCP origin and OAuth resource identifier are not final. The 2026-07-23 public preflight also found missing `discogs.read` declarations, resource documentation, and challenge scope. | Blocking; tool scan, OAuth review, and domain verification require stable production identifiers and complete metadata. | Owner-approved HTTPS origin, strict `npm run check:oauth` pass, authenticated OAuth tests, and domain-verification evidence. | Project owner + engineering | Decision required |
| PG-09 | No reviewer-safe Discogs fixture account or portal-only credential record exists in this repository. | Blocking; authenticated cases cannot be reviewed reliably. | Dedicated non-sensitive fixture, no interactive MFA, all eight portal tests passing, credentials entered only in the portal. | Project owner + engineering | Missing |
| PG-10 | The publisher identity, submission countries, final logo, and authorized attestor have not been recorded. | Blocking for final portal submission. | Verified OpenAI organization, approved availability, production asset, and completed owner sign-off. | Project owner | Decision required |
| PG-11 | Discogs approval scope, restricted-data handling, derived scoring, caching, attribution, and name usage remain represented as Phase 0 gates. | Blocking; public general terms do not substitute for application-specific written guidance. | Dated written response or agreement linked from a private evidence register, with public-safe decision summary committed here. | Project owner + Discogs | Pending external guidance |

## Source requirements represented here

- [OpenAI submission requirements](https://learn.chatgpt.com/docs/submit-plugins)
  cover listing fields, MCP/auth details, reviewer access, test cases,
  availability, and attestations.
- [OpenAI app guidelines](https://developers.openai.com/apps-sdk/app-guidelines)
  require accurate metadata and privacy disclosures, minimized responses, and
  authorized third-party access.
- [OpenAI Apps SDK reference](https://developers.openai.com/apps-sdk/reference)
  defines the required read-only, destructive, and open-world annotation
  semantics used in the draft.
- [Discogs API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use)
  govern caching/display age, attribution, and non-affiliation presentation.
- [Discogs Application Name and Description Policy](https://support.discogs.com/hc/en-us/articles/360009207054-Application-Name-and-Description-Policy)
  permits descriptive “for Discogs” naming while prohibiting implied official
  affiliation.

## Closure rule

A row closes only when its required evidence exists and the corresponding
machine gate in `submission-content.json` is updated in a reviewed change.
Verbal assumptions and passing local tests are not closure evidence for an
external or owner-controlled gate.
