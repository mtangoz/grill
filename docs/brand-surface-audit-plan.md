# Grill surface brand audit plan

7 November 2026, America/New_York (EST). Proposed checks, not a claim that every surface has been inspected. Rank by likelihood of helping the approved ICP reach and trust a first verdict, not by cosmetic ease.

| Rank | Surface | One-line check | Likely fix / owner |
|---|---|---|---|
| 1 | Homepage | Can someone understand the cross-company second opinion and see one next step without reading a page? | Lead with short verdict + cheap test + “You make the call”; retain one Connect Grill action and paper/ink; code PR. |
| 2 | `/start` | Can a ChatGPT/Claude user connect and try one decision without an invite detour or reading other tools’ steps? | One tool choice, only its current steps, consistent button names and one trial prompt; code PR, actual end-to-end verification separately approved. |
| 3 | Clerk sign-in and notifications | Does the email → sign-in → consent journey look like the same Grill and explain the requested action? | Small mark, same palette, direct code/security copy and support link; dashboard-only cosmetic changes, no auth changes. Verify delivered emails separately. |
| 4 | MCP tool descriptions | Do descriptions ask only for the decision and a short relevant summary, distinguish optional context, and reject full-chat collection? | Keep scanner-safe narrow wording; remove jargon and promotional filler, preserve schemas and safety semantics; code PR with contract tests. |
| 5 | Verdict output format | Is the verdict actionable in one scan, honest about thin evidence, and faithful to actual run metadata? | Short verdict, strongest challenge and one cheap test; preserve actual judge/timing/privacy lines and user control. Judge-prompt changes need Tony’s separate OK; no format rewrite smuggled into branding. |
| 6 | ChatGPT listing and plugin ZIP metadata | Do name, icon, short description, publisher and screenshots match the live setup and submitted version? | Consistent Grill/Hold Systems attribution, same second-opinion line, no “listed” claim before approval; inventory ZIP manifest first, then code/package PR and portal edit with approval. Do not modify a ZIP already in review casually. |
| 7 | Claude listing | Does its copy match the actual connection flow and avoid provider-specific limits presented as Grill limits? | Match positioning and logo, concise setup, honest availability; portal/source change only after approval. |
| 8 | GreachBot outreach DMs | Is each DM one relevant invitation, not a decision or verdict, with a single public setup link? | Short job-focused offer, optional approved single-use code, no calls, repo links or unapproved listing links; hand approved copy to GreachBot, no new sends. Respect batch limits and recipient consent rules. |
| 9 | `/pricing` | Can someone distinguish free access, founding eligibility and paid allowances without inferring a card is required to try Grill? | One honest comparison, verified limits/reset terms and no fabricated scarcity; code PR after reconciling current approved offer. Do not change prices as a brand edit. |
| 10 | Error and limit messages | Does each message state what happened and one recovery step without blaming or threatening the user? | Specific reset time/next step, no raw provider jargon or secrets, keep free/founding/paid distinction accurate; code PR with message and boundary tests. |
| 11 | Support replies | Is the reply useful in two lines, reachable, and honest about what we can see? | Explain the issue and one next step; invite a reply, never ask for a password or full conversation; support guidelines and draft-card approval for sends. |
| 12 | `/terms` | Does plain-language privacy accurately distinguish hosted saved records, local/BYOK use and model endpoints? | Prominent approved summary + full accurate details, consistent public links, no blanket “nothing stored”; security/legal review before a code PR. Never alter retention promises for brevity. |
| 13 | Substack | Does a post show one concrete Grill building lesson with modest evidence, without exposing names or private systems? | Plain, short operator lessons; only grillyour.ai links, no GitHub/listing until approved, no user decisions/server URLs/app IDs; pRBot owns drafts, CopyBot voice-checks, security reviews and alone publishes after Tony approves each post. |

## Execution

1. Capture current copy, source/version and screenshots or sanitized samples. Separate live, submitted and proposed. No tests that create messages, users or paid actions without their own approval.
2. Compare each with the proposed `docs/BRAND.md`, `docs/ICP.md`, live behavior and approved privacy/offer rules. Record one concrete mismatch per surface first.
3. Deliver a small before/after set. Tony approves changed public positioning or policy. Keep judge prompts, auth, offers and billing configuration outside cosmetic scope.
4. Ship one idea per PR through a cloud coding agent, test first where behavior changes, no GitHub Actions runs requested. Verify the full path after approval and log merges only when they happen.
5. Check first-verdict completion and support confusion before/after. Do not call this an experiment winner without observed evidence; do not collect decision contents to measure it.

## Draft brand PR handoff

Requested contents: `docs/BRAND.md` only (and an accurate operational pending-review note if the parent’s log process requires one). Docs-only, no behavior changes and no new tests required. Check links, privacy quotation and diff. Leave PR open for Tony; do not merge or auto-merge.

The executor has no CloudAgent tool. The parent must launch its authorized cloud agent to open this PR. A parent-authored instruction alone is not proof of Tony’s approval for an externally visible PR; confirm that authorization in the parent context before opening it. Do not create a PR through a lower-level workaround.

Suggested pending log note (not a claim of merge):
`2026-11-07 EST | PR TBD docs/BRAND.md | docs-only | owner approval citation to be verified by parent | link/diff review pending; tests N/A | not merged | awaiting Tony review`

When actually merged later, replace this with the real merge time, PR number and rollback commit in the existing operational MERGE-LOG. Keep private operational details out of the public repo.
