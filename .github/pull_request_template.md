## Summary

<!-- What changed, and why. A few sentences is enough. -->

Written-by-model: <vendor>/<model>
<!-- Name the model that wrote this change, such as anthropic/claude-opus-4. Grill CI uses this line to keep that company out of the judge. If no model wrote it, delete the line. -->

## Checklist

- [ ] Does this change what data leaves the user's machine? If yes, update PRIVACY.md.
- [ ] Tests pass (`node --test scripts/*.test.mjs`), no new dependencies
- [ ] Judge stays decorrelated and unpinned
- [ ] If this changes a page a person sees: docs/UX.md still holds, or the rule changed on purpose and says why.
- [ ] Looked at 390 px, light and dark.
- [ ] If this changes a public page: once it is merged and live, run `node scripts/indexnow.mjs`. It prints what it would send, and `--send` posts it.
