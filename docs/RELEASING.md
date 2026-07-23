# Release process

This repository ships two independently versioned products from one `main` branch:

- server tags: `vMAJOR.MINOR.PATCH`;
- browser-extension tags: `ext-vMAJOR.MINOR.PATCH`.

GitHub Releases are the public changelog. A duplicate `CHANGELOG.md` is intentionally not
maintained; each release links the relevant tag comparison.

## Versioning

Use semantic versioning for each product independently:

- **major:** breaking public MCP/REST/extension behavior;
- **minor:** backward-compatible capability;
- **patch:** backward-compatible fix or maintenance change.

Documentation-only and repository-governance changes normally do not create a server or extension
release. OpenAI-reviewed tool metadata/schema changes may be operationally significant even when
the underlying core logic is compatible; follow the OpenAI rescan/review rules in the Phase 1
contract.

## Server release checklist

1. Confirm the intended diff and that `main` CI is green.
2. Run `npm ci`, `npm run lint`, `npm test`, and `npm run build` locally.
3. Update `package.json` and `package-lock.json` to the intended server version.
4. Verify `src/version.ts` reports the package version and the MCP handshake/User-Agent remain
   aligned.
5. Review data/privacy, OAuth, cache, migration, and backward-compatibility impact.
6. Deploy the exact release commit to the hosted Worker using the documented production process.
7. Smoke-test `/`, `/mcp`, OAuth, and affected `/api/*` routes without exposing credentials.
8. Tag the deployed commit as `vMAJOR.MINOR.PATCH` and publish a GitHub Release.
9. Include summary, user impact, compatibility notes, tests, deployment status, and a full changelog
   comparison link.
10. Verify the release is marked latest only when it is the current stable server release.

## Extension release checklist

1. Complete the relevant server compatibility checks first.
2. Update the extension manifest version.
3. Test sign-in/sign-out, loading/error/empty states, supported Discogs page types, and cached result
   scoping.
4. Package the exact reviewed extension files without development credentials or captured private
   data.
5. Tag the commit as `ext-vMAJOR.MINOR.PATCH` and publish a GitHub Release.
6. State the minimum compatible server version and update instructions.

## Release-note template

```markdown
Summary of the user-visible outcome.

- Change and why it matters
- Compatibility or migration note
- Security/privacy/data-contract impact
- Validation performed
- Deployment or package status

**Full Changelog**: https://github.com/WOIII-me/Discogs-MCP/compare/<previous-tag>...<new-tag>
```

Do not put tokens, reviewer credentials, private Discogs data, internal logs, or private approval
correspondence in tags or release notes.
