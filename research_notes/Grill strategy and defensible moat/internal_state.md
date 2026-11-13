# Grill: internal state and stated strategy (from the repository at /home/user/grill)

Scope note: all facts below are as written in the repo on 2026-11-13. Citations are repo-relative file paths. The local clone is shallow: 50 commits, 2026-11-07 to 2026-11-12 (`git log`), package version 0.1.1 (`package.json`). Nothing was verified against the live site or production stores. Several documents reference an "ops repo" (`grill-growth`, `grill-hub`) that is not in this clone.

## 1. What do the strategy documents say? (per-document summary)

### Takeaway
Grill's own strategy (written 16 Oct 2026) says "independence is the product" and "the record is the product; the verdict is how it starts", and admits the product is far ahead of the evidence: 1 real user and 0 evidenced look-backs as of 2026-11-09. Paid Pro is built, priced at $9/month, and deliberately parked until 100 real users and 20 evidenced look-backs.

### Cited Findings

**docs/STRATEGY.md** (written 2026-10-16; review at 100 real users or 2027-01-16)
- Inputs: Greg Isenberg's 21 observations (Oct 2026), a grill of the first draft (judge said "shaky", four challenges), and a check of each challenge against the repo. — [docs/STRATEGY.md](docs/STRATEGY.md)
- Challenge "calibration needs dozens of resolved calls per person" **holds**: a 70% band needs about 30 resolved calls; "at a few grills a month, that takes a year or more". — [docs/STRATEGY.md](docs/STRATEGY.md)
- Challenge "every route Grill grows through belongs to another company" **holds**: "Claude, ChatGPT, Meta AI, Cursor and VS Code are all rented reach. The decisions page, the look-back reminder and the calendar link are the only surfaces Grill owns." — [docs/STRATEGY.md](docs/STRATEGY.md)
- Challenge "Auto Router does not guarantee a different-company judge": "refuted, with a gap". Code excludes the author's company, retries, and errors rather than return a same-company verdict; but an unrecognised installed client falls back to excluding Anthropic, and in hosted chat an unknown client "excludes nobody unless the call names an author". — [docs/STRATEGY.md](docs/STRATEGY.md)
- Status: "As of 2026-11-09 the count is 1 real user and 0 evidenced look-backs." First real user ran a grill on 2026-11-05, two days after open sign-up (2026-11-03). "Hosted accounts: 4 total, 3 of which are maintainer or test/reviewer accounts." — [docs/STRATEGY.md](docs/STRATEGY.md)
- Ten guiding principles, verbatim headings: (1) Independence is the product; (2) Get better when models get better ("if a stronger model ships next month, does this get better or worse? Build only what gets better. No fine-tuning, and no pinned model in the free tool"); (3) Earn the second grill before chasing the hundredth user; (4) The record is the product, the verdict is how it starts ("Any assistant can be told to argue the other side. Few people keep a record of what they decided and come back to it"); (5) Sell what a person gets in the first month (not calibration); (6) Pool where samples are small (teams, funds, boards reach enough resolved calls "in weeks, not years"); (7) Rented reach, owned relationship; (8) "Copyable is fine. Unmeasured is not. The prompt is open source and easy to copy. A judge that is measurably better than a same-company critique, shown with published evals, is not"; (9) Decisions belong to the people who made them (no data brokering "at any price"); (10) One product, one promise (a pinned judge for audits would be a separately named product). — [docs/STRATEGY.md](docs/STRATEGY.md)
- Self-assessment: "The product is ahead of the evidence. A team that does this much careful work with 1 real user risks polishing a product that has barely been tested." Biggest risk: "People try it once." Second risk: platforms shipping a "second opinion" button; stated defence is principle 1 because that button "would come from the same company as the assistant". — [docs/STRATEGY.md](docs/STRATEGY.md)
- Ordered recommendations: count the 100; talk to every real user; close the independence gap; set the Pro bar (100 real users and 20 evidenced look-backs; sell reminders and "Where your calls changed", not calibration); name the buyer (candidates: founders reporting to a board, PMs, investors); run one team pilot; share card later. "Not now: a hosted judge API for agents, data partnerships of any kind, and paid advertising." — [docs/STRATEGY.md](docs/STRATEGY.md)
- Open owner decisions: a pinned judge for agent audits (values call), and "Who Grill is for. One person deciding alone, or a group deciding together." — [docs/STRATEGY.md](docs/STRATEGY.md)

