# Research: contributor ownership and growth loops

Written 17 October 2026. Question from the owner: other MCP servers do something similar to Grill. Could we put ownership of Grill on a blockchain, so contributors earn tokens that can be bought and sold, and every token holder gets a proportionate share of profit after costs? The aim is a growth loop: people contribute because they own a piece.

The plan that came out of this is [PRD-contributor-loop.md](PRD-contributor-loop.md).

## Short answer

Don't launch the token. The sense of ownership is worth having, but a tradeable token that pays a share of profit is a security in the US, the UK and the EU. The projects that tried something close to it mostly drew spam or wound down. Grill also has no profit to share yet: Pro is parked, and Grill hasn't reached 100 real users.

What works better at this stage: public credit for contributors, Grill credit for merged work, judge credit for referrals, and better placement in MCP registries. Keep a real ownership route (equity, or a written revenue-share pool) for later, once there is revenue and a lawyer has reviewed it.

## What Grill said

Grilled 17 October 2026, with the idea exactly as the owner stated it. Verdict: **provisional**. "The plan rests on unexamined securities-law and dilution premises and offers no evidence a token drives contribution."

The judge's four challenges:

1. **Dilution.** If tokens keep going to every future contributor, and the founders decide which costs come off before the split, an early contributor's share shrinks toward zero. A buyer who sees that will price the token near zero, so the loop has nothing to run on. The plan has no supply cap, no issuance schedule, no vesting, and no audit of the cost line.
2. **Securities law.** A transferable token, sold for money, that pays a share of profit is a security under Howey in the US and a financial instrument under MiFID in the EU. As written, the plan is an unregistered public offering.
3. **No evidence.** The plan names no competing MCP, no retention number and no success metric, so nothing could ever show it isn't working.
4. **The cheaper alternative was never ruled out.** Cash bounties plus a written revenue share or equity give the same alignment. The only thing the blockchain adds is the ability to trade freely, and that is exactly what makes it a security.

The question that decides it, according to the judge: **will tokens be sold to the public for money, or only earned by contributors?** The research below says that even tokens that are only earned stay securities once they can be traded and carry a profit right.

## Law

These notes come from public sources and are not legal advice. Any ownership step needs a written opinion from a lawyer in Grill's jurisdiction.

