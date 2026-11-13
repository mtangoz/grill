# What constitutes a durable moat for small AI application-layer products ("wrappers") as models improve (as of November 2026)

Note on source quality (applies throughout): research was done 13 Nov 2026 by web search plus a handful of full-page reads. Items marked **[read in full]** were fetched and read. Items marked **[search snippet]** come from search-result summaries of the linked page and were not opened; treat numbers there as approximate and re-verify before quoting. Private-company ARR figures are unaudited run-rates, mostly from secondary trackers. Where a link is the most likely origin of a snippet-level claim but I could not confirm the exact page, it is marked **[link uncertain]**.

---

## 1. Frameworks: what do Helmer, the VC essays, the "bitter lesson", Altman and YC recurrently conclude?

### Takeaway
The recurring conclusion across 2024-2026 writing is one test and one sequencing rule. The test: "if the model gets dramatically better tomorrow, is your product worth more or less?" The sequencing rule: early on there is no moat, only speed and counter-positioning; durability has to be layered on later from accumulated customer context/data, embedding in a workflow or system of record, compliance, brand/trust and distribution. Anything that exists only to patch a current model weakness is expected to be absorbed.

### Cited Findings

**Altman / OpenAI**
- Altman (20VC with Harry Stebbings, 2024) framed two strategies: assume the model will not improve and "build all these little things on top of it", or build assuming it keeps improving. He said companies on the first path get "steamrolled" and (per summaries) that 95% of the world should bet on the second. Wording comes from secondary write-ups, not a transcript I verified. **[search snippet]** — [The Decoder](https://the-decoder.com/sam-altman-explains-why-openai-might-steamroll-your-ai-startup/)
- Altman's positive recommendation in the same interviews was vertical applications (tutors, lawyers, doctors, CAD engineers): "build companies that get better as the models get better" (summary wording). **[search snippet]** — [20VC summary](https://www.recall.it/summary/ai/sam-altman-what-startups-will-be-steamrolled-by-openai-and-where-is-opportunity-or-e1223)
- A 2026 Startup School talk is summarised as "build the workflow, not the workaround, since the workaround gets solved for you". Single secondary source; unverified. **[search snippet]** — [The AI Corner](https://www.the-ai-corner.com/p/sam-altman-startup-school-2026)
- Dissent from a founder (Aug 2024): a Fortune op-ed by a startup CEO argued the "steamroll" warning does not apply to companies with their own customer relationship and domain depth. **[search snippet]** — [Fortune](https://fortune.com/2024/08/13/sam-altman-openai-will-steamroll-ai-startups-i-run-one-not-worried/)

**SignalFire, "Moats are for castles" (Ryan Wexler, 4 May 2026) [read in full]** — [SignalFire](https://signalfire.com/blog/why-ai-startups-should-optimize-for-permanence-not-moats)
- Thesis: moats are premature and often illusory before Series A; ask instead "Will this layer of the stack still exist in 10 years?" Defensibility is "tested over time", not designed.
- Model-improvement test: "Does your product become more valuable or less?" if models jump.
- Roadmap audit: list every feature that exists only because current models are weak at something; if that is the main selling point you are "building on a fault line".
- Durable per the essay: core infrastructure; developer primitives for evaluation, observability and reliability; truly hyper-differentiated data. Fragile: thin UI-on-a-prompt wrappers, one-off narrow copilots, prompt abstractions with no system underneath, anything that depends on a current model limitation.
- Quotes: "a weak moat in a permanent layer today is better than a strong moat in a disappearing one." / "If you own the process and the data, a better model is just a better engine for your car."
- The essay names no companies and cites no metrics; it is opinion.

**NFX, "How AI Companies Will Build Real Defensibility" (Pete Flint, July 2025) [read in full]** — [NFX](https://nfx.com/post/ai-defensibility)
- Motte-and-bailey model: a fast "bailey" (speed, distribution) that you expect to abandon, and a fortified "motte" (network effects, embedding, brand) built behind it. "You need multiple short-term and long-term defensibility strategies."
- "Speed to scale is your primary lever" early; early-stage companies have "very few defensibilities at all".
- Data is an early edge "with clear limitations"; real-time data differentiates. Brand is "paramount" because products look alike and users worry about hallucination and privacy.
- Embedding example: EvenUp (demand letters for personal-injury lawyers).
- AI-era network effects named: per-user model improvement, "personal utility networks built through AI memory", team-context memory (Cursor), agent networks (LangChain, MCP).
- Cautionary case: Groupon — "What looked like a network effect was actually just virality disguised"; it "never gave them reasons to stay".

**Team8, "What If There Never Was a Moat?" (Nitay Joffe, 28 Apr 2026) [read in full]** — [Team8](https://team8.vc/what-if-there-never-was-a-moat/)
- Dissent/reframe: "there are no permanent moats... only time-bound temporary advantages"; "moat = time. Not permanent safety."
- Time estimates given (author's opinion, not data): model leads last 3-12 months; a distribution head start 2-3 years; new "siege engines" arrive in 6-24 months.
- "It's better to cannibalize your own moat before someone else does." Cursor is the example: forked VS Code, reached "billions in ARR", then shipped an agent-management console (Cursor 3) and trained its own Composer models when the labs moved up the stack.

**Stanford-hosted paper, "Defensible Moats for Vertical AI Application Companies in a New Competitive Landscape" (Jay Mandal and Aparna Sinha, June 2026) [read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- Ranks five product moats, weakest to strongest: (A) workflows and UX — low; (B) vertical harness and custom tools/integrations — medium; (C) built-in compliance — medium-high; (D) "the Brain", a data-driven operating system combining curated public data with the customer's private history — high; (E) embedded expert judgment learned from observed practitioner decisions — highest.
- On workflows: valuable but "with concerted investment, these skills can be replicated by competitors"; buyers run vendor bake-offs (Decagon vs Sierra).
- On compliance: it means "solving for the determinism that foundation models lack, and offering explainability, auditability"; "once a firm wires compliance into its supervision and recordkeeping stack, switching means re-validating from scratch."
- On the Brain: "each customer's accumulated context in the product compounds, raising switching costs the longer the system is used."
- Operational moats (distribution, engineering reliability, token efficiency) "cannot stand on [their] own" but compound product moats.
- Summary line: "As foundation model capability rises, the value of any single workflow, tool, or product shipped in isolation tends to fall... What does not fall is the value of the system."
- The labs do enter verticals: the paper reports Anthropic released legal plugins in February 2026 and a "Claude for Legal" product in May 2026 with MCP connections to 20+ platforms, and that OpenAI announced a legal vertical product in June 2026. (Claims as stated in the paper; I did not verify them against primary announcements.)

**Helmer's 7 Powers applied to AI**
- Counter-positioning is defined as a newcomer adopting a superior model the incumbent will not copy because it would damage its existing business. The common AI example is per-outcome pricing against per-seat SaaS. Commentary notes it "fades once an incumbent adopts the model". A summary of a Helmer podcast says early startups should start with counter-positioning, then add scale economies, switching costs and network economies. **[search snippet]**; these are blog commentaries, not Helmer's own text — [Thomas Bustos, "7 Powers Revisited"](https://thomasbustos.substack.com/p/the-7-powers-framework-revisited); [Elliot C. Smith, "AI and Helmer's 7 Powers"](https://www.elliotcsmith.com/ai-seven-powers/)
- Crunchbase News applied the 7 Powers to 576 AI B2B companies that raised $50M+ rounds since 2025; I could not retrieve the results. **[search snippet]** — [Crunchbase News](https://news.crunchbase.com/?p=94066)

**a16z and others on workflow / system of record**
- A summary of an a16z discussion says AI lowers the barrier to building software, and defensibility comes from "owning the end workflow, becoming the system of record, network effects, and deep customer embedding." Secondhand. **[search snippet]** — [a16z summary](https://rosetta.to/u/a16z/why-ai-moats-still-matter-and-how-they-ve-changed)
- A January 2026 essay argues "system of record is dead" is overblown, citing migration difficulty (migration scripts for even a simple POS took "months to years"). **[search snippet]** — [Software Moats in the AI Age](https://fpso.substack.com/p/software-moats-in-the-ai-age)
- Insight Partners names workflow depth and proprietary data as the two main vertical-AI moat categories. **[search snippet]** — [Insight Partners](https://www.insightpartners.com/?p=25778)

**YC**
- YC partner Diana Hu is quoted: "the only moat that startups have at the beginning is really just speed"; depth comes after you have built something people want. **[search snippet]** — [Execution is the moat](https://aspiringforintelligence.substack.com/p/execution-is-the-moat)

**The bitter lesson**
- Rich Sutton's 2019 essay argues that general methods leveraging computation eventually beat hand-engineered domain knowledge. The product-level analogue used in the essays above is that hand-built scaffolding around model weaknesses is what the next model deletes. (Cited from background knowledge; not re-fetched this session.) — [Sutton, "The Bitter Lesson"](http://www.incompleteideas.net/IncIdeas/BitterLesson.html)

### Inferences
- The frameworks converge on a two-column sort of any product's features: column 1 is "compensates for something the model cannot yet do" (prompt craft, chunking, output formatting, reliability hacks); column 2 is "something a better model cannot produce by being smarter" (the customer's own history, a position in a workflow, a legal/compliance status, a relationship, a structural incentive). Only column 2 survives.
- Almost all of the cited frameworks are written by venture investors about venture-scale vertical B2B companies. They are opinion with illustrative examples, not empirical studies. Their applicability to a tiny, free, horizontal consumer/prosumer tool is by analogy.
- For a small product the honest reading of Helmer is that the only power available at the start is counter-positioning; the question is which second power it can convert into before the counter-position is copied or made irrelevant.

### Gaps
- I did not retrieve primary Sequoia, Bessemer or Benchmark essays, nor Helmer's own writing on AI; the a16z position is secondhand.
- No primary interviews with Kevin Weil, Mike Krieger, Dario Amodei, Aravind Srinivas or Michael Truell on defensibility were retrieved.
- The exact Altman wording and the "95%" figure were not checked against a transcript.
- I found no specific Anthropic guidance on which startups get steamrolled.

---

## 2. Which moat types have evidence behind them? Who thrived, who got squeezed, and why

### Takeaway
The strongest evidence is for (a) accumulated customer context/proprietary data, (b) embedding in a regulated or legacy workflow, (c) distribution into a professional community, and (d) owning a distinct modality or model. Pure "better prompt plus nicer UI" businesses that sold to price-sensitive individuals were squeezed quickly once ChatGPT was good enough. Even the biggest winner (Cursor) remained exposed to its model suppliers and responded by integrating down (own models) and up (agent management).

### Cited Findings

**Thrived**
- **Cursor (Anysphere).** Reported ARR ladder: about $100M (Jan 2025), $1B (Nov 2025), $2B (Feb 2026); later figures of $3-4B by mid-2026 conflict across trackers. $2.3B Series D at $29.3B post-money in Nov 2025; talks at ~$50B reported April 2026; a ~$60B SpaceX/xAI transaction is reported, with sources conflicting on whether it closed. **[search snippet]** — [The Next Web, 18 Apr 2026](https://thenextweb.com/news/cursor-anysphere-2-billion-funding-50-billion-valuation-ai-coding); [Team8](https://team8.vc/what-if-there-never-was-a-moat/)
- **Cursor's exposure.** Secondary reporting says Cursor ran negative gross margins on individual plans (positive on business plans) because heavy users' Anthropic bills exceeded the $20 subscription, and that Cursor's own analysis estimated Anthropic's $200/month Claude Code plan could consume $2,000-$5,000 of compute. Cursor's usage-based price increases reportedly pushed some customers to Claude Code; Cursor shipped its own Composer 2 model priced well below frontier models. Figures derive from one internal analysis relayed through press; treat as estimates. **[search snippet] [link uncertain for margin claim]** — [The Decoder](https://the-decoder.com/anthropics-claude-code-subscription-may-consume-up-to-5000-in-compute-per-month-while-charging-the-user-just-200/); [The Next Web](https://thenextweb.com/news/cursor-price-hikes-claude-code-harness-shift); [UC Strategies](https://ucstrategies.com/news/cursor-hit-2b-revenue-while-developers-quietly-switched-to-cheaper-rivals/)
- **Harvey (legal).** Valued at $11B (March 2026). The Stanford paper attributes its position to a legal-specific harness: a LexisNexis alliance for citation-validated case law, and write-back integrations to iManage, NetDocuments, SharePoint and Word "with full versioning, metadata, and audit trails". The paper says "the moat in legal AI is not the model", and calls the harness "a solid medium moat... that a well-funded rival can match over time." **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf). Harvey ARR is estimated at about $300M (Sacra, May 2026). **[search snippet]** — [Sacra](https://sacra.com/research/openevidence-vs-doximity/)
- **Legora (legal).** Reportedly crossed $100M ARR at a ~$5.6B valuation (April 2026) on the same integration playbook. **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- **Jump (wealth-management note-taker).** Reached ~27,000 advisors (about 1 in 10 US advisors) in under two years; raised $105M. The paper's reading: "note-taking is the wedge; compliance (and vertical integrations) are the moats" — SEC/FINRA recordkeeping, audit trails, per-firm supervisory configuration that horizontal note-takers will not take on, which supports a price premium. **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- **Decagon (support agents).** At Chime: 1M+ calls/month, 70%+ chat resolution, 60% support-cost reduction (company-reported). The paper classes encoded customer SOPs as the lowest moat because Sierra "runs the same playbook". **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- **OpenEvidence (clinical search, free to doctors).** $250M Series D at $12B (Jan 2026); a $15B valuation and ~$300M revenue are listed for later in 2026 by Sacra and one other source (not cross-confirmed; an earlier "120x ARR" description implies a much lower base). Commentary credits distribution: a doctor can adopt it alone, without a hospital procurement cycle. **[search snippet]** — [Sacra](https://sacra.com/c/openevidence/); [Pulse 2.0](https://pulse2.com/openevidence-250-million-series-d-12-billion-valuation)
- **Abridge (clinical documentation).** ARR estimates range from ~$100-117M to ~$500M across sources — unreliable. Its route is the opposite of OpenEvidence's: security review, EHR integration and system-wide contracts before revenue, which is slow to win and slow to lose. **[search snippet]** — [Rock Health](https://rockhealth.com/rock-weekly/ai-moves-pretty-fast/)
- **Granola (meeting notes).** $125M Series C at $1.5B (25 Mar 2026), up from $250M ten months earlier; revenue reported as 2.5x year-on-year with no dollar figure. See section 3 for its moat thesis. **[search snippet]** — [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- **ElevenLabs (voice; own models).** Company said it ended 2025 at $350M ARR and passed $500M in early 2026; $11B round in Feb 2026. **[search snippet]** — [Futurum](https://futurumgroup.com/?p=89522)
- **Perplexity.** FT estimate of $450M+ ARR (March 2026); ~$20B valuation. **[search snippet]** — [Seeking Alpha citing FT](https://seekingalpha.com/news/4573154)
- **Midjourney (own model, community distribution, bootstrapped).** Never raised outside capital; 2024 revenue put at ~$300M by PitchBook via Forbes; higher 2026 figures are unverified. **[search snippet] [link uncertain]** — [NewMarketPitch](https://newmarketpitch.com/blogs/news/ai-infrastructure-growing-without-burning-billions)
- **Vanta (compliance automation).** Crossed $300M ARR in April 2026 (company announcement; tripled in two years per Fortune), 16,000+ customers, $4.15B valuation (July 2025). Fortune ties recent growth to "shadow AI" governance demand. **[search snippet]** — [Fortune, 29 Apr 2026](https://fortune.com/2026/04/29/exclusive-vanta-arr-300-million-sequoia-shadow-ai-claude-cursor/); [Vanta](https://vanta.com/resources/vanta-crosses-300m-in-arr-as-growth-accelerates)

**Squeezed**
- **Jasper.** Valued at $1.5B in 2022; cut its internal valuation ~20% (to ~$1.2B) as growth slowed, replaced its CEO and laid off staff in 2023. Revenue estimates: ~$120M peak in 2023, falling to somewhere between $35M and $55M in 2024 (sources conflict). Sacra's reading: small-business customers replaced $50/month Jasper/Copy.ai subscriptions with free or $20/month ChatGPT. Jasper survived by moving to enterprise marketing (reported 900+ enterprise customers). **[search snippet]** — [Maginative](https://www.maginative.com/article/jasper-cuts-internal-valuation-as-ai-growth-slows/); [Sacra](https://sacra.com/research/copy-ai-jasper-ai-writing-tools)
- **Chegg.** Q1 2025: subscribers down 31% to 3.2M, revenue down 30% to $121M. Q1 2026: revenue down 48% year-on-year to $63.3M. Layoffs of 22% (May 2025) then 45% (Oct 2025). The company blamed "the new realities of AI and reduced traffic from Google to content publishers" and is pivoting to B2B skilling. **[search snippet]** — [Fox Business](https://www.foxbusiness.com/technology/chegg-lay-off-45-workforce-ai-google-traffic-shifts-batter-business); [Fortune, 28 Oct 2025](https://fortune.com/2025/10/28/chegg-layoffs-ceo-dan-rosensweig-poster-child-ai-slashing-staff-shares/)
- **Character.AI.** In August 2024 Google took a non-exclusive licence to its model technology and hired co-founders Noam Shazeer and Daniel De Freitas; investors were reportedly bought out at a $2.5B valuation. High engagement did not translate into an independent, defensible business. **[search snippet]** — [Bloomberg, 2 Aug 2024](https://www.bloomberg.com/news/articles/2024-08-02/character-ai-co-founders-hired-by-google-in-licensing-deal)

### Inferences
- Evidence by moat type:
  - **Proprietary/longitudinal customer data and context:** strongly asserted (Stanford "Brain", Granola, NFX) but the examples offered are early (Accordance: $13M raised, 50+ CPA teams). The argument is logical rather than yet proven at scale.
  - **Workflow embedding / write-back into systems of record:** well evidenced (Harvey, Legora, Jump, Abridge), but rated only "medium" because a funded rival can replicate integrations.
  - **Compliance/regulatory position:** evidenced by Jump's price premium and Vanta's scale; this is the clearest case where model improvement does not remove the need, because the need is auditability and determinism, not intelligence.
  - **Distribution into a professional community:** OpenEvidence and Cursor both grew by individual bottom-up adoption; it is fast but, in Cursor's case, did not prevent supplier squeeze.
  - **Own model / own modality:** ElevenLabs, Midjourney, and Cursor's later Composer models — not available to a small wrapper.
  - **Brand/trust:** asserted as "paramount" by NFX; hard to isolate in data.
  - **Network effects:** few clean examples in AI apps; NFX's Groupon warning applies.
- The squeezed cases share three features: the buyer was an individual or small business paying out of pocket; the value was the model's raw output; and the general assistant was free or cheaper. The survivors among them moved up to enterprise workflow (Jasper) or to a different business (Chegg).
- Being the model vendor's customer and competitor at once (Cursor) is a structural weakness that even $2B+ of ARR did not remove.

### Gaps
- No reliable numbers were found for Glean, Copy.ai (including any acquisition) or the Grammarly/Superhuman rebrand; those searches returned nothing usable.
- Abridge and OpenEvidence ARR figures conflict too widely to quote a single number.
- No controlled evidence isolates which moat caused which outcome; all attributions are analysts' interpretations.

---

## 3. Cautionary tales 2023-2026 and what distinguished survivors

### Takeaway
The pattern is consistent: products whose value was a prompt, a retrieval trick or a UI convenience were absorbed by the base assistants or stranded by platform decisions, and building on a platform's "store" gave developers neither revenue nor stability. Survivors treated the commoditised function as a wedge and moved the value to something the platform does not hold: the customer's accumulated context, a compliance record, or an enterprise workflow.

### Cited Findings
- **ChatGPT plugins (2023-2024).** Thousands of plugins were built after the March 2023 launch (including Expedia, Instacart, Kayak); OpenAI phased them out in favour of GPTs, angering developers. **[search snippet]** — [Gizmodo](https://gizmodo.com/openai-pissed-off-developers-by-phasing-out-plugins-for-1851124124)
- **GPT Store.** Altman promised to "pay people who build the most useful and the most-used GPTs a portion of our revenue"; in practice revenue sharing was limited to a small invite-only US pilot, with developer complaints about weak discovery, no analytics and no way to charge. Most creators who earned anything did so off-platform (affiliate links, third-party networks). **[search snippet]** — [The Fall of GPTs](https://genaiassembling.substack.com/p/the-fall-of-gpts); [OpenAI community thread, "99% of GPTs lack moats"](https://community.openai.com/t/99-of-gpts-lack-moats-thoughts-on-the-gpts-store/500209/3)
- **Custom GPT retirement (2026).** A 28 Sep 2026 report says OpenAI is preparing to retire Custom GPTs and move those workflows to a new plugin architecture spanning ChatGPT and Codex, with builders objecting. One further snippet (unverified) says personal accounts could no longer create or publish Custom GPTs from 16 Aug 2026. **[search snippet]** — [Virtualization Review](https://virtualizationreview.com/articles/2026/09/28/openai-to-retire-custom-gpts-replace-them-with-plugins.aspx); [OpenAI community thread](https://community.openai.com/t/openai-s-custom-gpt-plugin-migration-raises-access-concerns/1399984)
- **AI copywriting (Jasper, Copy.ai).** See section 2: revenue "going flat/into decline as customers replaced their $50/month subscriptions... with free and $20/mo premium" ChatGPT. **[search snippet]** — [Sacra](https://sacra.com/research/copy-ai-jasper-ai-writing-tools)
- **Homework help (Chegg).** See section 2. — [Fox Business](https://www.foxbusiness.com/technology/chegg-lay-off-45-workforce-ai-google-traffic-shifts-batter-business)
- **Meeting notes.** Granola's own founder calls the category "a commoditized, oversaturated space"; every tool (Read AI, Fireflies, Otter, Quill) transcribes accurately. Granola's stated answer is that the moat is not capture but making what was said available to other AI systems — a "context infrastructure layer" with a personal API and an enterprise API. **[search snippet]** — [The Next Web, 25 Mar 2026](https://thenextweb.com/news/granola-series-c-meeting-ai-enterprise-context); [TechCrunch](https://techcrunch.com/2026/03/25/granola-raises-125m-hits-1-5b-valuation-as-it-expands-from-meeting-notetaker-to-enterprise-ai-app/)
- **Same wedge, different moat.** Jump sells essentially the same recording function to financial advisors but wraps it in examinable compliance records, and commands a premium over horizontal recorders. **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- **Labs moving up the stack.** Anthropic's Claude Code and OpenAI's coding agents pushed directly into Cursor's market; Anthropic and OpenAI entered legal in 2026 (per Stanford paper). One secondary estimate puts Claude Code's run-rate at roughly five times Cursor's by Feb 2026 — unverified. **[search snippet]** — [Team8](https://team8.vc/what-if-there-never-was-a-moat/); [The Next Web](https://thenextweb.com/news/cursor-price-hikes-claude-code-harness-shift)
- **Disintermediation is the specific threat to workflow moats:** incumbents that already own the user's surface add the feature natively. **[search snippet]** — [The workflow is the moat](https://www.antoinebuteau.com/the-workflow-is-the-moat.md)

### Inferences
- Platform extension points (plugins, GPTs, and by extension connectors and skills) have a track record of being re-architected or retired on the platform's schedule: plugins in 2024, Custom GPTs in 2026. A product that exists only as an extension inside one assistant inherits that risk. Presence on several assistants, plus a direct relationship with the user (account, email, own site), is the obvious hedge.
- The survivors' common move is "the commodity function is the wedge; the record is the product." Granola (notes to context layer), Jump (notes to compliance record) and Jasper (copy to enterprise brand workflow) all follow it.
- What is commoditised is production of an artefact at a moment in time. What is not is the accumulated, structured history of many such moments belonging to one customer, especially when joined to what happened afterwards.

### Gaps
- I found no reliable data on PDF-chat wrappers or prompt marketplaces specifically (failure rates, named shutdowns); these remain anecdote.
- The 2026 Custom GPT retirement should be confirmed against OpenAI's own announcement.
- No quantitative study of GPT Store developer earnings was found.

---

## 4. Counter-positioning and neutrality as a moat

### Takeaway
Independence from the thing being judged is a real and long-lived basis for a business, and it is one a platform structurally cannot offer about itself. But the historical record shows neutrality is durable only when the funding model does not depend on the judged party; it is routinely corroded by issuer-pays revenue, ancillary services, affiliate income and investor ties. How the neutral party is paid matters more than its stated policy.

### Cited Findings
- **Credit rating agencies.** They receive most revenue from the issuers they rate. Ratings that were "overly optimistic" at issue contributed to destabilising the financial system in the 2008 crisis. An empirical study (Indian data) found agencies that earn non-rating revenue from an issuer give that issuer better ratings, and those issuers have higher default rates — "most consistent with a conflict of interest interpretation". **[search snippet]** — [CEPR/VoxEU](https://cepr.org/voxeu/columns/possible-bias-ratings-when-rating-agencies-perform-consulting-services)
- **Counter-view:** a Progressive Policy Institute paper argues issuer-pays still produces "a stronger and less biased signal" than the alternatives. **[search snippet]** — [PPI](https://www.progressivepolicy.org/credit-rating-agencies-sending-a-clear-signal/)
- **Consumer Reports.** A 501(c)(3) that takes no advertising ("never accepted a single advertising dollar"), is funded mainly by members plus grants and donations, and buys every product it tests. Its weakness is commercial, not ethical: most paying members are 55+, and renewal is the pressure point. **[search snippet]** — [Nonprofit Quarterly](https://nonprofitquarterly.org/consumer-reports-a-nonprofit-icon-with-business-model-questions/); [What's New in Publishing](https://whatsnewinpublishing.substack.com/p/consumer-reports-membership-model)
- **Wirecutter.** Funded by affiliate commissions with a claimed firewall (editors pick first; the commerce team adds links afterwards). Critics (FAIR) point to the overwhelming share of links going to Amazon; others argue some trust "is always going to be eroded by the presence of affiliate links." Wirecutter is diversifying away from search-driven affiliate income as AI changes discovery. **[search snippet]** — [FAIR via ZNetwork](https://znetwork.org/znetarticle/pushing-consumers-to-amazon-is-baked-in-to-nyts-business-model/?amp=1); [Digiday](https://digiday.com/media/inside-wirecutters-push-to-diversify-beyond-affiliate-revenue-as-ai-reshapes-discovery/)
- **LMArena.** Spun out of a Berkeley research project; raised ~$100M at a reported $600M valuation (May 2025) and $150M at $1.7B (Jan 2026). An April 2025 study ("The Leaderboard Illusion") alleged its practices let large labs test many private variants and so advantaged them; co-founder Ion Stoica called the study full of "inaccuracies". Coverage notes that companies whose models are ranked are among its funders; LMArena says no money buys placement. Its revenue model was unsettled at launch, with charging providers for evaluations under consideration. **[search snippet]** — [TechCrunch, 30 Apr 2025](https://techcrunch.com/2025/04/30/study-accuses-lm-arena-of-helping-top-ai-labs-game-its-benchmark); [SiliconANGLE, 21 May 2025](https://siliconangle.com/2025/05/21/lmarena-raises-100m-600m-valuation-expand-ai-benchmarking-platform/); [The Next Web, 7 Jan 2026](https://thenextweb.com/news/lmarena-raises-150m-in-series-a-round)
- **Artificial Analysis.** Free public comparison pages plus paid enterprise benchmarking-insight subscriptions; I found no major independence controversy. **[search snippet]** — [tech-insider (low-quality source)](https://tech-insider.org/llm-leaderboard-lmarena-vs-artificial-analysis-2026/)
- **METR.** A 501(c)(3) that says it has so far chosen not to accept payment or donations from frontier AI companies (and bars lab-staff-directed donations); reported ~$71M in grants over the six months to August 2026. It has no authority to compel labs, and says it "has proved challenging to ensure that we have adequate independence" under the voluntary regime. Its independence was still questioned over shared major donors with Anthropic and staff rotating between evaluators and labs. **[search snippet]** — [METR About](https://metr.org/about); [METR funding update, 14 Aug 2026](https://metr.org/blog/2026-08-14-funding-update/); [OfficeChai](https://officechai.com/ai/metrs-independence-questioned-after-x-user-highlights-financial-links-between-company-and-anthropic/)
- **Vanta.** Shows the commercial ceiling of "trust as a product": $300M ARR by April 2026, selling evidence of compliance to third parties. **[search snippet]** — [Fortune](https://fortune.com/2026/04/29/exclusive-vanta-arr-300-million-sequoia-shadow-ai-claude-cursor/)

### Inferences
- A model vendor can ship a "second opinion" feature, but it cannot credibly ship a second opinion that is independent of itself, and it has a commercial disincentive to route its users' questions to a competitor's model. That is counter-positioning in Helmer's strict sense: the incumbent could copy the feature only by damaging its own economics or positioning. It weakens if assistants become routinely multi-model, or if a platform decides multi-vendor checking is a selling point.
- Corruption follows the money in each precedent: issuer-pays (rating agencies), affiliate links (Wirecutter), funding from the ranked (LMArena), shared donors and revolving staff (METR). The cleanest model in the set is Consumer Reports': paid by the person relying on the verdict, buys its own inputs, takes nothing from the judged. Its weakness is growth, not integrity.
- For a neutral tool the practical design rules implied are: charge the user, not the judged; take no referral or placement money from model vendors; make the selection rule public and mechanical; publish the method and, where possible, the code; and publish a track record (how often verdicts turned out right) so that trust rests on evidence rather than assertion.
- Neutrality's value scales with the stakes and with the perceived conflict of the alternative. It is worth little for low-stakes questions where a same-vendor check is "good enough".
- A track record is the asset that turns neutrality from a claim into a moat: an auditor or ratings body with decades of scored outcomes cannot be replicated by a new entrant with a better model.

### Gaps
- I found no direct evidence on whether end users of AI assistants actually value cross-vendor independence enough to pay for it; this is the key untested assumption.
- No data on independent security-review or audit firms' economics was retrieved.
- Artificial Analysis's funding and any conflicts were not established.
- The rating-agency evidence comes from one summarised study plus general description; the wider literature was not reviewed.

---

## 5. Moats for tiny / solo / open-source products

### Takeaway
A permissive (MIT) licence is not itself a moat — it deliberately gives away the code — but it buys trust and distribution, and the defensible parts then have to sit outside the code: the hosted service, the accumulated data, the brand and the user relationship. Open-source history shows the main risks are a bigger host out-operating you and the trust damage from later relicensing; it also shows that hosted convenience only holds while you remain the best operator.

### Cited Findings
- **Elastic.** Changed its licence in 2021 to stop AWS reselling Elasticsearch; AWS forked it as OpenSearch, which grew; Elastic returned to open source (AGPLv3) in 2024 — described as "an extremely rare example of a company reversing a license restriction after realizing the commercial damage exceeded the protection value." **[search snippet]** — [The New Stack](https://thenewstack.io/forks-clouds-and-the-new-economics-of-open-source-licensing/); [InfoWorld](https://www.infoworld.com/article/3499400/elastics-return-to-open-source.html/amp/)
- **Redis.** Promised BSD "always", relicensed in 2024; the Valkey fork, backed by major clouds, reached 25,000+ GitHub stars and nearly 50 contributing companies within a year. **[search snippet]** — [Logz.io](https://logz.io/blog/foss-in-flux-redis-relicensing-and-the-future-of-open-source)
- Pre-fork code always remains available under the original licence, so a permissive licence protects users more than the vendor and does not stop a cloud competing on hosting. **[search snippet]** — [The New Stack](https://thenewstack.io/why-open-source-forking-is-a-hot-button-issue/)
- Relicensing history has made developers wary of any venture-backed open-source company. **[search snippet]** — [OpenApps, "License Wars"](https://openapps.pro/blog/license-wars-how-fauxpen-source-killed-developer-trust)
- "Shared source won't fix the AWS problem": it may be possible to run a better service than the cloud does "at least in the short term" — i.e. the hosted moat is operational, not legal. **[search snippet]** — [InfoWorld](https://www.infoworld.com/article/3604335/shared-source-wont-fix-the-aws-problem.html)
- Open-source projects need an explicit plan to convert free users to paying ones; popularity alone does not sustain them. **[search snippet]** — [The New Stack](https://thenewstack.io/forks-clouds-and-the-new-economics-of-open-source-licensing/)
- Open source is also arriving as a competitor inside vertical AI: the MikeOSS legal project "aims to replicate the functionality of Harvey and Legora at a fraction of the price". **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- Midjourney shows a small, bootstrapped team can reach hundreds of millions in revenue without outside capital — but with its own model and community, not as a wrapper. **[search snippet] [link uncertain]** — [NewMarketPitch](https://newmarketpitch.com/blogs/news/ai-infrastructure-growing-without-burning-billions)
- SignalFire's point applies with more force to tiny products: before scale, moats are "premature, and often illusory"; choose a layer that will still exist. **[read in full]** — [SignalFire](https://signalfire.com/blog/why-ai-startups-should-optimize-for-permanence-not-moats)

### Inferences
- For an MIT-licensed tool, openness and neutrality reinforce each other: published code and a published selection rule are verifiable evidence for an independence claim that a closed competitor can only assert. That is a trust asset, not a barrier to copying.
- What cannot be forked: the hosted service's accumulated per-user records, any aggregate outcome dataset, the name and reputation, the installed base across assistants, and the operator's speed. A sound open-core split keeps the mechanism open and puts paid value in the hosted, stateful parts.
- The honest answer to "can a free MIT tool have a moat?" is: not in the code, and not at all until there are users. With almost no users, the only assets are counter-position and speed; the moat question is really "what compounds per user once they arrive?"
- Being tiny has one real advantage: a solo product can profitably serve a niche that is too small or too awkward (routing users to a rival's model) for a platform to bother with. Its matching weakness is that anything it proves valuable is cheap for others to copy.

### Gaps
- I found no documented case of a privacy-preserving (opt-in, aggregated or on-device) data network effect working commercially in an AI app; this remains a design idea without precedent in the sources reviewed.
- No evidence was retrieved on open-core conversion rates or on solo-developer MCP-tool businesses.
- No data on whether "trust through openness" measurably increases adoption or willingness to pay.

---

## 6. Memory / personal context versus platform-native memory

### Takeaway
By 2026 every major assistant has native memory and the vendors have started importing each other's memory, so "we remember your stuff" is no longer a third-party advantage. What platforms have not provided is a shared standard, a living (not snapshot) cross-assistant record, or structured records with outcomes attached; a third-party record survives only if it is one of those things — structured, portable across assistants, user-owned, and holding data the chat log does not (what was decided, what was predicted, what actually happened).

### Cited Findings
- Anthropic launched a memory-import tool for Claude in early March 2026 (run a prompt in ChatGPT/Gemini, paste the result into Claude); Google followed in late March 2026 with Import Memory for Gemini. Sources conflict on whether it was free-tier at launch. **[search snippet]** — [Engineer's Codex](https://www.engineerscodex.com/claude-import-memory-from-providers); [Beri.net](https://www.beri.net/article/gemini-claude-data-portability-war)
- Critics note these imports are one-time snapshots of a memory summary, not the living profile or the full conversations. **[search snippet]** — [Calmara](https://calmara.app/blog/migrate-chatgpt-memory-before-it-rewrites-itself)
- No shared protocol: none of OpenAI, Anthropic or Google has proposed one, "because it would erase the lock-in each company's memory creates" (commentator's view). **[search snippet]** — [Tecnobits](https://tecnobits.com/en/memory-lock-in-en-ia-que-es-por-que-importa-y-como-evitarlo)
- A developer who tested seven AI memory products for portability reported that all seven lock the user in. Single self-published test. **[search snippet]** — [DEV Community](https://dev.to/stantyan/i-tested-7-ai-memory-products-for-portability-all-7-lock-you-in-31pm)
- Third-party "neutral memory layer" vendors argue for a user-owned interchange format; this is advocacy from interested parties. **[search snippet]** — [MemX blog](https://memx.app/blog/ai-memory-wars-who-owns-your-memory/)
- NFX lists "personal utility networks built through AI memory" as an emerging network effect — a reason platforms invest in it. **[read in full]** — [NFX](https://nfx.com/post/ai-defensibility)
- Granola's bet is the positive precedent: value lies in exposing a user's accumulated record to other AI systems via personal and enterprise APIs, not in capture. **[search snippet]** — [The Next Web](https://thenextweb.com/news/granola-series-c-meeting-ai-enterprise-context)
- The Stanford paper's "Brain" moat rests on the same mechanism: accumulated customer context "compounds, raising switching costs the longer the system is used." **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)

### Inferences
- Platform memory is unstructured recall optimised for the platform's own retention. It does not, by default, produce a dated record of a specific commitment, the confidence attached, the test proposed, and the later outcome. A purpose-built record of that kind is a different object from "memory" and is not made redundant by the assistant remembering the conversation.
- The mere existence of vendor import tools shows memory is a contested lock-in asset; users who use more than one assistant are the natural market for a record that sits outside all of them.
- The risk is real in the other direction: if an assistant adds native "decision log with follow-up reminders", a generic third-party version loses. The defensible remainder is cross-assistant portability, user ownership/export, and the independence of whoever scores the outcome.
- Outcome data (did the prediction come true?) is the one category that only accrues with time and follow-through; a competitor starting later cannot backfill it for a given user. That makes longitudinal look-back records the most moat-like component of any decision tool — conditional on users actually returning to record outcomes, which is the hard part.

### Gaps
- Not verified against official OpenAI/Anthropic/Google documentation; current feature sets and tiers may differ.
- No usage data on how many people use multiple assistants, or on demand for cross-assistant memory.
- No evidence on retention or completion rates for look-back/outcome-recording features in any product; decision-journal follow-through is an untested behavioural assumption.

---

## 7. The agentic shift: does demand for independent checks grow?

### Takeaway
Yes at the enterprise level, with money behind it: analysts and investors treat oversight of agents as a growing category, and the regulated-industry evidence points the same way. But the same data shows standalone guardrail products being absorbed into broader platforms, and almost all the demand evidenced is enterprise governance — not individual-level "check my decision" tools.

### Cited Findings
- **Gartner (11 June 2025):** "guardian agent" technologies — agents that oversee other agents, including "reviewers" that check AI output for accuracy and compliance — will account for at least 10-15% of agentic AI markets by 2030. Avivah Litan: agentic AI "will lead to unwanted outcomes if it is not controlled with the right guardrails." — [Gartner press release](https://www.gartner.com/en/newsroom/press-releases/2025-06-11-gartner-predicts-that-guardian-agents-will-capture-10-15-percent-of-the-agentic-ai-market-by-2030)
- A February 2026 Gartner Market Guide for Guardian Agents, as excerpted on a vendor page, cites a $3B+ guardian-agent market by 2030 at 46% CAGR and says no major provider (Microsoft, Google, AWS) offers a complete solution. Vendor-hosted excerpt; not verified on Gartner's site. **[search snippet]** — [AgilePoint](https://www.agilepoint.com/market-guide-for-guardian-agents)
- Gartner published a 2026 Market Guide for AI Evaluation and Observability Platforms (category recognition). **[search snippet]** — [Openlayer](https://www.openlayer.com/blog/openlayer-raises-usd4-8m-seed-round-to-build-guardrails-for-ai)
- **Funding:** Braintrust raised an $80M Series B (17 Feb 2026) to be "the observability layer for AI". — [SiliconANGLE](https://siliconangle.com/2026/02/17/braintrust-breaks-80m-series-b-funding-round-become-observability-layer-ai/). Fiddler raised a $30M Series C (Jan 2026; ~$100M total) for an AI "control plane" in regulated industries. — [BGV](https://benhamouglobalventures.com/fiddler-raises-30m-series-c/). Arize positioned for first-mover advantage in AI observability (Feb 2025). — [TechCrunch](https://techcrunch.com/2025/02/20/arize-ai-hopes-it-has-first-mover-advantage-in-ai-observability/)
- A deal tracker lists Geordie ($30M Series A, 1 June 2026, agent governance and runtime monitoring), Portkey ($15M Series A, governance/control plane) and CodeIntegrity ($5M seed, agent guardrails). The same tracker says core category leaders raised about $490M combined with a median of ~$11M, and that **standalone guardrail companies had no qualifying pure-play deal in its 2026 year-to-date data — guardrails are being absorbed into broader platforms.** Aggregator of uneven quality. **[search snippet]** — [NewMarketPitch](https://newmarketpitch.com/blogs/news/ai-safety-funding-news); [NewMarketPitch trends](https://newmarketpitch.com/blogs/news/ai-safety-funding-trends)
- **Regulatory pull:** FINRA's 2026 oversight report "explicitly pivots from AI 'guidance' to accountability, demanding firms document how AI systems are supervised" (as characterised by the Stanford paper). **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- **Adjacent demand:** Vanta's growth to $300M ARR is attributed in part to "shadow AI" proliferating across companies. **[search snippet]** — [Fortune](https://fortune.com/2026/04/29/exclusive-vanta-arr-300-million-sequoia-shadow-ai-claude-cursor/)
- **Human judgment still required:** the Stanford paper notes humans still need to define what problems to address in open-ended work, while flagging that this may erode as agents improve. **[read in full]** — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- SignalFire lists "developer primitives for evaluation, observability, and reliability" among the layers it expects to persist. **[read in full]** — [SignalFire](https://signalfire.com/blog/why-ai-startups-should-optimize-for-permanence-not-moats)
- **Dissenting note:** ITPro's coverage of Gartner frames the answer to agent risk as "just adding more AI agents" — scepticism that AI-checks-AI is a solution rather than a new failure mode. **[search snippet]** — [ITPro](https://www.itpro.com/technology/artificial-intelligence/enterprises-are-worried-about-agentic-ai-security-risks-gartner-says-the-answer-is-just-adding-more-ai-agents)

### Inferences
- More autonomous action means more decisions taken without a human reading each one, which raises the value of a cheap, independent check at the points where a human (or agent) commits to something costly. This is one of the few product needs that grows rather than shrinks as models improve: a better model makes a better judge, and more agent activity makes more things to judge.
- A check that is callable by agents (through a protocol such as MCP) as well as by people is positioned on the growing side of this shift; a check that only works as a human chat ritual is not.
- The absorption finding is the main warning: a guardrail that is merely a feature gets bundled into platforms and observability suites. The independent-check products that persist in other industries (audit, ratings) do so because a third party requires the independence, not because the check is technically hard.
- Evidence of demand is for enterprise governance bought by risk and compliance teams. There is no evidence in these sources of a paying consumer/prosumer market for independent decision checks; that demand is unproven.
- Regulated settings turn a check into a record that must be kept. A dated, attributable, exportable record of "what was checked, by which independent model, with what result" is more likely to become required than the check itself.

### Gaps
- No credible, primary market-size figure for AI evaluation/guardrails/governance was found; the $3B/46% CAGR figure is from a vendor-hosted excerpt.
- No data on spending for human-in-the-loop approval tooling specifically.
- No evidence on whether agents in production actually call third-party "second opinion" services, or on pricing for such calls.
- Funding totals come from an inconsistent aggregator and should not be quoted as authoritative.

---

## 8. Dissent: "there are no moats, only speed"

### Takeaway
A substantial camp argues early AI companies have no moat except execution speed; the rebuttal, also well represented, is that speed is a head start that decays within months and matters only if it is converted into something that compounds. The two views mostly agree once time horizon is specified.

### Cited Findings
- "The ONLY moat for startups is execution. The traditional 'moats'... (technical, regulatory, distribution) are collapsing." **[search snippet]** — [Execution is the moat](https://aspiringforintelligence.substack.com/p/execution-is-the-moat)
- YC's Diana Hu: "the only moat that startups have at the beginning is really just speed." **[search snippet]** — [same source](https://aspiringforintelligence.substack.com/p/execution-is-the-moat)
- Team8: "there are no permanent moats"; "moat = time"; advantages last 3-12 months (model), 2-3 years (distribution). **[read in full]** — [Team8](https://team8.vc/what-if-there-never-was-a-moat/)
- Rebuttal: "You can't build a moat with speed alone" — most early companies have no moat and speed does not create one; beware "velocity masquerading as progress". **[search snippet]** — [Slow Ventures](https://snailmail.slow.co/p/you-can-t-build-a-moat-with-speed-alone)
- Rebuttal: Groq's speed lead was matched as providers optimised inference; "if speed is your only advantage, you're one infrastructure upgrade away from irrelevance." **[search snippet] [link uncertain]** — [Has AI killed product moats](https://mtfrobby.substack.com/p/has-ai-killed-product-moats)
- Pessimist view: pure-software AI startups have no durable moats; Cursor has "excellent execution, fast iteration, and a window" before labs and open source close the gap. **[search snippet]** — [DEV Community](https://dev.to/kc_nair_7a436f84f18dad97a/why-pure-software-ai-startups-are-structurally-doomed-4d7c)
- NFX synthesis: speed is "your primary lever" early and is itself a short-term defensibility, but must give way to durable moats; Groupon is what happens when "the short-term strategy eclipsed the long-term." **[read in full]** — [NFX](https://nfx.com/post/ai-defensibility)
- Vertical-integration view: the only true defensibility is owning more of the stack. **[search snippet]** — [VC Cafe](https://www.vccafe.com/why-vertical-integration-is-the-only-true-defensibility-in-ai/)
- "Disposable apps": when anyone can clone a product in hours, value moves away from the software itself. **[search snippet]** — [HackerNoon](https://sia.hackernoon.com/disposable-apps-are-here-where-does-the-value-go-when-anyone-can-clone-your-product)

### Inferences
- The "no moats" camp is describing year one; the "moats" camp is describing year five. Both imply the same instruction: use the early window to accumulate whatever cannot be regenerated by a competitor with a better model and a weekend — users' own history, a scored track record, a reputation, a position in a workflow.
- For a product with almost no users, the dissenters are simply correct today: there is nothing yet to defend. The strategic choice is which compounding asset the product is built to accumulate from its first real users, since code and prompts are now the cheapest things to copy.
- "Speed" for a solo product is less about shipping features than about being first to a credible track record and a recognised name in a narrow niche.

### Gaps
- All of this is opinion; I found no empirical study comparing survival of AI startups by claimed moat type (the Crunchbase 576-company analysis may be one, but its findings were not retrieved).

---

## 9. Extracted principles: building so that model improvement helps rather than kills

### Takeaway
Synthesising the above: build so that the model is a replaceable, improving component; put the durable value in what accumulates per user and in a structural position a platform will not take; keep the user relationship off any single platform; and fund independence from the people who rely on it.

### Cited Findings
(Each principle below is an inference; the supporting sources are those cited in the sections named.)
- The model-improvement test and roadmap audit — [SignalFire](https://signalfire.com/blog/why-ai-startups-should-optimize-for-permanence-not-moats)
- "The value of any single workflow, tool, or product shipped in isolation tends to fall... What does not fall is the value of the system." — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2026/06/Defensible-Moats-for-Vertical-AI-Application-Companies-in-a-New-Competitive-Landscape.pdf)
- Layer short-term and long-term defensibility; do not let the short-term eclipse the long-term — [NFX](https://nfx.com/post/ai-defensibility)
- "Cannibalize your own moat before someone else does." — [Team8](https://team8.vc/what-if-there-never-was-a-moat/)

### Inferences
1. **Make the model a swappable engine.** If a better model drops in and the product gets better with no rework, improvement is a tailwind. Products that route to "the best available model" benefit automatically; products that encode fixes for one model's weaknesses do not. (Sections 1, 3)
2. **Run the roadmap audit.** Mark every feature that exists only because today's models are weak. Expect those to be deleted by the next release and do not make them the selling point. (Section 1)
3. **Treat the commodity output as a wedge and the accumulated record as the product.** Granola, Jump and the Stanford "Brain" all locate value in per-customer history that compounds. A one-off answer is commoditised; a longitudinal record with outcomes attached is not. (Sections 2, 3, 6)
4. **Prefer data only time can produce.** Outcome and follow-up data cannot be backfilled by a later entrant. It is also the only way to turn a trust claim into a track record. (Sections 4, 6)
5. **Occupy a position the platform structurally will not.** Independence from the model vendor is true counter-positioning; protect it by taking money only from the users who rely on it, and by making the rule public and mechanical. (Section 4)
6. **Do not live inside one platform's extension point.** Plugins were retired in 2024 and Custom GPTs are being retired in 2026. Be present on several assistants and hold a direct user relationship. (Section 3)
7. **Sell the record where a third party requires it.** Compliance and auditability are the clearest cases where smarter models do not remove demand. A check that leaves an exportable, attributable record is closer to this than a check that leaves only a chat message. (Sections 2, 7)
8. **Be callable by agents, not just people.** The growth in demand for checks is in agent workflows. (Section 7)
9. **Open the mechanism, keep the state.** Under a permissive licence the code is not the moat; hosted state, aggregate data, brand and operations are. Never relicense — the trust cost is documented. (Section 5)
10. **Expect the moat to be temporary and plan the next one.** Use each advantage to buy time to build the next; a weak moat in a permanent layer beats a strong one in a disappearing layer. (Sections 1, 8)
11. **Accept that none of this exists without users.** Every moat above is a function of accumulated usage. With almost no users the binding constraint is adoption, not defensibility. (Sections 5, 8)

### Gaps
- These principles are synthesised from investor essays and a small set of case studies of mostly venture-scale B2B companies. There is no direct precedent in the sources for a free, solo, MIT-licensed, horizontal decision-checking tool; applicability is by analogy and should be presented as such.
- The two assumptions that most need direct testing, and for which I found no evidence either way: (a) that individuals value cross-vendor independence enough to adopt or pay, and (b) that users will return to record outcomes so that a longitudinal record actually forms.
