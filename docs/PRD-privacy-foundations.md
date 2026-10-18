# PRD: Privacy foundations for work use, and when to build the rest

Status: proposed 2026-10-18. The owner delegated the split between now and later. Owner-only calls are listed in §8. Decision record: `grill-hub/decision-log/D-20261018-01.md` in the ops repo. The triggers that bring deferred work back are in the ops repo's growth framework, section F. This file changes no code and no privacy text. Every change below ships in its own pull request.

Grilled 2026-10-18: **solid if** (openrouter/auto, Anthropic excluded). Four challenges. Three are adopted: the core rule is scoped so it is true today (§2); the homepage tagline's own channel gets a work-use line in P1a (§3); and the "demand is near zero" premise is tested by O0, which can pull X1 into Now. The fourth said later items have no checkable trigger. Partly rejected: each one has a trigger expression and a file-backed source in section F. A team pilot and a buyer are rows GrillBot reads, and every row is reviewed on 2027-01-16.

## 0. Why, in one line

The homepage now says "Grill your AI before you send it to your boss." (#90), so people will grill work material, and several published privacy claims, including five in PRINCIPLES.md, are stronger than the code.

North Star check ([PRINCIPLES.md](PRINCIPLES.md#north-star)): the goal is 100 real users, and the count is not recorded ([STRATEGY.md](STRATEGY.md) rec 1). Careful users who make big decisions adopt Grill because of trust. If one false privacy line is found while Grill is at n≈0, it costs more users than any lever gains. So Now is small: count the 100, make every claim literally true, fix the cheap storage gaps, and add the one count that tells us when the rest is due. Everything an employer would see waits for one team pilot and a named buyer.

## 1. What exists today

| Claim or behaviour | What the code does | Literally true? |
|---|---|---|
| "Only the write-up you approve" (README.md:18,100; PRINCIPLES.md:25,27; site/privacy.html:26; site/page.html:284; manifest.json:9; skills/grill/SKILL.md:69) | The instructions say "Do not wait for an OK" (server/index.mjs:263,633; scripts/hostedCore.mjs:603) and send "whatever context is already in the chat" (server/index.mjs:262), which can include a file the person shared | No |
| "Grill keeps nothing" (site/page.html:208); "straight to the AI services" (site/terms.html:26) | On the hosted route the write-up passes through Grill's server. The note is held for 15 minutes; drafts and records are kept if the person opts in (api/_hosted.mjs:1086,1173) | No, for the hosted route |
| Hosted: "in memory. It is never logged or stored" (PRINCIPLES.md:45; site/privacy.html:35); "It never stores the write-up" (PRINCIPLES.md:61) | The hosted spawn writes `report.md` to /tmp and removes it only when the child closes (api/_hosted.mjs:946-975). Every layer is held 15 minutes. Drafts copy lines of the write-up when records are on | No |
| "Emails, phones and card numbers are hidden" (site/privacy.html:26) | Masked only inside the judge process (scripts/judge.mjs:380-393). Drafts and the stored layers use the raw subject (api/_hosted.mjs:1043-1048,1134; scripts/reflection.mjs:73-136) | Misleading |
| "If you say no, nothing is kept" (site/privacy.html:37) | Turning records off (api/_hosted.mjs:1204-1207, 2335-2340, 2389-2394) leaves existing drafts for up to 14 days, and Delete all skips them (:2346-2348) | No, once records were on |
| "The verdict is held … 15 minutes" (site/privacy.html:36) | Every layer is held, and it can repeat the write-up's first sentence and cited sources (api/_hosted.mjs:1168-1174; scripts/judgeCore.mjs choiceLabel, findCitedSources) | Understated |
| "The optional Jev quality check … is zero-retention. It keeps nothing" (PRINCIPLES.md:33); "asked, on every request" and "the router does not keep it" (site/privacy.html:22,41; server/index.mjs:74; scripts/hostedCore.mjs:14) | The check is on by default (server/index.mjs:130-138; api/_hosted.mjs:1248). Its request carries no `provider` flag (scripts/checkCore.mjs buildCheckRequest); only the judge request does (scripts/judge.mjs:505). OpenRouter's categorisation sampling under `zdr` is unchecked | No for "optional"; the rest unverified |
| "Grill uses OpenRouter's Auto Router. It does not pin models." (PRINCIPLES.md:87) | True of the judge. The quality check is a fixed model, `typesafe/jev-1.13` (scripts/checkCore.mjs:29) | Unscoped |
| "Grill tells you each time" about the check (site/privacy.html:26) | The instructions say not to mention it (server/index.mjs:257) | No |
| "Nothing that identifies you" (site/privacy.html:45) | PostHog events do not set `$ip` (scripts/siteAnalytics.mjs:60). Whether the project discards IPs is not recorded | Unverified |
| "Nothing about your decision" (.github/ISSUE_TEMPLATE/grill-signal.yml:2) | Each issue is public and tied to the person's GitHub name, with kind, verdict, confidence and outcome | No |
| "Who else is involved": OpenRouter, Upstash, Vercel (site/privacy.html:41) | Also the judge's company, TypeSafe (Jev), Clerk, AgentID, PostHog, and the person's calendar company | Incomplete |
| Operators "could decrypt records" (site/privacy.html:39; DATA-LEDGER.md:18) | True, and it covers drafts. The page-session cookie is signed with an HMAC of `GRILL_RECORD_KEY` (api/_hosted.mjs:1550-1553), so that key also opens anyone's /decisions export | Understated |
| The records question: "Keep a record of your decisions on your Grill account? Yes / No" (scripts/hostedCore.mjs:31) | Says nothing about operator access at the moment the person chooses | Omission |
| Email indexes "never the email" (PRIVACY.md:20) | Unsalted SHA-256 of the email (api/_hosted.mjs:244-249,299-301), so store access confirms a guessed address. The HLL salt falls back to `GRILL_RECORD_KEY` (:329) | Understated |
| "We count the cost, time and model of each grill" (site/privacy.html:40) | A per-account list of the last 400 grills with ISO time, cost and model (api/_hosted.mjs:1159-1160). Nothing reads it (deleted at :2287 only). The account row also carries a legacy `spend` array (:637) | Understated |

What already holds, and is reused: masking and the secret stop (scripts/judgeCore.mjs:576-619); encrypted records and drafts; the no-IP ping and miss stores (scripts/ping.test.mjs:236-245); the active-people HLL (api/_hosted.mjs:305-334); destinations pinned by `scripts/privacy.test.mjs`. Public signal issues: 0 filed (`gh api "repos/mtangoz/grill/issues?labels=signal&state=all"`, 2026-10-18).

## 2. The core rule

> Insight flows down to the person. Grill builds and grants no per-person view to anyone else: not an employer, not a team lead, not Grill's operators. Anything that flows up, to Grill or to an employer, is text-free, threshold-gated and aggregate.

This is a rule about the views Grill builds and grants. It does not claim that operators cannot read stored records. Today they can: they hold the key that wraps saved records and drafts. So the same PR states that limit directly under the rule, in the same words the records question uses.

P1b adds the rule to PRINCIPLES.md as a "Who sees what" section. Under it goes a public "not yet true" list: the operator-held record key (X1) and the plaintext email and unsalted indexes (X2). Each line links its fix and is deleted in the PR that fixes it. A rule that its own page shows to be false fails the claims test. Tests: `scripts/claims.test.mjs` (P1b) bans the replaced phrases and pins the once-only line and the check wording; "no route lists accounts" and "counts are numbers only" pin P3. The store-allowlist test (every Redis key in a declared family with a DATA-LEDGER row) and the envelope schema and differencing tests arrive with X3 and X4, where they first protect something.

## 3. Now

| # | Item | Files or place | Tier | Owner | Closes |
|---|---|---|---|---|---|
| P0 | This PRD | docs/PRD-privacy-foundations.md | low | no (auto-merge) | — |
| O0 | Count the 100: record evidenced users and look-backs (signal issues 0, plus outreach replies and conversations). Each conversation also records, with no names or text, whether the person grilled work material and whether records were on. If 2 of the first 10 conversations did both, X1 moves to Now | docs/STRATEGY.md (low); ops `grill-growth/evidence.md` and `user-conversations.md` | low | supplies the counts only they know | STRATEGY rec 1; tests the deferral premise |
| T1 | Ops plumbing, bot-only | ops repo: `snapshot.py` evaluates section F and stops writing `new_senders`. Tracking issue: #92 | ops | no | trigger sources |
| O1 | Owner settings session, about 20 minutes, no PR | OpenRouter: Input & Output Logging off on the hosted router account, or hosted keys excluded; answers on categorisation sampling under `zdr=true`, any opt-out (turn it on), and whether the Auto Router sends prompts to a third party. PostHog: "Discard client IP data" on. `GRILL_METRICS_SALT` set if unset. Regions of Vercel functions, Upstash and Clerk. One live decisions-endpoint call with `provider.zdr` | — | yes | S9, G10, G6, S10, G3 check |
| P1a | Honest claims, copy on safe paths, and a work-use line under the homepage tagline: "For work material: the free tool keeps nothing, and in chat you can say No to records." | README.md:18,100; site/page.html (tagline block), 208, 284; docs/PRD-hosted-pro.md:39 (drop "deleted on first read"; add a Pro launch-blocker list); docs/DATA-LEDGER.md:16 (layers can repeat the first line and cited sources) | low | no (auto-merge; only narrows claims) | G5 copy, S5 homepage, G4 |
| P1b | Honest claims, the rest, and the core rule | docs/PRINCIPLES.md:25-27,33,45,87 plus "Who sees what"; docs/PRIVACY.md:7,18,20; site/privacy.html:26,35-40; site/terms.html:26; manifest.json:9,42; skills/grill/SKILL.md:42,69; api/_hosted.mjs:2202 (copy); server/index.mjs:251 (comment); scripts/hostedCore.mjs:31 (records question); scripts/claims.test.mjs; anchors in scripts/principles.test.mjs and the tests that assert the records question | high | yes | G5 (option A), S4, S5 terms, S12, G1 copy, §2 |
| P2 | Hosted: nothing unmasked, on disk or per-grill outlives the request | api/_hosted.mjs: `safeSubject = redactSensitive(subject).text` for draftFromGrill and renderLayers (:1043-1048,:1134); drop `--out`, the mkdtemp/readFileSync/rmSync (:946-975) and the `report` fallback at :1128; `deletePendings` on every records-off path (/decisions :2335-2340, /account :2389-2394, and the grill tool's `keep_records: false` switch at :1204-1207) and on Delete all (:2346-2348), with a notice on /account; delete the spend list (RPUSH/LTRIM at :1159-1160, one-off DEL) and the legacy `spend` field (:637); `GRILL_PAGE_KEY` for the page cookie (:1550-1553); `GRILL_METRICS_SALT` required, no fallback (:329). Also scripts/hosted.test.mjs (no `--out` in spawn args; drafts masked; drafts gone on off), docs/HOSTED.md env table, docs/DATA-LEDGER.md, docs/PRIVACY.md:118, site/privacy.html:37,40, PRINCIPLES.md:61 | high | yes, plus `GRILL_PAGE_KEY` set before deploy | G2, S6, G8, S7, G1 impersonation, S8 salt |
| P3 | Hosted counts route | api/_hosted.mjs: `GET` counts behind `Authorization: Bearer GRILL_OPS_TOKEN`. It returns only PFCOUNT for the active day, ISO week, current month and last complete month, as integers. No SCAN, no account or record counts, no ids. Tests: output keys are an allowlist; no route lists accounts. One DATA-LEDGER line | high | yes, plus `GRILL_OPS_TOKEN` | trigger source |
| P4 | Zero retention on the quality check | scripts/checkCore.mjs (`provider: { zdr: true, data_collection: "deny" }`), the stale comments at scripts/judge.mjs:91,106-107 and checkCore.mjs:16, a test that every outbound body (judge, deepen, check) carries the flag | high | yes | G3 |
| P5 | Signal issues say what they are. Keep the opt-in offer, which is Grill's only learning signal from real use. The form and the offer say it is a public GitHub issue under your own name, and it leads with "use a separate GitHub account if your employer could see it" | .github/ISSUE_TEMPLATE/grill-signal.yml:2 and its first markdown block; skills/grill/SKILL.md:131 (the offer line); skills/weekly-review/SKILL.md:103; LEARNING.md "Honest limits" | medium (skills/**) | no (narrows a claim) | S1 |
| P6 | Reserve `space`; every record is personal | docs/DECISION-RECORD.md (optional `space` line: `personal` or an org space id, set at grill start, never changed, missing means personal); docs/HOSTED.md; docs/DATA-LEDGER.md: "Every hosted record today is personal: keyed to your account alone; no org, team or employer can be attached to it." | low | no | G9 |
| P7 | Using Grill at work, and who else is involved | site/privacy.html (new section; lines 22, 41, 45, 47); docs/PRIVACY.md:15-16; docs/DATA-LEDGER.md (sub-processor and region table, dated O1 answers); docs/manual-check.md (quarterly re-check); site/start.html:19,60; site/page.html:212; README.md:87; scripts/siteAnalytics.mjs:60 (`$ip: null`) and its test; the once-only line at server/index.mjs:74, scripts/hostedCore.mjs:14 and skills/grill/SKILL.md:27, kept identical, if O1 finds router sampling | high | yes | S2, S3, S11, S10, G6, G10, G1 copy |

Wording P1b uses. For the send: "What your assistant sends: the decision in your words, plus what's already in this chat, which can include text from a file you shared there. Keys stop the run; emails, phones and card numbers are masked." For the records question: "Keep a record of your decisions on your Grill account? Grill's operators could decrypt saved records, so say No for material under NDA. Yes / No". For the check: "The quality check is a separate, fixed TypeSafe model, not the judge. The judge is always openrouter/auto and is never pinned. The check's only listed endpoint is zero-retention, and Grill re-checks that weekly. If a retaining endpoint appeared, requests could reach it until that check catches it. Say 'skip the check' to turn it off." PRINCIPLES.md:87 becomes "The judge uses OpenRouter's Auto Router. It does not pin models." plus that check sentence, so the `no-pin` anchor stays. PRINCIPLES.md:45 becomes "in memory, except a 15-minute encrypted note and, if you keep records, a draft"; P2 adds "nothing is written to disk". P1b says nothing about the router keeping or sampling; P7 says that, from O1's answers. P1b does not say the check request carries the flag until P4 merges and is confirmed enforced.

## 4. Honest limits for work users (the P7 text, in substance)

- If you grill material under NDA, the installed tool keeps nothing at Grill. Grill in your chat with records off keeps no decision text beyond the 15-minute encrypted note. Until P2 ships, it also keeps a report file on the server's disk for the length of the grill, the time, cost and model of each grill (the last 400), and any drafts left from when records were on (up to 14 days). The text still goes to OpenRouter, the judge's company and, unless you say "skip the check", TypeSafe. Masking covers emails, phones and card numbers only; names, clients and deal terms go as written. Whether your NDA allows that is your call.
- With records on, Grill's operators hold the key that wraps saved records and drafts, so they could decrypt them.
- A company-run Claude Team or Enterprise, ChatGPT Enterprise or Gemini workspace keeps the tool call, the write-up and the verdict in its admin and compliance exports. A work inbox receives your sign-in codes. A work calendar shows look-back dates, and titles if you turn them on, to its admins. A company Drive or Notion holds a weekly-review log. Employer device and network monitoring sees what you type. Grill cannot prevent any of this. For anything you would not show your employer, use a personal account, email and calendar.
- The Gemini route needs Keep Activity on, so Google keeps the chat. Don't use it for NDA material.
- Never claimed: "Grill can never see it", "end-to-end encrypted", "nothing leaves" or "NDA-safe". The server sees plaintext in memory while it serves a request, on every route that passes through it.

## 5. Next and later, on triggers

Section F of the growth framework holds the register: metric, source, threshold, the stage each item gates, and what GrillBot does when a trigger fires. An item whose "Then" says PRD gets its own PRD in this format; the others go to the daily ask, to scoring or to a gate, as that column says. GrillBot opens those PRs with the `do-not-merge` label, because a solid PR grill clears `needs-review` (scripts/grillPrCore.mjs). They merge only after the owner says yes and removes the label.

| Item | Bucket | Fires when (first of) |
|---|---|---|
| X1 User-held record keys: HKDF wrap from a secret the person holds (connector credential, passkey PRF or export code), unwrapped only in request memory, operator-wrapped copy deleted after the person confirms. The 15-minute slot is deleted after the full layer is read when records are off | next, or Now if O0 fires | 2 of the first 10 conversations grilled work material with records on (O0); ≥ 2 distinct nda or who-can-read contacts in 60 days; hosted active month (net) > 10; a team-pilot record decided; a Pro launch PR |
| X2 Identity at rest: email and owner email as one cipher; owner-email cache encrypted; person, email and spend indexes (and Pro `emailKey`) as HMAC-SHA256 under `GRILL_INDEX_KEY`, dual read for 60 days | next | hosted active month (net) > 10; a D-record to set `GRILL_OPEN_SIGNUP=on` (scripts/hostedCore.mjs:215-217); team pilot decided |
| X3 Aggregation gate (scripts/gateCore.mjs): min 8 people and 30 decisions per cell, complementary suppression, no drill-down, the only read path. First output: one service-wide cell per calendar month (drafts decided vs expired, changed-your-call counts). Ships the store-allowlist test | next | hosted active month (net) > 10 for 2 complete calendar months; ships before X4 |
| X4 Signal envelope v1: enums only, no account id, cohort token plus ISO week, one write path that drops the session first, personal opt-in asked once, consent version stamped, no backfill. Includes options C and D of the 2026-10-11 insight. Needs a PRINCIPLES.md:57 change (high tier, owner): the PRD must show the cohort token is shared by ≥ 8 people, rotates, and cannot be joined to the account id or an email index | next | X3 merged and X3's trigger still met |
| X5 Work mode (G5 option B): show the exact text and wait for an OK when the person says confidential, NDA or work, or a file is in the chat; send only the stated decision plus context the person names; Jev off | next | ≥ 2 distinct nda or work contacts in 60 days; ≥ 3 of the last 20 conversations (rolling) grilled pasted work files; team pilot decided. The raw-vs-stated eval passes first |
| X6 Pro launch blockers: report copies encrypted or refused (api/_account.mjs:1446-1459), masked like P2 | next | the Pro bar is met (STRATEGY rec 4), or a PR touches `GRILL_PRO_BILLING` or `testModeEnabled` |
| X7 Jev hardening: a send-time endpoint check, or the check off by default in work mode | next | an open "Upstream drift" issue about Jev; P4's flag is rejected |
| X8 Team-pilot privacy kit: personal accounts, records off for NDA material, shared record as copied blocks in the team's own doc, Jev off on request, the lead sees nothing per person | next | a team-pilot record names a team and a start date |
| X9 Buyer pack: versioned sub-processor list, DPA template, security answers drawn from ledger facts | next | ≥ 1 dpa or security-review contact in 60 days; a buyer conversation logged |
| L1 Spaces in code: `space` on drafts and rows, org rows under `grill:hosted:space:<id>:*` with their own key, no moves in either direction, the space stated on every grill | later | the pilot finished with keep or pay, and a buyer asks for shared records inside Grill. Needs X1 and X2 |
| L2 Org aggregate view, through X3 only | later | L1 live, and one org space passes the gate in a month |
| L3 Training loop: private suggestions to the person, cohort uptake to the org | later | L2 live 3 months, ≥ 30 look-back outcomes per gated cell |
| L4 Customer-managed keys · L5 SSO for org spaces · L7 EU residency · L8 cross-org learning (org opt-in, envelope only) · L9 org-space break-glass policy | later | a named buyer requires it in writing, or ≥ 2 buyer conversations tag it in 60 days (L8: 3 orgs opted in; L9: before the first org-space record) |
| L6 Provider allowlist | not in Grill | Only as a separately named product under STRATEGY principle 10, or not at all. Grill keeps openrouter/auto, excluding only the author's company |

## 6. Never

1. A per-person view for an employer, manager or org admin. That rules out a row, filter, export, alert, score or "who didn't use Grill".
2. Operators reading decision text as a feature, a support step or an analysis, or per-account operator dashboards. That includes joining hosted counts to Clerk, PostHog, any other product's data, or any identity (rejected in the 2026-10-11 insight). Operators can technically decrypt saved records today; X1 removes that, and until then the records question says so.
3. Any feature, export or process that opens a person's personal-space records to the operator or an employer. No moving a record between spaces after it is written.
4. Selling or sharing decisions, envelopes or aggregates (STRATEGY principle 9).
5. Free text in the envelope, or signals backfilled from records saved before consent.
6. Grill tying a learning signal to an identity. A public issue someone files under their own GitHub name is their choice, and P5 makes the form say so.
7. A claim stronger than the code, a judge pinned inside Grill, or a provider allowlist inside Grill, to satisfy a buyer (STRATEGY principle 10).

## 7. Privacy

This PRD adds no destination. P2 shrinks what is stored and who can match it. P3 adds one operator read of counts that already exist; its token reads nothing else, and it needs a DATA-LEDGER line. X4 is the first new telemetry. It needs opt-in, PRIVACY.md first, a PRINCIPLES.md:57 change and the gate (GUARDRAILS §4, §6).

## 8. Decisions

Taken (owner may overrule):

| Question | Choice | Why |
|---|---|---|
| Fix a false claim with copy or with code | Copy, unless the code fix is small and has no downside (P2, P4) | Honesty is non-negotiable. Code that costs more waits for evidence |
| Hosted records for NDA material before X1 | Say No at the records question, or use the installed tool | The claim stays literal without L-sized work at n≈0. O0 can pull X1 forward |
| The homepage tagline | Keep it. P1a adds the work-use line under it | It is the owner's call (#90). The line makes the channel honest without taking it down |
| Gate T (section F rule 2) | Active: no GrillBot lever that markets hosted Grill for work or team use scores above 0 until P1a, P1b and P2 merge, O1 is done, and P4 merges or P1b's check wording is live | The installed tool stays fully promotable. The gate ends by itself when the work is done |
| Counts source | P3: a server route returning four integers, exact in the ops repo, `<5` when published | A read-only Upstash token can GET every account row (api/_hosted.mjs:626-650) |
| Account and record counts | Not now | Option C of the 2026-10-11 insight now waits on X4's trigger |
| Spend list | Delete it in P2 | Nothing reads it, and it is a per-person timeline |
| Per-person cap key on account deletion | Keep as is | It is intentional so delete-and-rejoin can't reset the cap, and disclosed (DATA-LEDGER.md:32). X2 makes it an HMAC |
| Signal issues | Keep, labelled honestly (P5) | They are opt-in, and the only learning signal from real use. Stopping them would cost the loop in LEARNING.md for a risk the person chooses |
| Team pilot | Runs on personal accounts first (X8). Spaces only if the pilot needs Grill-held shared records | The pilot then waits on nothing large |
| Gate thresholds (X3) | 8 people and 30 decisions per cell, month cells first, no noise in v1, never lowered to make a cell appear | Small enough to fire within a pilot, large enough to stop differencing by one person |
| The 2026-10-11 hold on options C and D | Replaced by X4's tighter trigger | X4 needs X3 first, which is stricter than "> 10 hosted users" |
| Break-glass | None for operators or personal space. None for org space in v1; decided again in L9 before the first org record | No path into a person's records is the default the rule needs |
| Provider allowlist | Not inside Grill. A separate product under STRATEGY principle 10, or nothing | Grill keeps openrouter/auto, excluding only the author's company |
| Section F rules, register and thresholds, and directive steps 2b and 4 (R1) | In force from 2026-10-18; reviewed 2027-01-16 | The owner asked on 2026-10-18 for future plans to feed GrillBot's growth loop |

For the owner, with a recommendation each:

1. G5: option A now (the claims match "no OK"); option B, show-before-send, behind X5. **Recommend A.** It changes a line of PRINCIPLES.md.
2. The core rule and the "not yet true" list in PRINCIPLES.md (P1b), worded as in §2. **Recommend yes.**
3. O1 vendor settings, this week, and the secrets `GRILL_PAGE_KEY`, `GRILL_OPS_TOKEN` and `GRILL_METRICS_SALT` before P2 and P3 deploy. **Recommend yes.** Only the owner has these accounts.
4. If P4's flag is rejected by the router: **recommend keeping Jev on by default with the exact P1b wording**, and off in work mode (X5).
5. The tagline, if P1a and P1b have not merged by 2026-10-25: **recommend scoping it to the installed tool until they do.**
6. R2: support triage writes a privacy `topic` per thread, only on lines whose sender is replaced by an HMAC under a secret kept off the ops repo. It changes a routine (GUARDRAILS §4). **Recommend yes.** Until then, the support-topic triggers are dark and O0 conversations carry those rows.

## 9. Measures

- Rows in §1 not literally true or unverified: 16 today. Target 0 once P1a, P1b, P2, P4, P5, P7 and O1 are done. `scripts/claims.test.mjs` stops new ones.
- Evidenced real users and look-backs recorded in STRATEGY.md by 2026-11-01, then monthly.
- Section F sources live (hosted counts, support topics, conversations, evidence ledger): 0 of 4 today, 4 of 4 by 2026-11-30.
- Verdict quality is unchanged: the eval catch rate after P1b, P2 and P4 stays within one standard error.

## 10. Order of work

P0 with T1 and O0 → P1a → P1b → P2 → P3 → P4 → P5, P6 → P7 once O1 is done. O1 happens any day this week. Until P3 ships, the owner reports one number a month (invited emails plus Clerk users, minus maintainers) in the bundled ask. Owner reviews are bundled into one ask a day (growth framework, section B tie-breakers).

## 11. Out of scope

The private-mode build (approved 2026-10-15, its own PR; §4 points to it once it ships). The independence gap (STRATEGY rec 3). Every next and later item. Pro billing. Any change to the judge route or `openrouter/auto`.

## 12. Done when

- STRATEGY.md records the evidenced counts, dated.
- O1 answers are dated in DATA-LEDGER.md and docs/manual-check.md.
- P1a through P7 are merged. `node --test scripts/*.test.mjs` is green, with zero new dependencies.
- Every row in §1 reads "yes", or its claim has been rewritten to match the code.
- The "not yet true" list holds only X1 and X2.
- GrillBot's snapshot reports each section F row as armed, fired, dark or done.
