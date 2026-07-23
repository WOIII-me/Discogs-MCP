# OpenAI submission content draft

**Status:** conditional and non-submittable

**Prepared:** 2026-07-23

**Runtime impact:** none

This directory converts the frozen Phase 1 contract into a portal-oriented
submission workbook. It is safe to prepare before Discogs guidance arrives
because it neither changes the Worker nor claims that any unresolved approval
has been granted.

The package is deliberately incomplete. Values controlled by Discogs,
OpenAI account verification, the production deployment, or the project owner
remain empty and are represented as named gates. The repository validator will
fail if those values are silently filled while the workbook still has
`conditional-draft` status.

## Files

| File | Purpose |
|---|---|
| [`submission-content.json`](submission-content.json) | Machine-readable listing copy, server/auth fields, annotations, reviewer cases, gates, and attestations |
| [`portal-workbook.md`](portal-workbook.md) | Human checklist for entering the approved values in OpenAI's submission portal |
| [`policy-gap-register.md`](policy-gap-register.md) | Evidence-based gaps between the current public surfaces and submission requirements |
| [`oauth-preflight.md`](oauth-preflight.md) | Reproducible read-only check of public OAuth metadata and unauthenticated challenges |
| [`owner-signoff.md`](owner-signoff.md) | Approval record to complete immediately before submission |

The exact test prompts and expected tool routes remain canonical in
[`../phase-1/submission-contract.json`](../phase-1/submission-contract.json).
This draft references their IDs rather than copying a second version that could
drift.

## Safe work that this unlocks

- review and refine listing copy without publishing it;
- prepare accurate read-only tool annotations;
- map the portal's five positive and three negative tests;
- assign every external decision to an owner and evidence requirement;
- catch drift between the listing, plugin manifest, and Phase 1 contract in CI.

It does **not** authorize a deployment, domain verification, reviewer-account
creation, policy attestation, or directory submission.

## Validation

Run:

```sh
npm run validate:submission
npm test -- test/openai-submission-contract.test.ts
npm run check:oauth
```

The first two commands are local checks. The OAuth command performs three
unauthenticated reads against the selected public origin and runs in report
mode unless `--strict` is supplied. Nothing in this directory is imported by
`src/` or included in the Worker bundle.
