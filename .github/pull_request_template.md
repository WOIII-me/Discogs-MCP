**What & why**
Brief description of the change and the motivation.

**Checklist**
- [ ] `npm test` passes
- [ ] `npm run lint` passes (`tsc --noEmit`)
- [ ] Kept the server read-only (no collection/marketplace writes)
- [ ] Described any user-data, OAuth, cache, external-service, or compatibility impact
- [ ] Added/updated documentation and release notes when behavior is user-visible
- [ ] Confirmed the diff contains no credentials, private correspondence, or production data
- [ ] For pressing-reputation data: added a test in `test/pressing-reputation.test.ts` and a
      one-line rationale for each new label/engineer
