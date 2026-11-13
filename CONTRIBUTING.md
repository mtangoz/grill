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
- If a model wrote the change, name it. Put a line `Written-by-model: <vendor>/<model>` in the pull request body, such as `Written-by-model: anthropic/claude-opus-4`. Grill CI uses it to keep that company out of the judge. Without the line, Grill CI knows the company only when the login or the branch names it. Otherwise its comment says independence isn't verified. The pull request template has the line. An agent that opens a pull request through the API does not get the template, so it has to add the line itself.
- If the change touches a public page, run `node scripts/indexnow.mjs` once it is merged and live. The template's checklist has a line for it. What the script does is under "The website and Grill Pro" below.
- What you contribute is licensed under MIT, the same as the rest of the code. A fork is welcome under another name: [TRADEMARKS.md](TRADEMARKS.md).

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

The home page is `site/page.html`. Every other page is a file in `site/` that borrows the home page's styles: terms, contribute, look-back (the paste-route record and look-back tool), start, privacy, about, contact, support, demo, faq, check-your-ai and how-we-test, plus miss when it is switched on. `node scripts/build-site.mjs` writes `_site/`, which Vercel serves. Website analytics live in `scripts/siteAnalytics.mjs`: pages call `window.grillTrack(name, data)`, which keeps only allowlisted event names and fields. Vercel Web Analytics is always on. PostHog is on only when `GRILL_POSTHOG_KEY` (a project key from Grill's own PostHog organization, never a shared or another company's) is set at build time; `GRILL_POSTHOG_HOST` picks `https://eu.i.posthog.com` (default) or `https://us.i.posthog.com`. Grill Pro is parked (`GRILL_PRO_BILLING` off). Stripe, Redis, webhooks and the account variables: [docs/pro-development.md](docs/pro-development.md). After a page change, run `node scripts/indexnow.mjs` by hand: it reads the sitemap and prints the IndexNow submission of those public URLs, and `--send` posts it.

### Add a page

1. Create `site/<slug>.html`. Open it with `<title>... | Grill</title>`. Copy the header and the footer from `site/about.html`. Give it one `<h1>`. No `<script>`, no `<style>`, no table, no em dash and no en dash.
2. Pick a slug of one segment with no dot. It cannot be a name the server already uses, such as `api`, `mcp`, `decisions`, `account`, `judge`, `pricing` or `start`.
3. Add one `writePage` call in `scripts/build-site.mjs`: a description under 160 characters, the address, a name and a one-line blurb. That puts the page in the sitemap and in `llms.txt`, and gives it a Markdown twin.
4. Do not edit `vercel.json`. The routes that exist already serve the page.
5. End the page with one link to `/start/?ref=<slug>`. The weekly report prints a source only when its label is in `START_REF_LABELS` in `scripts/weeklyMetricsCore.mjs`.
6. Write the page's test as `scripts/<name>.test.mjs`. `scripts/howWeTest.test.mjs` is the model: it builds the site in a scratch copy and reads the built page, its Markdown twin and `llms.txt`.
7. Run the tests. Look at the page 390 px wide, in light and in dark.
8. Once it is merged and live, run `node scripts/indexnow.mjs`.

The rules behind these steps are in [docs/UX.md](docs/UX.md), under "A public page".

### The numbers on the how-we-test page

`/how-we-test/` shows `data/results.json`, a file of counts and dates and nothing else. The numbers are written into the page when the site is built.

- `node scripts/results.mjs check` lists every problem in the file.
- `node scripts/results.mjs merge-run <public-block.json>` adds one measured run of the weekly eval. Where that block comes from is in [evals/README.md](evals/README.md). The file keeps the first measured run and the 11 latest.
- When the real-user count in [docs/STRATEGY.md](docs/STRATEGY.md) changes, change `users` in the file in the same commit. A test keeps the two equal.
- When the four-arm comparison is measured, rewrite the page's opening, its description and blurb in `scripts/build-site.mjs`, and the FAQ's benchmarks answer in the same pull request. A test in `scripts/howWeTest.test.mjs` fails until then.

## How a grill stays honest

How Grill improves without reading a real decision: [LEARNING.md](LEARNING.md).

What we will and won't do, and how we build: [docs/PRINCIPLES.md](docs/PRINCIPLES.md). How a page a person sees is built: [docs/UX.md](docs/UX.md).
