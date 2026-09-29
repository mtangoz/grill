# Contributing

The public README stays on the free routes. Maintainer setup lives here and in `docs/`.

## Develop

```bash
node --test scripts/*.test.mjs   # no network, no key
npm run build:extension          # dist/grill.mcpb and dist/grill-smithery.mcpb
```

Low-risk pull requests merge themselves once checks are green. Medium and high risk pull requests from the same authors are grilled. Rules and the opt-out labels are in [docs/PR-AUTOMATION.md](docs/PR-AUTOMATION.md).

- **Layout:**
  - `skills/`: what Claude reads in chat;
  - `prompts/grill.md`: the same grill for any other assistant, carrying the paste route's judge prompt word for word (a test pins it);
  - `server/`: the Desktop extension's tool;
  - `scripts/judge.mjs`: the judge itself, which also runs on its own (`node scripts/judge.mjs --help`);
  - `scripts/reflection.mjs`: the local "Before you decide" footer and look-back. It stores nothing. The copyable block is version 1, specified in [docs/DECISION-RECORD.md](docs/DECISION-RECORD.md).
- **Release:** bump the version in `package.json`, `manifest.json` and `.claude-plugin/plugin.json` (a test keeps them equal), then run the release workflow. It tags that version and publishes the extension, `grill-smithery.mcpb` (the same bundle with tool input schemas for the Smithery registry), and the skill zips. `server.json` points at a published `.mcpb` and its checksum. Update that file when the release asset changes.

## If something's off

The messages a person might see, and what they mean: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## The website and Grill Pro

The public site is `site/page.html`, built by `node scripts/build-site.mjs` into `_site/`, which Vercel serves. Grill Pro is parked (`GRILL_PRO_BILLING` off). Stripe, Redis, webhooks and the account variables: [docs/pro-development.md](docs/pro-development.md).

## How a grill stays honest

Why the judge is a different company: [docs/WHY.md](docs/WHY.md). How Grill improves without reading a real decision: [LEARNING.md](LEARNING.md).
