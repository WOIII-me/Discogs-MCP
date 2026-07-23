# OpenAI submission portal workbook

Use this checklist only after the corresponding gates in
[`submission-content.json`](submission-content.json) have evidence. Do not copy
an inferred answer into the portal.

## 1. Submission and publisher

| Portal field | Draft value | State before submission |
|---|---|---|
| Submission type | Plugin with MCP and bundled skill | Prepared |
| App name | DIG for Discogs | Prepared; reconfirm against Discogs guidance |
| Publisher | WOIII.me | Pending publisher identity verification |
| Category | Lifestyle | Provisional; verify against current portal choices |
| Languages | English | Provisional |
| Countries | Not selected | Owner decision required |

The submitting OpenAI organization and user must be the verified publisher and
must have the portal permissions required to create and submit the app.

## 2. Listing copy and assets

Use the name, descriptions, website, and release notes from
`submission-content.json`; CI keeps the descriptions aligned with the
unpublished plugin manifest.

Before submission:

- produce the final logo in the current portal dimensions and format;
- verify that the logo and name do not imply Discogs endorsement;
- publish and test a stable support URL or approved support contact;
- publish and test Terms of Service;
- revise the privacy policy to match the actual OpenAI-facing data flow;
- capture screenshots only if the final integration adds component UI.

## 3. MCP server and authentication

The current public Workers URL is **not** entered here by default. The submitted
server should use the separately approved permanent origin and the narrow tool
inventory from the Phase 1 contract.

Complete in order:

1. Record the permanent HTTPS MCP origin and OAuth resource identifier.
2. Implement and deploy the approved OpenAI-facing endpoint.
3. Scan tools in the portal and compare every imported schema and annotation
   against the Phase 1 contract.
4. Verify OAuth discovery, authorization, callback, token refresh, and expiry.
5. Enter domain-verification material only in its intended deployment or portal
   location; do not commit it here.
6. Finalize the Content Security Policy after the scan. With no component UI,
   all allowlists should remain empty unless the production implementation
   demonstrates a specific need.

## 4. Tool annotations

All ten proposed v1 tools are read-only and non-destructive. Their
`openWorldHint` is `true` because they reach the external Discogs service or
account; this does not mean that they write or publish data. The proposed
annotations and individual justifications are in `submission-content.json`.

After the production tool scan, compare the imported values one by one. Do not
attest until the running endpoint, not merely this draft, exhibits the stated
behavior.

## 5. Starter prompts and test cases

Use the three starter prompts from `submission-content.json`.

The portal evaluation set is fixed at:

- positive: P1, P2, P3, P4, P5;
- negative: N1, N2, N3.

The prompts, expected tools, arguments, schemas, and refusal boundaries are in
[`../phase-1/submission-contract.json`](../phase-1/submission-contract.json).
Replace fixture placeholders with stable reviewer-safe Discogs IDs only after
the reviewer account is available. Run all eight cases against the exact
production submission URL and preserve redacted evidence.

## 6. Reviewer access

Provide a dedicated fixture account whose collection and wantlist contain no
sensitive or personal test data. Its login must not require MFA or coordination
with a person during review. Store credentials only in OpenAI's reviewer fields,
never in Git, issue comments, CI variables used by pull requests, or the plugin
bundle.

## 7. Final attestations

Only an authorized owner completes the attestations. At minimum, verify that:

- written Discogs conditions are implemented and evidenced;
- the live privacy policy names the collected/transmitted data, purposes,
  recipients, retention, and user controls accurately;
- third-party data access is authorized;
- tool annotations match the running endpoint;
- publisher authority and country availability are correct;
- all eight portal tests pass on the production origin;
- repository and generated submission artifacts contain no credentials.

Record the evidence and sign-off in [`owner-signoff.md`](owner-signoff.md), then
change the machine workbook status only in the same reviewed change that fills
the gated values.