**docs/WHY.md**
- Core argument: your assistant "helped you think it through, so its critique shares your blind spots. A judge from another company doesn't." A stronger same-lab model (Claude Code's advisor) "can share the same blind spots". Cites Felix Rieseberg's "How to be more ambitious" ("do not ask the model to judge itself"). — [docs/WHY.md](docs/WHY.md)
- "A different company isn't enough on its own": the write-up is written "as a clerk, not an advocate", and the judge is told who wrote it and checks whether its verdict would flip if the other side had written the same facts. — [docs/WHY.md](docs/WHY.md)

**docs/ICP.md** (approved by Tony 2026-11-01)
- Long-term position: "a cross-provider second opinion. It works with any AI assistant or agent." — [docs/ICP.md](docs/ICP.md)
- Primary ICP: "People who already make real decisions with an AI assistant or agent, from any provider, and who say in public that they distrust a same-model self-check" (founders, PMs, indie builders, ops leads). Secondary: agent/automation builders who grill many small plans in a row (bulk path). — [docs/ICP.md](docs/ICP.md)
- Channels: X first (@AskGrill, an AI-run account), then Reddit and Hacker News; public replies carry a verdict plus one cheap test; DMs carry only `/start?ref=askgrill` plus a single-use invite code. Human (Tony) approves each reply until platform rules allow automation. — [docs/ICP.md](docs/ICP.md)
- Stop rules: after 100 distinct leads stop if replies <5%, complaints >1%, or any block. 28-day success bar: at least 3 evidenced outcomes. Re-review at 10 evidenced users or 100 leads. "First 100 users get Grill free for life." — [docs/ICP.md](docs/ICP.md)

**docs/ROADMAP.md** (last scan 2026-11-11) — see section 2 for triggers.

**docs/COMPETITORS.md** (last scan 2026-11-11) — see section 2.

**docs/PRINCIPLES.md** — see section 3. Mission: "An AI from a different company argues the other side. You decide. Later you can look back and see how your judgement did." North Star: 100 real users (a person who ran a grill; downloads and launch-list sign-ups never count). — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)

**docs/PRO.md**
- Pro is $9/month or $90/year (owner decision 2026-11-07); billing switch `GRILL_PRO_BILLING` defaults off. BYO-key stays free and unlimited. A managed starter key is a one-time $0.50 of judge spend; paid keys cap at $3/month (`GRILL_PRO_KEY_LIMIT`). — [docs/PRO.md](docs/PRO.md)
- Stack: Clerk (OAuth, emailed code), Upstash Redis, Stripe, Resend, OpenRouter management key. Usage metrics are counts only: `account_created`, `key_issued`, `first_grill`, `allowance_exhausted`, `upgrade_clicked`. — [docs/PRO.md](docs/PRO.md)