- **US.** Howey still applies. The SEC and CFTC issued a joint interpretive release on 17 March 2026 that sorts crypto assets into five categories. The non-security categories are defined partly by having no right to a business's "future income, profits, or assets" ([Orrick](https://www.orrick.com/en/Insights/2026/04/SEC-Issues-Interpretive-Guidance-on-Crypto-Asset-Classification), [Greenberg Traurig](https://www.gtlaw.com/en/insights/2026/3/sec-clarifies-status-of-crypto-assets-under-federal-securities-laws-signals-potential-exemptive-and-safe-harbor-framework)). A profit-share token is the plain case of a digital security. The proposed Regulation Crypto Assets of August 2026 adds a $5M startup exemption and a safe harbor once "essential managerial efforts" are complete. Neither seems to fit a token whose profits depend on the company continuing to work ([Federal Register](https://www.federalregister.gov/documents/2026/08/21/2026-17183/regulation-crypto-assets)). The proposal isn't final. The CLARITY Act failed cloture on 15 September 2026 ([CNBC](https://www.cnbc.com/2026/09/15/senate-cloture-vote-on-clarity-act-fails-dealing-regulatory-setback-to-crypto-industry.html)).
- **UK.** A contractual right to a share of profits makes a token a security token, which is a specified investment ([FCA PS19/22](https://www.fca.org.uk/publications/policy-statements/ps19-22-guidance-cryptoassets)). The new UK cryptoasset regime goes live on 25 October 2027 ([Latham](https://www.lw.com/en/insights/2026/06/The-Race-Is-On-FCA-Publishes-Final-Rules-for-UK-Cryptoasset-Regime)).
- **EU.** A token that counts as a MiFID II financial instrument falls outside MiCA and under securities law. ESMA judges by substance, not form, and that includes tokens with rights that work like dividends ([Deloitte](https://www.deloitte.com/lu/en/Industries/investment-management/perspectives/ESMA-clarifies-which-crypto-assets-might-qualify-as-financial-instruments-in-the-EU.html)).
- **Tax.** In the US, tokens received for work are ordinary income at fair market value when received ([IRS](https://www.irs.gov/individuals/international-taxpayers/frequently-asked-questions-on-virtual-currency-transactions)). A contributor would owe tax on tokens they may not be able to sell.
- **KYC and liability.** Paying profit out needs tax reporting and sanctions screening, and that rules out anonymous wallets. A DAO with no legal entity can leave its active members liable as general partners. *Samuels v. Lido DAO* was allowed to go ahead on that theory in 2024 ([Decrypt](https://decrypt.co/292275/california-court-rules-lido-dao-members-can-be-held-liable-under-partnership-laws)).

## What happened to the projects that tried it

| Project | What happened |
|---|---|
| tea.xyz | Token rewards for open source work led to waves of spam pull requests and empty npm packages ([Socket](https://www.socket.dev/blog/tea-xyz-spam-plagues-npm-and-rubygems-package-registries)). |
| SourceCred | Scored contributions with an algorithm and paid in its Grain token. It issued Grain faster than it raised money, people gamed the scores, and it wound down ([forum](https://discourse.sourcecred.io/t/proposed-change-to-grain-redemption/1192)). |
| Coordinape | Peer-allocated rewards turned into a popularity contest, and the project is now inactive ([site](https://coordinape.com/)). |
| Gitcoin | Fake identities attacked its quadratic funding. It shut its grants software down in 2025 because costs ran ahead of revenue ([The Block](https://theblock.co/post/352055/ethereum-public-goods-funding-protocol-gitcoin-winding-down-its-software-division)). |
| Friend.tech | Usage collapsed and the token fell 98%. Speculation did not turn into people coming back ([DL News](https://www.dlnews.com/articles/defi/friend-tech-shuts-down-after-revenue-and-users-plummet/)). |
| Uniswap fee switch | Passed in December 2025, but as buyback-and-burn rather than direct payouts to holders ([The Block](https://www.theblock.co/post/383742/uniswap-passes-unification-proposal)). |
| BarnBridge, LBRY | Lost to the SEC or settled, then shut down ([SEC](https://www.sec.gov/news/press-release/2023-258), [Bloomberg Law](https://news.bloomberglaw.com/litigation/lbry-winding-down-drops-appeal-of-crypto-ruling-favoring-sec)). |
| curl bug bounty | Ended in January 2026 when AI-generated junk reports pushed the valid rate below 5% ([Stenberg](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/)). |

The pattern: pay per contribution and you get contributions made for the payout. In 2026 an agent can open a pull request for almost nothing, so any per-PR reward gets farmed.

## What makes people contribute

- Across 128 experiments, expected tangible rewards lowered people's own drive to do a task, and positive feedback raised it ([Deci, Koestner & Ryan 1999](https://leeds-faculty.colorado.edu/dahe7472/deci%201999.pdf)).
- Maintainers who received GitHub Sponsors money created fewer new projects and did less community work afterwards, however much they got ([NBER w31668](https://www.nber.org/papers/w31668)).
- Paid, ongoing roles do help people stay: in Rust, paid contributors were more likely to become long-term ([arXiv 2401.13940](https://arxiv.org/pdf/2401.13940)).
- The top reasons people contribute are not money ([Linux Foundation and Harvard](https://www.linuxfoundation.org/press/new-open-source-contributor-report-from-linux-foundation-and-harvard-identifies-motivations-and-opportunities-for-improving-software-security)).

For Grill: recognition and product-native rewards fit what the evidence supports. A speculative reward per action does not.

## Loops that fit Grill

1. **Registry placement.** Grill is already on the MCP Registry (`server.json`), Smithery and Glama (`glama.json`). Glama scores tool definitions, and awesome-mcp-servers requires a Glama badge ([Glama](https://glama.ai/mcp/servers/cpcc/moa/score)). This costs nothing and reaches people choosing between similar MCPs.
2. **Credit people can see.** A contributors page, credit in release notes, and a named credit on the eval case or prompt line someone wrote. PostHog's merch-for-merged-PRs scheme is a working example ([PostHog](https://posthog.com/docs/contribute/recognizing-contributions.md)).
3. **Grill credit, not cash.** Grill already gives early testers $5 of use a month. Months of credit for merged work, and two-sided judge credit for referrals, are rewards that bring people back to the product and carry no profit right.
4. **Contributions Grill uses for its own work.** Eval cases, judge-prompt fixes and new client routes improve the thing every user gets. That is the kind of contribution worth asking for, not raw pull-request volume.
5. **Ownership later, done properly.** Once there is profit: Rule 701 equity for two or three contributors who keep showing up, a Reg CF community round, or a written revenue-share pool with a fixed size. All of these involve KYC and none can be freely traded. That is the lawful version of what the owner described.

## Conflicts with Grill's own rules

- [CONTRIBUTING.md](../CONTRIBUTING.md) says "Grill is paid for by subscriptions only." Selling tokens to the public would bring in a second source of money and would break that promise.
- [STRATEGY.md](STRATEGY.md) principle 3 says to earn the second grill before chasing the hundredth user. Grill's bottleneck is users who come back, not contributors. A contributor loop helps only where it also brings in users, which is why the PRD measures that.

## Not checked

Whether Regulation Crypto Assets is adopted and in what form. How the FCA's PS26/18 treats hybrid tokens. Exact MCP directory counts. The research agent couldn't confirm several 2026 sources, and those are marked uncertain in the source notes.
