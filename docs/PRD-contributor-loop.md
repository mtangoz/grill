# PRD: A contributor loop that grows users

Status: approved by the owner, 2026-10-17 ("Ok makes sense"). Decision record: D-20261017-01 in the ops repo. Research and grill: [RESEARCH-contributor-ownership.md](RESEARCH-contributor-ownership.md).

## 0. Why, in one line

Other MCP servers do something similar to Grill. People who help build Grill should feel it's partly theirs, and every contribution should bring Grill more users, without a token, a payout per pull request, or a profit promise Grill can't keep.

## 1. Decision this PRD records

- **Not doing now:** a tradeable on-chain token that pays holders a share of profit. It is a security in the US, the UK and the EU. The projects that tried something close to it drew spam or wound down. Grill has no profit to share yet. Grilled 17 October 2026: provisional, on securities law, dilution and lack of evidence.
- **Doing:** recognition, Grill credit and registry placement now. A real ownership route once there is revenue (section 5).

The owner can overrule this. If they do, section 5's legal opinion comes first, before any code.

## 2. What exists today (reused, not rebuilt)

| Piece | Where |
|---|---|
| Contribute page and the three ways to help | `site/contribute.html`, `CONTRIBUTING.md` |
| Grill-reviewed pull requests, low-risk auto-merge | `docs/PR-AUTOMATION.md`, `.github/automerge.json` |
| Monthly early-tester credit ($5 a month) | in-chat Grill accounts, `api/_hosted.mjs` |
| Registry listings | `server.json` (MCP Registry), `smithery.yaml`, `glama.json` |
| Evals a contribution can extend | `evals/` |

## 3. What this adds

1. **Contributors page.** `site/contributors.html`, built from merged pull requests and accepted non-code contributions: eval cases, prompt fixes, guides, client routes. Each entry shows a name, a GitHub handle and what the person did. Linked from the contribute page and each release note. People are listed only if they agree. A pull request template line asks.
2. **Credit in the release note.** The release workflow lists the people whose pull requests are in that release.
3. **Grill credit for merged work.** A merged, non-trivial contribution earns three months of Pro or in-chat credit on the contributor's own account. A maintainer grants it by hand; nothing is automatic. Credit can't be transferred and has no cash value. Typo fixes and changes that only touch the automerge safe list don't earn credit, so there is nothing worth farming.
4. **Referral credit, both sides.** In in-chat Grill, a signed-in person gets a personal invite link. When someone joins through it and runs their first grill, both get one extra month of the early-tester credit. The link carries an opaque code, nothing else. Off until Pro or in-chat Grill opens beyond invite-only.
5. **Ask for the contributions that matter.** The contribute page leads with eval cases (a decision and the objection a good judge should raise, made up and never real), judge-prompt fixes and new client routes. Issues worth paying for get a `bounty` label and a fixed amount set by a maintainer. There are no open bounties, and an outside pull request needs a linked labelled issue to qualify.
6. **Registry quality.** Get the Glama score to its top band by tightening the tool descriptions in `server/` without changing behaviour. Add the badge to the README. Keep `server.json` current on every release (already in the release checklist).

## 4. Privacy and principles

- The contributors page shows only what is already public on GitHub, and only with the person's consent.
- A referral code is random. It records which account invited which, and nothing about either person's decisions. It goes in [PRIVACY.md](PRIVACY.md) in the same pull request as the code.
- No new money source. Credits come out of Grill's own judge spend. "Paid for by subscriptions only" still holds.

## 5. Ownership, later

Gate: Pro is on, Grill has three months of positive profit after costs, and at least five people outside the maintainers have contributed in two or more separate months.

When the gate is met:

1. Get a one-hour written opinion from a securities lawyer in Grill's jurisdiction.
2. Choose between Rule 701 equity or options for the most active contributors, a Reg CF community round, or a written revenue-share pool. The pool would have a fixed size (for example 10% of profit), a published definition of costs, an independent check of those costs, and KYC on payouts.
3. A token comes into it only if counsel says a registered or exempt version is workable, and then with KYC and transfer limits.

Before any of this, publish one page that sets out the supply or pool cap, how new shares are issued, and how costs are defined. Grill's first challenge was that the plan has none of these.

## 6. Measures, set before building

| Measure | Source | Target by 17 April 2027 |
|---|---|---|
| Outside contributors active in a month (merged PR or accepted non-code contribution, maintainers and bots excluded) | GitHub | 5 |
| Contributors who also ran a grill | contributor consent plus account | 3 |
| Real users who arrived through a referral link | referral codes | 10 |
| Glama score | glama.ai | top band |

**Kill rule.** If outside contributors in a month stay under 2 by April 2027, stop items 3 and 5. Keep the page and the release credit, because they cost almost nothing.

## 7. Order of work

Each step is its own pull request.

1. Registry quality and the badge (item 6). Safe, and doesn't wait on anything.
2. Contributors page and release-note credit (items 1 and 2).
3. Contribute page rewrite and the `bounty` label (item 5).
4. Grill credit for merged work (item 3), granted by hand.
5. Referral credit (item 4), when in-chat Grill opens.

## 8. Out of scope

A token, NFTs, an on-chain treasury, any public sale, cash payment per pull request, and paying people to promote Grill.
