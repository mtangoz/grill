# Contributing

Grill is open source. The same invitation is on [grillyour.ai/contribute](https://grillyour.ai/contribute/).

Two things are not negotiable. A pull request that drops either one will not be merged.

- **Privacy.** No ads. No selling your data. No training on your decisions. Grill is paid for by subscriptions only. Any change to what data leaves the user's machine must update [docs/PRIVACY.md](docs/PRIVACY.md) in the same pull request.
- **The judge.** One model, from a different company than the assistant that wrote the decision. Why that rule exists: [docs/WHY.md](docs/WHY.md).

## Local setup

You need [Node.js](https://nodejs.org) 20 or later. Clone the repository. The tests need no install, no network, and no key.

```bash
git clone https://github.com/mtangoz/grill.git
cd grill
node --test scripts/*.test.mjs   # no network, no key
npm run build:extension          # dist/grill.mcpb and dist/grill-smithery.mcpb
```

`npm test` runs the same test command.

## Pull requests

- Say what changed and why, in plain words.
- Run the tests before you open the pull request.
- Keep a change small. One idea per pull request.
- Don't paste a real decision, a key, or anything private into an issue, a pull request, or a committed fixture.

Low-risk pull requests merge themselves once checks are green. Medium and high risk pull requests from the same authors are grilled. Rules and the opt-out labels are in [docs/PR-AUTOMATION.md](docs/PR-AUTOMATION.md).

## Ways to help

- [Suggest an idea](https://github.com/mtangoz/grill/issues/new?template=idea.yml).
- [Report a bug](https://github.com/mtangoz/grill/issues/new?template=bug.yml).
- Pick up a [good first issue](https://github.com/mtangoz/grill/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
- Improve the guides in `docs/`, or the paste-route prompt in `prompts/grill.md`.

## Layout

- `skills/`: what Claude reads in chat.
- `prompts/grill.md`: the same grill for any other assistant, carrying the paste route's judge prompt word for word (a test pins it).
- `server/`: the Desktop extension's tool.
- `scripts/judge.mjs`: the judge itself, which also runs on its own (`node scripts/judge.mjs --help`).
- `scripts/reflection.mjs`: the local "Before you decide" footer and look-back. It stores nothing. The copyable block is version 1, specified in [docs/DECISION-RECORD.md](docs/DECISION-RECORD.md).

## Release

Bump the version in `package.json`, `manifest.json` and `.claude-plugin/plugin.json` (a test keeps them equal), then run the release workflow. It tags that version and publishes the extension, `grill-smithery.mcpb` (the same bundle with tool input schemas for the Smithery registry), and the skill zips. With the `NPM_TOKEN` repository secret set (an npm automation token for the `grillyour` package), it also publishes `npx -y grillyour` with provenance. `server.json` points at a published `.mcpb` and its checksum. Update that file when the release asset changes.

## If something's off

The messages a person might see, and what they mean: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## The website and Grill Pro

The public site is `site/page.html`. The other pages are `site/terms.html`, `site/contribute.html`, `site/look-back.html` (the paste-route record and look-back tool) and `site/privacy.html`; they borrow the home page's styles. `node scripts/build-site.mjs` writes `_site/`, which Vercel serves. Website analytics live in `scripts/siteAnalytics.mjs`: pages call `window.grillTrack(name, data)`, which keeps only allowlisted event names and fields. Vercel Web Analytics is always on. PostHog is on only when `GRILL_POSTHOG_KEY` (a project key from Grill's own PostHog organization, never a shared or another company's) is set at build time; `GRILL_POSTHOG_HOST` picks `https://eu.i.posthog.com` (default) or `https://us.i.posthog.com`. Grill Pro is parked (`GRILL_PRO_BILLING` off). Stripe, Redis, webhooks and the account variables: [docs/pro-development.md](docs/pro-development.md).

## How a grill stays honest

How Grill improves without reading a real decision: [LEARNING.md](LEARNING.md).

What we will and won't do, and how we build: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).
