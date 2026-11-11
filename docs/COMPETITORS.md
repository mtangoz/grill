# Competitors

Updated weekly. This is a register of names from the latest public scan, not a ranking and not a claim about users.

The daily growth work reviews docs/ROADMAP.md before it asks what to build. A weekly scan updates docs/ROADMAP.md and docs/COMPETITORS.md together. New ideas get a consider-when line in the roadmap. A scan adds a date and what changed here.

Each entry has the name, a link, what they do, the threat or opportunity, what Grill could learn, the date seen, and the last updated date. Links are only the ones the scan recorded. Last scan: 2026-11-11.

## Cruxes

- Link: [cruxes.io](https://www.cruxes.io/) · research: [cruxes.io/research](https://www.cruxes.io/research) · research post: [reading a model inside](https://www.cruxes.io/research-site/posts/reading-a-model-inside.html)
- What they do: a harness as a service that finds the one question that would change a decision. The homepage now leads with "Cruxes finds the guesses behind an AI's answer, and lists every test of what works, failures included." Each crux has a DRI who owns the call. It quotes the user's text. The shape is team and agent harnesses with a decision owner. Where it runs: Claude Code, Claude and Google Docs. The Claude Code harness ships today. The other harnesses carry readiness labels. Shared sessions are in preview. The site mentions Jev, TypeSafe's decision API, as an optional step that reads the model's answer. They claim five patent applications filed, and 138 studies in four months. Of the first 136, 7 met their registered success rule, and 1 was credited by an internal recompute.
- Price, seen 2026-11-11: 15 free, then $29 a month. Unchanged. The 15 free Cruxes are in total, not monthly. $29 a month covers 100 Cruxes, then $0.10 for each extra. The site says early access, and rank is not a probability. A research write-up updated 2026-11-01 covers Cruxes Read, which reads an open model's activations. It is research only, needs open weights, and cannot run on closed models. The research page, updated 1 Nov, adds "Shuffle and re-ask". Asking a cheap choice model three times in shuffled order kept more right answers, 64% to 83%. Plain reshuffling got most of that. Accuracy stayed near 50%.
- Threat or opportunity: threat. Threat level: medium. Unchanged since the last note. They are close on the question, and they keep moving toward research and teams, not the solo in-chat decider.
- What we learned: the one question is worth showing, after the verdict, in the person's own words, and it has to stay short. A shared session needs a named decision owner. Their FAQ answers how this differs from a pre-mortem or a decision matrix, and says it does not make the decision. Labelling what is shipped, what is preview and what is planned, in plain language, builds trust. Fifteen free checks, then $29 a month, is evidence that some people pay for this job. Grill's own price is a separate decision, and Pro is not live. Publishing failures openly ("7 of 136 met their rule") is a trust move. Grill's own eval results, where a judge rule failed its holdouts, could be summarised in plain words the same way. Counts only.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## Crux (uncrux.io)

- Link: [uncrux.io](https://uncrux.io/)
- What they do: a free in-browser group decision tool. Each person sets weights for standing concerns: who runs it, who inherits it, money, and downside. Options are scored once. It shows which disagreement decides the answer. Optional "Consult Claude" drafts options. No sign-up.
- Threat or opportunity: threat, low. It is a group weighting matrix in a separate tab. There is no judge from another company, and no record or look-back.
- What Grill could learn: "find out what you actually disagree about" is a clean team hook. It matters only if the team pilot trigger fires.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## Council AI (councilai.app)

- Link: [councilai.app](https://councilai.app/) · launch post: [LinkedIn](https://www.linkedin.com/posts/alinjula_council-ai-activity-7515818512615931904-Ypxd) · review: [uneiaparjour](https://www.uneiaparjour.fr/en/council-ai-2/)
- What they do: asks Gemini, ChatGPT, Claude, Grok (and Perplexity Sonar) at once and shows where they agree and split. Preset councils, a Debater mode, and a percent agreement summary. Free. Moved from iPhone and iPad only to the web around 2026-10-13. Tagline: "For decisions that require a second opinion."
- Threat or opportunity: threat, low to medium. It is a separate app, with no decision record and no look-back. It is free, and it uses the same "second opinion for decisions" words as Grill.
- What Grill could learn: "where they agree / where they split" is an easy hook. Grill's answer is one different-company judge inside the chat the person already uses, plus the record. Say that in one line, without naming competitors.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Council AI (council-ai.app)

- Link: [council-ai.app](https://council-ai.app/)
- What they do: a separate product with a similar name. "Bring the work": paste a plan, contract, deck or code, and up to 21 models from 9 labs review it. A moderator gives one verdict with the disagreements listed under it, plus a consensus score. Independent by default: no model sees another's answer. An anonymous mode blinds model names. Exports to Word, PDF or Markdown. Memory can be imported from ChatGPT or Claude. The Ultra tier includes an MCP server for Claude Desktop, Cursor, Windsurf and Claude Code.
- Threat or opportunity: threat, medium for the plan-review use case. The MCP is paywalled at the top tier. The product is many-model consensus, not one decorrelated challenger with a cheap test.
- What Grill could learn: agreement is evidence only when the answer was not copied. That is Grill's decorrelation point, in plain words. A verdict someone can send (an export) is something people value. Grill's share link covers part of that.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Perplexity Model Council

- Link: [What is Model Council](https://www.perplexity.ai/help-center/en/articles/13641704-what-is-model-council) · [Model Council comes to Computer](https://www.perplexity.ai/hub/blog/model-council-comes-to-computer)
- What they do: runs one question across several models and combines the answers into consensus, disagreements and unique findings. On web and iOS it is for Max and Enterprise Max, with a monthly cap. Pro users can run it in Perplexity Computer (2 to 8 models, paid with credits). The blog page timed out during the scan, so the Computer details come from the search summary.
- Threat or opportunity: low direct threat, because it lives inside Perplexity. It is also validation: a large client is productising "ask other models".
- What Grill could learn: a council can show up inside a big client, and could appear in ChatGPT or Claude too. Grill's difference is a cross-provider judge across hosts, plus the decision record and look-backs. Keep the record and the look-back visible in the copy.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Triall

- Link: [triall.ai](https://triall.ai/) · [integrations](https://triall.ai/integrations)
- What they do: three frontier models answer blind, attack and rank each other, and check claims against live sources. You get the answer that survived, a verdict ("SURVIVES"), and the strongest challenge. It ships as a hosted MCP connector (`https://api.triall.ai/mcp`, OAuth) with setup for Claude.ai, ChatGPT and Claude Code, and has a REST API with `tr_live_` keys. The page showed a "temporarily offline" banner when seen.
- Threat or opportunity: threat, medium. The delivery shape matches Grill (in-chat MCP, a verdict plus the strongest challenge). It aims at fact-checking claims, not at committing to a decision.
- What Grill could learn: keep Grill's wording on the decision (the cheap test, the decision record, the look-back) so it does not read as a generic "verify this answer" tool. Their note that the host AI may rephrase the question before sending it applies to Grill too.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Reasoning Services (Devil's Advocate)

- Link: [install for Claude](https://reasoning.services/install/claude-ai/) · tracker: [agentdiscoverability.com](https://agentdiscoverability.com/track/claude/devils-advocate)
- What they do: a paid-only remote MCP (OAuth via DCR) with 8 tools: premortem, attack trees, challenge assumptions, 6 adversarial perspectives, and argument-structure analysis. It is one of about 10 reasoning connectors sold together. A third-party tracker shows it as a Community connector in Claude's directory since 2026-08-13, in "AI Strategy & Business Advisory Assistants", next to 45 or more others.
- Threat or opportunity: threat, low. There is no cross-company judge and no free tier. It is the closest category neighbour inside the Claude directory.
- What Grill could learn: the same tracker says Community connectors cannot currently be organically discovered in Claude, and only Verified ones can be suggested for a prompt. That is a third-party claim. It matches Anthropic's docs: Community is the default, and Verified is assigned automatically. Expect a Community listing to help with browse, search and credibility, not with automatic suggestions.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Deliberation

- Link: [github.com/antonbabenko/deliberation](https://github.com/antonbabenko/deliberation)
- What they do: an open-source second-opinion MCP server. Coding agents call GPT, Gemini, Grok or OpenRouter models for a review or a council. Dev-focused, bring-your-own-key, mostly local.
- Threat or opportunity: threat, low for Grill's ICP. These servers are for coders in Claude Code or Codex, not for people deciding in chat. A judge from a different vendor is becoming a common idea. That helps category awareness, and it is a content opening.
- What Grill could learn: "the judge must not be the model that answered" is becoming common sense among developers. Grill can use the same line for non-coders.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Amicus

- Link: [github.com/BourbonDog/amicus](https://github.com/BourbonDog/amicus)
- What they do: an open-source second-opinion MCP server in the same dev-focused group. It uses a non-Claude chair verdict with anonymised cross-review.
- Threat or opportunity: threat, low for Grill's ICP, same as the other coder-facing servers in this scan.
- What Grill could learn: a chair from a different vendor, with the panel anonymised, is the same decorrelation point. The plain line is still "the judge must not be the model that answered".
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## mcp-second-opinion

- Link: [github.com/aleksbuss/mcp-second-opinion](https://github.com/aleksbuss/mcp-second-opinion)
- What they do: an open-source second-opinion MCP server in the same dev-focused group. It scores disagreement with embeddings.
- Threat or opportunity: threat, low for Grill's ICP, same as the other coder-facing servers in this scan.
- What Grill could learn: disagreement can be shown without a panel of many models. Grill already shows one challenge. Do not add a score. Feedback on calls is never a score.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## LLMconcil

- Link: [glama.ai LLMconcil](https://glama.ai/mcp/servers/azeur365/LLMconcil)
- What they do: an open-source second-opinion server on Glama, in the same dev-focused group. It advises keeping the judge's vendor off the panel, and it reports blind spots.
- Threat or opportunity: threat, low for Grill's ICP. It is a new neighbour on Glama, not a product for Grill's in-chat decider.
- What Grill could learn: "keep the judge's vendor off the panel" is the same rule Grill already enforces, said in plain words.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## cc-reviewer

- Link: [github.com/SimonRen/cc-reviewer](https://github.com/SimonRen/cc-reviewer)
- What they do: an open-source second-opinion MCP server in the same dev-focused group. Coding agents call another model for review. The scan does not separate its features from that group.
- Threat or opportunity: threat, low for Grill's ICP, same as the other coder-facing servers in this scan. What Grill could learn: same as Deliberation. The spread of the idea is the useful part, not a feature list.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## PAL MCP Server

- Link: [X post, 2026-11-02](https://x.com/BIGMayrr/status/2117386710401122355)
- What they do: named in the same group of dev-focused second-opinion servers, and boosted on X on 2026-11-02. The scan did not record a separate product page.
- Threat or opportunity: threat, low for Grill's ICP, same as the other coder-facing servers in this scan. What Grill could learn: developers are talking about a different-vendor judge. That is a content opening.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## New dev second-opinion servers, November

- Link: [Bayze](https://dev.to/caijianxiong2007prog/bayze-a-local-first-mcp-server-for-cross-vendor-ai-model-review-draft-review-revise-209g) · [second-opinion-mcp 0.9.2](https://pypi.org/project/second-opinion-mcp/0.9.2/) · [2ndOpinion 0.2.0](https://pypi.org/project/2ndopinion/0.2.0/) · [Quorum Deliberate](https://nexevo.ai/quorum)
- What they do: four new dev second-opinion servers. Bayze is a local-first cross-vendor draft, review and revise MCP, posted 2026-11-05. second-opinion-mcp v0.9.2 calls DeepSeek, Kimi, OpenAI or OpenRouter for Claude, and has an anti-sycophancy "challenge" tool. 2ndOpinion v0.2.0 is a colony simulation MCP that offers a "second opinion for complex decisions". Quorum Deliberate, by Nexevo, has two AIs cross-check each other. It is an MCP plus a dual-pane workbench.
- Threat or opportunity: threat, low for Grill's ICP. These are coder or desktop tools, bring-your-own-key mostly.
- What Grill could learn: the "different vendor reviews it" idea keeps spreading among developers. Same content opening as Deliberation.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## TruthAgent

- Link: [truth.agnthub.ai](https://truth.agnthub.ai) · post, 2026-10-23: [x.com/TruthAgentAI](https://x.com/TruthAgentAI/status/2113681632528117918)
- What they do: a multi-model panel web app. "One AI answer is a guess. Multiple is a signal." A panel of models debates a question. You get consensus, conflicts and confidence. Templates cover investment, health, legal and news.
- Threat or opportunity: threat, low. Small account, separate app. The messaging is the useful part.
- What Grill could learn: their post says the second question you ask an AI is already shaped by its first confident answer, so you drift from "should we?" to "how do we?" without noticing. That anchoring story fits Grill's ICP. A content hook is to grill before the follow-up questions.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Satcove category post

- Link: [Best multi-model AI consensus platforms (2026)](https://satcove.com/blog/best-multi-model-ai-consensus-platforms-2026) (2026-10-26, written by Satcove)
- What they do: a vendor blog post, not a product Grill competes with directly. It splits the field into aggregators, consensus engines (Satcove, Council AI, Talkory) and adversarial or debate tools (Suprmind, Triall, Perplexity Model Council, useconsensus.ai, MultipleChat).
- Threat or opportunity: opportunity, low. Comparison posts like this are where AI search finds products, and Grill is not in any of them.
- What Grill could learn: Grill does not fit those buckets. It is one different-company challenger inside the chat you already use, plus a decision record. That is a positioning line to own. It is not a reason to pitch vendors' blogs.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Same-chat pre-mortem posts

- Link: [ManuSys_9, 2026-11-03](https://x.com/ManuSys_9/status/2117679971582046313) · [AISystems_hq, 2026-10-31](https://x.com/AISystems_hq/status/2116523841757606109) · [EthanBASP, 2026-10-27](https://x.com/EthanBASP/status/2115123556749365516)
- What they do: many accounts near Grill's ICP are posting "ask the AI for a pre-mortem / red team" prompts. Nearly all are same-model self-checks in the same chat. One example says to have a different model attack the idea first, because ChatGPT rarely disagrees inside the same chat.
- Threat or opportunity: opportunity, low to medium, as a content and reply angle. A pre-mortem in the same chat is the same model grading itself.
- What Grill could learn: the ICP already wants an adversarial check. The gap Grill fills is who does the check. Public replies have to follow the approved outreach rules.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Unnamed free Claude decision connector

- Link: [X post, 2026-11-06](https://x.com/aaxuus/status/2118810062634549477)
- What they do: a post on 2026-11-06 offers "a free claude connector for decisions… keeps track of where things stand and gives you a next move and why" as a second opinion. The product name and a product link were not found.
- Threat or opportunity: threat, low, unverified. Watch next scan.
- What Grill could learn: someone else is pitching "second opinion + tracking" in replies. That is the same shape as Grill's outreach.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## Claude Connectors Directory

- Link: [submission](https://claude.com/docs/connectors/building/submission) · [verification](https://claude.com/docs/connectors/verification) · [plugins, skills and connectors](https://support.claude.com/en/articles/17740565-manage-plugins-skills-and-connectors-from-one-plugins-page) · [build plugins](https://claude.com/resources/articles/build-plugins-for-claude) · changelog: [core-directive 20509](https://changelogs.core-directive.com/docs/change/20509)
- What they do: Anthropic's directory of connectors. The submission page was edited 2026-10-23 (two edits) and 2026-09-25. Submissions are scanned automatically and listed as a Community connector by default. Some also get a human review. Verified is assigned automatically to highly useful listings, with no application. Local MCPB bundles are no longer accepted. Put them in a plugin instead. Every tool needs a title and a readOnlyHint or destructiveHint. Any paid Claude plan can submit. The submission portal accepts a single remote MCP connector or a plugin bundle. It auto-validates and safety-scans on submit, shows review status, and the owner chooses when to publish. Customize is now Plugins: one page for plugins, skills and connectors, with Verified and Community labels. It reached general availability on 2026-11-09 for Free, Pro, Max, Ultra and Team. Enterprise is 2026-11-30. Claude Marketplace, opened 2026-09-23, lists 2,000+ connectors and plugins.
- Threat or opportunity: opportunity, medium. Unchanged. A pending submission should list as Community without waiting in a human queue. Community may not be suggested automatically in chats (see Reasoning Services). The listing mainly helps people who search or browse.
- What Grill could learn: check the portal status of Grill's submission. The listing's first line should say "different AI company judge", because browse and search is the channel. Grill's `.mcpb` can no longer go to the Claude directory. Only the hosted connector or a plugin can.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## ChatGPT and Codex plugin directory

- Link: [submission](https://developers.openai.com/plugins/deploy/submission) · [connecting MCP servers to ChatGPT](https://help.openai.com/en/articles/11487775-connecting-mcp-servers-to-chatgpt) · [release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) · [custom MCP apps](https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt) · [Codex Insider, 2026-11-11](https://codexinsider.ai/articles/openai-lets-plugins-live-in-the-chatgpt-sidebar-beside-the-chat-6b1c82/)
- What they do: OpenAI's plugin directory. The official submission page, checked 2026-11-11, is still a plugin ZIP upload. Review info now lives in plugin.json, under extensions.com.openai.review. The old submission form is gone. Test cases, a demo URL and release notes can live in the manifest. Automated checks run on upload. Review still needs exactly 5 positive and 3 negative test cases, a demo video URL, a reviewer login with no MFA, email codes or magic links, the four listing URLs (website, support, privacy, terms), a verified individual or business identity, and domain verification at `/.well-known/openai-apps-challenge`. OAuth supports a registered client, DCR or CIMD. MCP server changes go live without resubmitting. OpenAI also rescans the MCP server daily. Release notes from 2026-10-27 add interactive plugin panels. Release notes from 2026-11-10 say an MCP event can start a ChatGPT automation, in Work chats, on the web and on desktop. Custom MCP servers can be added from Plugins without Developer Mode, with a risk acknowledgement. Full write MCP is in beta for Business, Enterprise and Edu. The directory lists about 4,000 plugins, and the queues have lengthened. A DevDay plugins talk, reported secondhand by Codex Insider on 2026-11-11, says ChatGPT can suggest plugins mid-conversation from conversion, active usage and retention, and that a plugin can have a sidebar home or a side panel. Those ranking signals are not on OpenAI's docs page.
- Threat or opportunity: opportunity, now high. Mid-chat suggestion ranked on retention is the discovery path the ICP would actually see. The queue is getting longer, so submitting earlier matters.
- What Grill could learn: put the 8 test cases and the demo URL into plugin.json. The remaining human blockers are OpenAI identity verification and the reviewer account's OAuth seeding. Seeding needs a real browser, and Tony's OK on a new OAuth client. The mid-chat ranking claim is a secondhand report of a talk.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## Official MCP Registry

- Link: [releases](https://github.com/modelcontextprotocol/registry/releases) · [1.8.7 note](https://7it.co.il/7maps/news/2026-10-31-mcp-registry-1-8-7-prepared-listing-reads/) · live search: [registry search for grill](https://registry.modelcontextprotocol.io/v0/servers?search=grill)
- What they do: the official MCP registry. October releases added server-name search indexing (1.8.3), a minimum of 3 characters for searches (1.8.6), and prepared listing reads, off by default (1.8.7, 2026-10-30). No rule changes for publishers. Checked live on 2026-11-04: `io.github.mtangoz/grill` is active but still v0.1.0, with only the stdio `.mcpb` package and no `remotes` entry for `https://grillyour.ai/mcp`. Its description says "A second opinion from an unrelated AI model…". Downstream directories (PulseMCP, mcp.so and others) read this, so they only see the bring-your-own-key local version.
- Threat or opportunity: opportunity, low to medium. A small `server.json` update adding a streamable-http remote for `https://grillyour.ai/mcp`, and a version bump, would show the free hosted path downstream. The scan says that needs a repo change and `mcp-publisher publish` as mtangoz, as a normal growth task.
- What Grill could learn: directories that copy the official registry only see the local package until that entry changes. PulseMCP says it will ingest from the registry when submissions reopen.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Smithery

- Link: [smithery.ai/future](https://www.smithery.ai/future) · [smithery.ai](https://www.smithery.ai/)
- What they do: on 2026-10-31 Smithery shut down its MCP proxy, run.tools and server.smithery.ai URLs, API, Connect, Toolbox, accounts, API keys and CLI and SDKs. It stays a public, non-proxied directory powered by Arcade, with a curated set of verified servers that show their direct MCP URLs. Grill's listing, live since 2026-09-29, now returns 404 at `https://smithery.ai/servers/hold-systems/grill`.
- Threat or opportunity: threat, low. It was a minor channel. README still mentions Smithery (around line 121), and `/workspace/grill-growth/snapshot.py` still polls `registry.smithery.ai`, so that metric is dead and will read as zero or an error.
- What Grill could learn: a directory that sits in the middle can disappear. Listings that point straight at `grillyour.ai/mcp` (the official registry, Claude, ChatGPT) last longer.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## PulseMCP

- Link: [pulsemcp.com/submit](https://www.pulsemcp.com/submit)
- What they do: a directory. New submissions and listing edits are paused. The page was last updated 2026-09-03. They say to publish to the official MCP Registry, which they will ingest when they reopen.
- Threat or opportunity: neutral. Another reason to publish the registry entry. What Grill could learn: nothing new to build. Publish the registry entry, then wait.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Glama

- Link: [glama.ai/mcp/servers/mtangoz/grill](https://glama.ai/mcp/servers/mtangoz/grill)
- What they do: a directory. Grill's page returned 200 and was still live on 2026-11-04. Nothing else changed that the scan could verify. LLMconcil is a new second-opinion neighbour there.
- Threat or opportunity: neutral this week. What Grill could learn: leave the listing as it is. The page is still up.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## mcp.so

- Link: none confirmed in this scan. The scan did not re-check the site. Grill is not listed, per the directory tracker, and a draft exists outside this repo.
- What they do: a directory. A search summary claimed mcp.so reviews listings before publishing. The scan did not confirm that on mcp.so itself.
- Threat or opportunity: neutral. Nothing verified this week, so the review-before-publish claim stays unchecked.
- What Grill could learn: open the site before treating that claim as fact.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Gemini connected apps

- Link: [Gemini custom apps help](https://support.google.com/gemini/answer/17209137?co=GENIE.Platform%3DDesktop&hl=en) · [Connected Apps blog](https://blog.google/innovation-and-ai/technology/developers-tools/connected-apps-one-place/) · [9to5Google, 2026-10-28](https://9to5google.com/2026/10/28/gemini-google-connected-apps-platform/) · [developers.google.com/connected-apps](https://developers.google.com/connected-apps) · [Connected Apps MCP](https://developers.google.com/connected-apps/mcp)
- What they do: Gemini on the web supports custom apps by MCP URL: Settings, Connected Apps, Add a custom app. DCR is supported, with manual credentials under Advanced. Requirements: US, 18 or older, a personal account, English, Keep Activity on. Once connected, the app works on mobile too, and you can type `@` to target it. On 2026-10-28 Google launched a Connected Apps Platform preview (Google Connected Console). It is one place to register, test and submit MCP apps for Gemini and Google Search, opening to developers in phases. Platform docs updated 2026-10-28 and 2026-10-30 describe the path: register, domain verification, Gemini Developer Mode testing, then review. You choose Search, the Gemini app, or both. Access still opens in phases, through a preview sign-up. A listing needs one global Streamable HTTP endpoint. `grillyour.ai/mcp` fits.
- Threat or opportunity: opportunity, medium, later. Unchanged. The roadmap trigger is unchanged. Copy and paste into Gemini works today. Adding Grill as a connector inside Gemini is not verified. A listed Gemini or Search app would be a third directory. The platform is a preview with a waitlist.
- What Grill could learn: the "testing now" line is already settled. Joining the platform preview is a sign-up under a Hold Systems address, so it is Tony's call.
- Date seen: 2026-11-11. Last updated: 2026-11-11.

## Perplexity custom connectors

- Link: [adding custom remote connectors](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors) · [agent API connectors](https://docs.perplexity.ai/docs/agent-api/tools/connectors)
- What they do: Plugins, Add custom, Connector, Remote: an HTTPS MCP URL with OAuth or an API key, over Streamable HTTP or SSE. Org-wide connectors need an admin. The scan could not confirm when this shipped.
- Threat or opportunity: opportunity, low. A Perplexity line could go on the connect page once someone tests it. Perplexity's own Model Council competes inside that client.
- What Grill could learn: do not add the line until a test exists, or until a user asks.
- Date seen: 2026-11-04. Last updated: 2026-11-04.

## Meta AI connectors

- Link: [Meta AI help](https://www.meta.com/help/artificial-intelligence/1066348732357744/) · [dev.meta.ai connectors](https://dev.meta.ai/products/connectors)
- What they do: users connect apps in Settings, then Apps. Developer "Meta AI Connectors" (REST or MCP, plus OAuth) is a limited developer preview. Muse has its own connector directory and custom connectors. Grill's site already says Meta AI is coming.
- Threat or opportunity: opportunity, low. It is a waitlist, and Meta's apps are not where this ICP decides.
- What Grill could learn: nothing to build this week. Leave the "coming" line until there is a real connector to test.
- Date seen: 2026-11-04. Last updated: 2026-11-04.