**docs/PRD-hosted-pro.md** (written 2026-10-03, "partly superseded", updated 2026-11-08)
- Original proposal $3/month with $1.50 of judge spend; superseded by $9/$90. Margin at $9: about 59% for a user who spends the full $3 cap, about 88% for a typical ~$0.50 user (hosting excluded). — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)
- Measured cost per grill: Auto Router 2.2–3.0 cents (197 runs, "Kindo Q3 review-instrument audit"; 11 GrillBot runs averaged 1.5 cents); a strong pinned judge 6.3 cents; Jev check 0.02 cents. — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)
- "We have no real-user distribution yet." Usage assumed lognormal, median 4–6 grills/month. Heavy use example: "Kindo's own repo ran about ten a day, about 300 a month" (the maintainer's own company). — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)
- The hosted relay "breaks one sentence of today's promise" (the write-up now passes through Grill's server). The PRD scoped hosted as Pro-only and put a free hosted route out of scope; "It shipped anyway: Grill in your chat is free with a monthly allowance and open sign-up." — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)

**docs/PRD-lookback-reminders.md** (approved 2026-10-16)
- Problem: "Nothing tells you when that date arrives, so the look-back never happens and the learning loop does not close." Evidence: in the 2026-10-11 usage review the owner's own hosted account had no look-back due, and "the 8 Kindo grills in the same window recorded no confidence or prediction, so there was nothing to score." — [docs/PRD-lookback-reminders.md](docs/PRD-lookback-reminders.md)
- Adds a due list on `/decisions`, one in-chat reminder line (once per UTC day), and an opt-in private iCalendar feed. Success target: at least half of due records get a look-back within 7 days; baseline "0 of 0". — [docs/PRD-lookback-reminders.md](docs/PRD-lookback-reminders.md)

**docs/DECISION-RECORD.md**
- Version 1 plain-text block (`grill-record`): version, date, title, prediction, verdict (`solid`, `solid if`, `shaky`, `doesn't hold up`), falsifier, confidence, review (default 14 days). Optional lines: goal, guardrails, source_app, proposed_by (ai/me), decided, supersedes, changed. The free tool does not store it; the user copies it. — [docs/DECISION-RECORD.md](docs/DECISION-RECORD.md)
- "What changed" view: counts and examples only; changed-versus-kept rates compared only when each side has at least 10 calls; "No savings figure, no 'would have' claim, no trend over time, and no score." — [docs/DECISION-RECORD.md](docs/DECISION-RECORD.md)

**docs/DATA-LEDGER.md** — see section 3.

**LEARNING.md**
- Rule: "contribute the miss, never the decision." Grill learns from synthetic cases, public metadata, opt-in dropdown signals and "miss cards" (off until `GRILL_MISS=1`), never from a decision. — [LEARNING.md](LEARNING.md)
- Three loops: (1) model choice, inherited from the router "free as models improve"; (2) quality: 29 synthetic cases plus a private held-out set, weekly and on judge changes, each report also scored by Jev (TypeSafe's typed decision model, "a third model family"); (3) usefulness/accuracy: opt-in signals by judge family and verdict-versus-outcome, monthly. Recommendations need at least 10 data points. — [LEARNING.md](LEARNING.md)
- Stated limits: sharers are self-selected; "Treat the numbers as directional until there are hundreds." — [LEARNING.md](LEARNING.md)

**docs/experiments/weekly-email.md** (set 2026-11-08)
- Tests whether a Monday "impact" email brings people back. Ends at 30 distinct recipients and 60 sends plus 7 days; backstop last send 2027-01-25. A fixed 1-in-4 holdout by account hash. Primary measure: return within 7 days (grill, look-back, or Yes/No tap). Pause if unsubscribes exceed 10%. "With tens of accounts the gap will be noisy." "Changes: None yet." — [docs/experiments/weekly-email.md](docs/experiments/weekly-email.md)

**docs/experiments/analytics-loop.md** (set 2026-11-09)
- PostHog capture is off until `GRILL_POSTHOG_KEY` is set; funnel source of truth is Redis counters (`start_views`, `start_ref:*`, paid-intent, `funnel_grills`) plus Vercel pageviews. "Cross-page person funnels are not PostHog's job: the site uses a one-page-load ID on purpose." — [docs/experiments/analytics-loop.md](docs/experiments/analytics-loop.md)

**docs/lookback-icp-sim-2026-11-07.md**
- A simulation with invented personas (no real accounts read). Finding: look-backs are worth nudging only for decisions that recur, resolve within about four weeks with a pointable outcome, and where the person acted on the advice (dated ship calls, pricing/spend with a readout, near forecasts, weekly bets). Failure modes: wrong day, no scoreboard, already know, not a decision, feels graded. — [docs/lookback-icp-sim-2026-11-07.md](docs/lookback-icp-sim-2026-11-07.md)

### Inferences
- The stated strategy already anticipates the "models improve" question (principle 2) and answers it by refusing to pin or fine-tune, so judge quality is rented from the model market rather than owned.
- The documents place the durable value in the decision record and look-back loop and in team pooling, not in the verdict; but all retention evidence so far is from the owner's own usage or simulation.

### Gaps
- No user-interview notes (STRATEGY rec 2) are in this repo.
- The "ops repo" documents (growth framework section F, decision log, launch drafts, snapshot script) are not available here.

## 2. Current moat thesis, roadmap triggers, competitor register

### Takeaway
The written moat thesis has three legs: enforced cross-company independence (which a platform's own button cannot offer), a measured-and-published quality edge over same-company critique, and an owned decision record with look-backs. Only the first is implemented and tested; the second is unmeasured and the third has zero evidenced outside use.

### Cited Findings
- Moat statements: principle 1 (independence), principle 4 (record), principle 8 ("measurably better than a same-company critique, shown with published evals"), principle 7 (owned relationship), principle 6 (team pooling). — [docs/STRATEGY.md](docs/STRATEGY.md)
- Platform-risk defence as written: a platform "second opinion" button "would come from the same company as the assistant... so Grill's defence is principle 1. The defence holds only if Grill says it clearly and enforces it on every route." — [docs/STRATEGY.md](docs/STRATEGY.md)
- Roadmap states "That count is 1 as of 2026-11-09, so every user-count trigger below reads as not met." — [docs/ROADMAP.md](docs/ROADMAP.md)
- Key triggers (idea: trigger, status): paid tier: 100 real users and 20 evidenced look-backs, not met. Team pilot/team plan (~$50–100/month): 100 users or a team asks, not met. Shared/team sessions with a decision owner: 100 users or team demand, not met. Public launch (Show HN, Product Hunt): count recorded and activation measured, not met. Personal calibration view: one person with 30 resolved calls, not met. Optional second judge: feedback plus cost, not met. Agent-to-agent harness: after shared sessions or a platform asks. Pinned judge for agent audits (separate product): a platform offers to pay plus owner values call. Publish eval results in plain words: 10 real users or a reviewer asks, not met. Look-back reminders via ChatGPT MCP events: listing live and 5 users with a look-back date. Google Docs add-on: 25+ users. Privacy work for work use (work mode, Spaces, org view, later SSO/DPA/residency): triggers in the privacy PRD. — [docs/ROADMAP.md](docs/ROADMAP.md)
- "Trigger met" now: MCP Registry publish of the hosted address (registry still lists v0.1.0 stdio-only); ChatGPT and Claude directory listings (blocked on Tony's approval, OpenAI identity verification, reviewer account that cannot use emailed codes, paid Claude plan); hand-run partnerships; verify Meta AI. Close the unknown-client judge gap: draft PR open 2026-11-10. — [docs/ROADMAP.md](docs/ROADMAP.md)
- Platform notes: ChatGPT "now suggests plugins mid-chat using conversion, usage and retention" (secondhand report of a DevDay talk); Claude Plugins page GA 2026-11-09; Community connectors may not be auto-suggested in Claude, only Verified; local `.mcpb` no longer accepted in Claude's directory. — [docs/ROADMAP.md](docs/ROADMAP.md), [docs/COMPETITORS.md](docs/COMPETITORS.md)
- Hosted service cost cap: `GRILL_MONTHLY_CAP_USD` default $20; earlier notes said "about $40 a month", with no source. — [docs/ROADMAP.md](docs/ROADMAP.md)

Competitor register (all from [docs/COMPETITORS.md](docs/COMPETITORS.md); "a register of names... not a ranking and not a claim about users"):
- **Cruxes (cruxes.io)**, threat medium, seen 2026-11-11: harness that finds the one question that would change a decision; each crux has a DRI; runs in Claude Code, Claude, Google Docs; shared sessions in preview; mentions Jev as an optional step; claims five patent applications and 138 studies in four months (7 of first 136 met their registered success rule). Price: 15 free total, then $29/month for 100, $0.10 each extra. Moving "toward research and teams, not the solo in-chat decider".
- **Crux (uncrux.io)**, low: free in-browser group weighting tool; no outside judge, no record.
- **Council AI (councilai.app)**, low–medium, seen 2026-11-04: free; asks Gemini, ChatGPT, Claude, Grok, Perplexity at once; "For decisions that require a second opinion."
- **Council AI (council-ai.app)**, medium for plan review: up to 21 models from 9 labs, moderator verdict, consensus score, exports, MCP server in the top tier.
- **Perplexity Model Council**, low direct: multi-model consensus inside Perplexity (Max/Enterprise Max; Computer for Pro). "A council can show up inside a big client, and could appear in ChatGPT or Claude too."
- **Triall (triall.ai)**, medium: three models answer blind, attack and rank; hosted MCP connector with OAuth for Claude.ai, ChatGPT, Claude Code; "The delivery shape matches Grill"; aimed at fact-checking; site showed "temporarily offline".
- **Reasoning Services (Devil's Advocate)**, low: paid-only remote MCP, 8 tools (premortem, attack trees), Community connector in Claude's directory since 2026-08-13; no cross-company judge.
- **Open-source dev second-opinion MCP servers**, low for Grill's ICP: Deliberation, Amicus, mcp-second-opinion, LLMconcil, cc-reviewer, PAL MCP Server, and (seen 2026-11-11) Bayze, second-opinion-mcp 0.9.2, 2ndOpinion 0.2.0, Quorum Deliberate. Register's reading: "A judge from a different vendor is becoming a common idea."
- **TruthAgent**, low: multi-model panel web app.
- **Unnamed free Claude decision connector** (X post 2026-11-06), low, unverified: "second opinion + tracking".
- **Satcove category post** (2026-10-26): Grill appears in none of the multi-model comparison posts.
- **Channels**: Claude Connectors Directory (opportunity medium; Marketplace lists 2,000+), ChatGPT/Codex plugin directory (opportunity "now high"; about 4,000 plugins; queues lengthening), Official MCP Registry, Smithery (proxy shut down 2026-10-31; Grill listing 404), PulseMCP (paused), Glama (live), Gemini Connected Apps Platform preview (2026-10-28, waitlist), Perplexity custom connectors, Meta AI connectors (limited preview).

### Inferences
- The register itself records that the "different vendor judges" idea is spreading fast in open source and that at least two hosted products (Triall, council-ai.app) ship the same in-chat MCP delivery shape. The cross-company call is therefore not unique; Grill's stated differentiators are single-judge brevity, the cheap test, and the record/look-back.
- No first-party same-chat "second opinion" feature from OpenAI, Anthropic or Google is recorded in the register; the nearest are Perplexity Model Council and Claude Code's same-company advisor (README/WHY).
- The roadmap is almost entirely gated on a user count that is 1, so in practice only distribution and hygiene items are active.

### Gaps
- The register gives no usage or revenue numbers for any competitor.
- Whether the Claude or ChatGPT directory submissions have actually been filed is not stated ("check the portal status").

## 3. Hard promises and constraints on strategy

### Takeaway
Grill has bound itself, in tests as well as prose, to: a different-company judge, no pinned model, MIT forever for anything touching decisions or keys, no account on the free tool, no reading or reuse of decision content, and no scores or streaks. These rule out the usual data, fine-tuning and gamification moats, and limit what the makers can learn about real usage.

### Cited Findings
- "The judge is always from a different company than the model being judged. Only that company is excluded." "Grill uses OpenRouter's Auto Router. It does not pin models." Enforced by `scripts/judgeCore.mjs` (`DEFAULT_CHAIN = "openrouter/auto"`) and named tests. — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- "The code that handles your decision or your keys stays open source under the MIT license, for good" (tool, skill, paste prompt, judge and checks, masking, miss-card check, hosted server code). Only things that never touch decision text or keys (billing, team admin) may be closed. A license change "never merges itself". The name is a trademark; forks must rename. — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- "The free tool has no account." "The tool has no third-party dependencies." Telemetry is opt-in, off by default, a random install ID only. — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- "The human decides. Grill only advises." "The verdict never becomes the decision." "No scores, points, badges or streaks. A changed mind is shown, never scored." Layer 1 is at most 50 words plus one line of at most 25 words. Never a required question before the verdict on a quick or bulk grill. — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- "Grill never collects decision text, notes, reflections, or keys, except a grill you send after a reaction." With a hosted account the decision "passes through Grill's server in memory. It is never logged. It is stored for 180 days only when you send that grill after a reaction." — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- Hosted storage (Upstash Redis): encrypted decision records only if the user opts in and states a choice (kept until deleted); encrypted drafts 14 days; result layers 15 minutes (key lives in the job id); spend log of cost, time and served model for the last 400 grills; monthly check counts; approximate active-user counts via HyperLogLog of keyed hashes (day/week/month); four funnel integers (grills, choices, look-backs set, look-backs done); verified email; Clerk sign-in. — [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md)
- What operators can see: "Grill's operators hold `GRILL_RECORD_KEY`, so they could decrypt records. Say so if you ask." Stated use limit: "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us." Opted-in feedback grills are read via `scripts/feedback-export.mjs`. — [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md)
- Judge requests use `provider: { zdr: true, data_collection: "deny" }`; Jev quality check (TypeSafe) is on by default and zero-retention. Masking covers email, phone, cards, bank numbers, SSN/NI, DOB, addresses, postcodes, IPs; keys and passwords stop the run; "Names are still not masked." — [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md), [CHANGELOG.md](CHANGELOG.md)
- "Data partnerships of any kind" are "Not now", and principle 9 says Grill will not sell decision data "at any price". — [docs/STRATEGY.md](docs/STRATEGY.md)
- Gate T: no marketing of hosted Grill for work or team use until listed privacy steps merge. — [docs/PRD-privacy-foundations.md](docs/PRD-privacy-foundations.md), [docs/ROADMAP.md](docs/ROADMAP.md)
- Founding members: first 100 accounts given access (invite, allowlist, waitlist approval; open sign-up does not take a spot) are free for life at $5 of use a month. — [docs/HOSTED.md](docs/HOSTED.md)

### Internal contradictions and tensions (flagged)
- **"Measurably better" is asserted as the moat but not measured.** Principle 8 rests the anti-copy defence on published evals versus a same-company critique; no such comparison exists in the repo (section 4), and publishing eval results is a roadmap item marked "not met". — [docs/STRATEGY.md](docs/STRATEGY.md), [docs/ROADMAP.md](docs/ROADMAP.md), [evals/README.md](evals/README.md)
- **"Different company, always" versus known gaps.** Hosted unknown clients exclude nobody; Cursor excludes nobody on purpose; installed unknown clients exclude Anthropic regardless of the real author; the paste route "only warns". The fix in flight only adds a disclosure line: "Who is excluded is unchanged." — [docs/ROADMAP.md](docs/ROADMAP.md), [docs/HOSTED.md](docs/HOSTED.md), [docs/STRATEGY.md](docs/STRATEGY.md)
- **"Only the write-up you approve leaves your machine" versus hosted behaviour.** README and PRINCIPLES keep the approval promise; the hosted connector instructs the assistant to send the decision as stated and "not to wait for an OK" (test name in PRINCIPLES: "tells Claude to send the decision as stated, and not to wait for an OK"). — [README.md](README.md), [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- **"Never collects decision text" versus hosted records.** Opt-in records sit on Grill's store under a key the operators hold; the hosted PRD concedes the relay "breaks one sentence of today's promise". — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md), [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md)
- **Opt-in rule versus an opt-out email.** PRINCIPLES says telemetry is opt-in and the look-back PRD said "No email. The only email remains the sign-in"; a later owner decision (2026-11-08) added a Monday impact email that is "on unless they turn it off", with a holdout experiment keyed on account ids. — [docs/PRD-lookback-reminders.md](docs/PRD-lookback-reminders.md), [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md)
- **Hosted scope.** PRD said hosted is "Pro only" and a free hosted route was out of scope; it shipped free with open sign-up. — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)
- **Numbers that disagree across files.** Price proposal $3 versus decided $9; service cap $20 default versus "about $40"; per-person key "default $1, no refill" in the ledger versus $5 monthly in HOSTED versus $0.50 one-time starter in PRO. — [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md), [docs/HOSTED.md](docs/HOSTED.md), [docs/PRO.md](docs/PRO.md), [docs/ROADMAP.md](docs/ROADMAP.md)
- **Reproducibility.** No pinning means a verdict cannot be reproduced; the audit use case needs a pinned model and is therefore pushed to a separate product. — [docs/STRATEGY.md](docs/STRATEGY.md)
- **Learning versus privacy.** Because decisions are not read, the only real-world quality inputs are opt-in reactions (`grill_feedback`, shipped 2026-11-09), dropdown-only signals, and miss cards (feature flag off). — [LEARNING.md](LEARNING.md), [MERGE-LOG.md](MERGE-LOG.md)

### Inferences
- A proprietary cross-user dataset of decisions and outcomes, the most obvious compounding asset for a decision product, is ruled out by principle 9, the ledger's use limit and the MIT/privacy posture. Any data advantage would have to be per-user (their own record) or aggregate, opt-in, content-free signals.
- MIT-forever plus an open prompt means the verdict step can be forked or absorbed by any host; the constraints push defensibility toward trust, the hosted account relationship, distribution position and the record.

### Gaps
- The full text of docs/PRIVACY.md and docs/PRD-privacy-foundations.md was only skimmed; section-level triggers for work-mode features were not extracted.

## 4. What do the evals measure, and is there evidence the outside judge adds value?

### Takeaway
There is no measurement anywhere in the repo that a cross-company judge beats a same-model self-critique, and no measurement that verdicts are right in the real world. The evals are regression floors on 29 synthetic cases plus one blind prompt A/B (which the candidate lost); no eval scores are committed, CI cannot run them, and the changelog admits every scheduled eval run before a recent fix "passed without reaching a judge".

### Cited Findings
- Main eval: "29 fictional founder/operator decisions... never a real user's decision." "These thresholds are sanity floors, not precise scores. Twenty-nine cases is not a statistically powered benchmark... the same case can score differently run to run." Goal is "to catch a regression... not to grade its reasoning precisely." — [evals/README.md](evals/README.md)
- Floors: catchRate 0.67 (11 of 15 flawed cases), figureCatchRate 1.0 (4 of 4 wrong-figure cases), falseAlarmRate at most 0.34, loadedCatchRate 0.67 (3 of 4), decorrelatedRate 1.0, schemaViolationRate at most 0.1. — [evals/thresholds.json](evals/thresholds.json), [evals/README.md](evals/README.md)
- `decorrelatedRate` checks only that "every run [was] judged outside Claude's family"; it is a routing check, not a quality comparison. — [evals/README.md](evals/README.md)
- Catch scoring is a phrase-match gate; for wrong-figure cases "A stated number that matches is a matching correction, not proof the judge calculated it." Jev readings are "watched before they are trusted" and are not yet gates. — [evals/README.md](evals/README.md), [LEARNING.md](LEARNING.md)
- "The eval gates only run with a key. CI has no OpenRouter key, so there the eval prints `SKIPPED: no judge ran`." — [evals/README.md](evals/README.md)
- "Before this, a missing key was a green skip, and every eval run since the workflow was added passed without reaching a judge." — [CHANGELOG.md](CHANGELOG.md)
- A private held-out set exists outside the repo; its scores are reported "only as rates" and no values appear in the repo. — [evals/README.md](evals/README.md)
- Verdict-quality harness: blind A/B of the current judge prompt versus a candidate rule (`GRILL_JUDGE_COMMIT`). Bar: candidate wins at least 60% of decided pairs with one-sided sign test p < 0.1. Holdout v1 (15 cases, including "two real failures") measured once on 2026-11-09: candidate won 9, lost 6, p = 0.30, so the rule stays off. Holdout v2 is 25 new cases, unused. — [evals/verdict-quality/README.md](evals/verdict-quality/README.md), [evals/verdict-quality/holdout-v1-spent.txt](evals/verdict-quality/holdout-v1-spent.txt), [MERGE-LOG.md](MERGE-LOG.md)
- Screening panel of three cheap models (gpt-4o-mini, deepseek-chat-v3.1, gemini-3.1-flash-lite): on the spent holdout "full answers matched the owner on 13 of 15 pairs and trimmed answers matched on 7 of 15". — [evals/verdict-quality/README.md](evals/verdict-quality/README.md)
- Outcome accuracy loop (verdict versus what happened) is designed as monthly opt-in signals but needs at least 10 data points and "hundreds" before it is more than directional; evidenced look-backs are 0. — [LEARNING.md](LEARNING.md), [docs/STRATEGY.md](docs/STRATEGY.md)
- The wrong-figure cases "come from arXiv 2607.05904". — [evals/README.md](evals/README.md)
- `data/contributors.json` is an empty array. — [data/contributors.json](data/contributors.json)

### Inferences
- The central product claim (a different lab's model catches blind spots the same lab's model misses) is argued from first principles and an essay, not tested. The existing harness (blind pairs, sign test, panel screen) could be reused to run exactly that comparison (cross-company judge versus same-model critique versus stronger same-lab model) but nobody has.
- The v1 result shows the team does hold prompt changes to a blind test, and that a plausible improvement failed it; this is evidence of discipline, not of product value.
- Because the judge is whatever the Auto Router serves, eval results are not tied to a fixed model and will drift; there is no per-judge-family quality table in the repo.

### Gaps
- No committed eval results file, no held-out rates, no Jev agreement statistics.
- No data on how often a grill changed a user's decision, beyond the owner's own records (not in repo).

## 5. Real usage, funnel, analytics and distribution

### Takeaway
Usage is essentially the maintainer's own: 1 outside real user, 0 evidenced look-backs, 4 hosted accounts of which 3 are internal. Analytics are deliberately content-free counters. Distribution is entirely through other companies' assistants, with verified connectors in three apps and material friction in each.

### Cited Findings
- "1 real user and 0 evidenced look-backs" as of 2026-11-09; first real grill 2026-11-05; commit "Docs: record the real-user count (1 as of 2026-11-09)". — [docs/STRATEGY.md](docs/STRATEGY.md), `git log`
- Maintainer usage: "Kindo's own repo ran about ten a day"; 197 runs in a Kindo Q3 audit; 8 Kindo grills in the 2026-10-11 review had no confidence or prediction. — [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md), [docs/PRD-lookback-reminders.md](docs/PRD-lookback-reminders.md)
- The local free tool is "mostly invisible, by design" (no account, opt-in ping only). — [docs/STRATEGY.md](docs/STRATEGY.md)
- Funnel instruments: Redis counters for `/start` views and refs, paid-intent (pricing view, checkout view, Notify me), `account_created`, `first_grill`, four look-back funnel integers, founding count N/100, HyperLogLog actives; printed by `scripts/weekly-metrics.mjs`. PostHog off. No actual values are in the repo. — [docs/experiments/analytics-loop.md](docs/experiments/analytics-loop.md), [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md)
- Verified hosted connectors: Claude.ai, ChatGPT, Grok Bot. Gemini and Muse: copy-and-paste works; connector not verified. — [docs/HOSTED.md](docs/HOSTED.md), [README.md](README.md)
- Friction per app: Claude free plan allows one custom connector, and Team plans need an owner to add it; asking Claude in chat to connect does not work. ChatGPT custom connectors work on web/desktop only, not iPhone or Android; requires a risk acknowledgement. Gemini connector needs a US personal account, 18+, English, Keep Activity on. Microsoft 365 Copilot needs an admin; consumer Copilot is paste only. DeepSeek paste only. Grok Bot needs an X plan that includes it. Claude Desktop local install needs an OpenRouter key with credit ("about 10 [minutes] if you need one"). — [README.md](README.md), [MERGE-LOG.md](MERGE-LOG.md)
- Impersonation risk: assistants can answer "as Grill" without calling the tool; copy now says "If yours shows none and the answer still claims to be Grill's, Grill may not have run." — [MERGE-LOG.md](MERGE-LOG.md), [README.md](README.md)
- Triall's note "that the host AI may rephrase the question before sending it applies to Grill too." — [docs/COMPETITORS.md](docs/COMPETITORS.md)
- Hosted limits: service cap $20/month default, $5 per person per month, 30 completed checks a day, three concurrent grills; a grill takes 1–3 minutes (returns a job id after 45 seconds). — [docs/HOSTED.md](docs/HOSTED.md), [docs/PRD-hosted-pro.md](docs/PRD-hosted-pro.md)
- Directories: Glama live; MCP Registry stale (v0.1.0, local only); Smithery dead; Claude and ChatGPT listings not yet submitted/approved. — [docs/ROADMAP.md](docs/ROADMAP.md), [docs/COMPETITORS.md](docs/COMPETITORS.md)

### Inferences
- With one outside user there is no retention, conversion or willingness-to-pay evidence at all; every strategy claim about look-backs and Pro is a hypothesis.
- A 1–3 minute wait and per-app connector setup are significant friction relative to typing "argue the other side" into the same chat, which is the real substitute.
- The host assistant controls what is sent, whether the tool is called and how the verdict is relayed, so Grill's independence guarantee is partly at the mercy of the model it is meant to check.

### Gaps
- No live counter values (start views, sign-ups, paid-intent clicks, founding count) are recorded in the repo.
- Outreach results from @AskGrill (leads, reply rates) are not in the repo.

## 6. Prompt versus infrastructure, and architecture

### Takeaway
The verdict itself is a prompt plus a router call and is open source, so it is trivially copyable and could be absorbed by a host assistant. The harder-to-copy parts are the hosted OAuth connector with client-to-company mapping, encrypted records and look-back surfaces, privacy masking and zero-retention routing, and the eval/holdout harness; these are real engineering but all MIT-licensed.

### Cited Findings
- Prompt layer: `prompts/grill.md` (about 20 KB paste prompt), `skills/grill/SKILL.md` (20 KB), `paste-prompt.md`, `reflection.md`, `skills/weekly-review/`. STRATEGY: "The prompt is open source and easy to copy." — [prompts/grill.md](prompts/grill.md), [skills/grill/SKILL.md](skills/grill/SKILL.md), [docs/STRATEGY.md](docs/STRATEGY.md)
- Judge core: `scripts/judgeCore.mjs` (2,245 lines) and `scripts/judge.mjs` (955): Auto Router call, company exclusion with retry and refusal, masking, schema validation, quote-grounding check, "Checked for you" versus "Your call" split, layered output. — [scripts/judgeCore.mjs](scripts/judgeCore.mjs), [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- Local MCP server: `server/index.mjs` (844 lines), zero third-party dependencies, shipped as `.mcpb`, `npx -y grillyour`, and a Claude plugin (`.claude-plugin/`). — [server/index.mjs](server/index.mjs), [docs/PRINCIPLES.md](docs/PRINCIPLES.md)
- Hosted: `api/_hosted.mjs` (3,979 lines) and `scripts/hostedCore.mjs` (1,537): Streamable HTTP MCP at `grillyour.ai/mcp`, Clerk OAuth with DCR/CIMD, OAuth-client-to-company mapping (anthropic, openai, x-ai, google, meta), per-person capped OpenRouter keys, encrypted records, `/decisions`, `/account`, `/judge`, `/share/<token>`, iCalendar feed, weekly email. Tools: `grill`, `grill_result`, `grill_decided`, `grill_look_back`, `grill_feedback`. Deployed on Vercel with Upstash Redis. — [docs/HOSTED.md](docs/HOSTED.md), [api/_hosted.mjs](api/_hosted.mjs)
- Accounts and billing: `api/_account.mjs` (1,706), `api/_pro.mjs`, Stripe checkout and webhook, pricing, waitlist, founding, notify. — [docs/PRO.md](docs/PRO.md)
- Hook: one Claude Code `PreToolUse` hook on `ExitPlanMode` that offers an outside judge once per session; "Sends nothing"; off with `GRILL_PLAN_OFFER=off`. — [hooks/hooks.json](hooks/hooks.json), [CHANGELOG.md](CHANGELOG.md)
- Jev quality check: third-party (TypeSafe) model via OpenRouter, about $0.0002 a grill; not Grill's own asset, and Cruxes' site also mentions Jev. — [LEARNING.md](LEARNING.md), [docs/COMPETITORS.md](docs/COMPETITORS.md)
- Automation: workflows `ci`, `eval`, `learn`, `upstream`, `release`, `automerge`, `grill-pr` (GrillBot grills pull requests and fails a job if the judge was the author's vendor). — [.github/workflows](.github/workflows), [docs/PR-AUTOMATION.md](docs/PR-AUTOMATION.md)
- Site: static build (`scripts/build-site.mjs`, `site/`), no scripts on account pages, live commit named in footer. — [docs/PRINCIPLES.md](docs/PRINCIPLES.md)

### Inferences
- Classification (inference): *just a prompt* = verdict format, clerk-style write-up, steelman-then-attack, falsifier, look-back questions, paste route. *Thin glue* = router call with exclusion, hook, skill packaging. *Real infrastructure* = hosted MCP with OAuth and client identification, encrypted per-user record store and look-back scheduling, caps and key management, masking corpus, eval and holdout harness, PR bot. *Not owned* = the judge models (OpenRouter), Jev (TypeSafe), sign-in (Clerk), every chat surface.
- As frontier models improve, the "catch a factual or arithmetic slip" part of a verdict is the most exposed to being matched by the host model itself; the parts that do not depend on model quality are independence of incentive/provenance, the persistent cross-assistant record, and outcome tracking.
- The cross-assistant record (source_app, proposed_by ai/me, supersedes chains, outcomes) is the only data structure in the repo that no single host assistant can reproduce across vendors; it is also the least-used feature today.

### Gaps
- The code was sized and skimmed, not audited; behaviour claims rely on the docs and test names quoted in PRINCIPLES.md.
- No uptime, latency distribution or error-rate data for the hosted service is in the repo.
