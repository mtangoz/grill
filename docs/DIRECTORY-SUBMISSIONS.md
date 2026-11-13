# Directory submissions: the kit

What to file with the Claude Connectors Directory and the ChatGPT plugin directory, and with the MCP Registry. Nothing here has been submitted. Filing is the owner's job, and so is every item in the owner checklist at the end.

**Submit the hosted connector, not the plugin.** The connector at `https://grillyour.ai/mcp` is the version both directories can list: it needs no key, and it is the code this kit's test cases run against. The Claude directory no longer accepts a local `.mcpb`. The installed tool you can download today is release 0.1.1 from 29 September 2026, which asks for your OK before it sends and differs from what this kit describes (see "The installed tool" on [grillyour.ai/data-flow](https://grillyour.ai/data-flow/)).

The directory requirements below come from scan notes in [ROADMAP.md](ROADMAP.md) and [COMPETITORS.md](COMPETITORS.md), dated 2026-11-04 and 2026-11-11, and some of them are secondhand. Read both directories' current policy pages on the day you file.

## Listing copy

Every sentence that names a company keeps the condition, because on some routes Grill cannot tell which AI wrote the plan.

- **Name:** Grill
- **One line:** Hear the strongest case against your plan from an outside AI judge, then decide for yourself.
- **Description:** Say "grill this" about a decision, plan or forecast. Grill sends it to an outside AI judge that did not write it. The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. When it cannot, the verdict says so. A short verdict comes back in the chat, with the sharpest challenge and one cheap test. You decide. Grill never acts on a verdict. If you say yes, Grill keeps a record of what you chose so you can look back later. Whether an outside judge catches more than the same model starting fresh has not been measured yet. Not legal, financial, medical or tax advice.
- **Category:** productivity, or decision support where the directory has it.
- **Website:** https://grillyour.ai/
- **Privacy policy:** https://grillyour.ai/privacy/
- **Terms:** https://grillyour.ai/terms/
- **Support:** https://grillyour.ai/support/ and support@grillyour.ai
- **Setup page:** https://grillyour.ai/start/
- **Where your decision goes:** https://grillyour.ai/data-flow/
- **Icon:** https://grillyour.ai/brand/icon-512.png (also in `server.json`)

Do not add an accuracy claim for the judge, and do not promise when the listing will be live.

## Test cases

Five prompts that should call a Grill tool and three that should not are in [directory/test-cases.json](directory/test-cases.json), with the tool, its arguments and the text the reply should carry. `scripts/submissions.test.mjs` checks each tool and argument against the hosted tool list and each expected text against the code, so the file cannot drift from the product.

| Prompt | Tool | What the reviewer sees |
|---|---|---|
| Grill this: we're raising the price 20% next month. I expect churn to stay under 4%, and I'm 70% sure. | `grill` | On a new account, the records question with one paragraph under it. After the answer, `grill` with `keep_records`, then the verdict, the closing line and the two-line run note. |
| more | `grill_result` with `detail` `more` | The next challenge and its cheap test. |
| I'll do it, with a two-week pilot first. | `grill_decided` with `decided` | A reply that starts "Saved." |
| Look back: churn came in at 6%. | `grill_look_back` with `happened` | "Saved with your decision record." on the one due decision. |
| That grill helped. | `grill_feedback` with `rating` `helped` | What Grill keeps for a reaction, for 180 days. |
| How long should I grill a ribeye on each side? | none | No Grill tool call. |
| Summarise this article in three bullet points. | none | No Grill tool call. |
| Translate "good morning" into French. | none | No Grill tool call. |

Notes for the reviewer:
- A reviewer on an app Grill does not recognise sees a line that starts "Independence not verified:" at the end of every verdict, and the first-use line leaves out "from a different company". That is the product saying it could not tell which company's model wrote the decision.
- The look-back case needs an account that already holds one saved decision that is due. The records question shows only on an account that has not answered it.

## Data handling

Each answer below is quoted word for word from [grillyour.ai/data-flow](https://grillyour.ai/data-flow/). `scripts/submissions.test.mjs` builds the site and fails if any answer is no longer on that page. If the page changes, change the answer here to the page's new words.

**What does the connector receive?**
> Your assistant sends the decision in a Grill tool call. Grill tells it to send the decision as you stated it, with at most a few sentences of context, and not to wait for a second OK. Grill accepts up to 200,000 characters and does not check that the assistant kept to a few sentences.

**Is personal information masked?**
> Grill's server gets your decision as your assistant sent it, not masked. Masking is applied to the copy sent on to the model router

> What Grill keeps is not masked.

**What is kept on every grill?**
> Every grill that gets a verdict, records on or off, leaves an encrypted copy of the full decision and the short verdict for 15 minutes, so that a reaction can include it. Grill's operators hold the key.

**What is kept if the person keeps records?**
> Grill saves a draft when the verdict comes back, before you say what you chose.

> It is deleted after 14 days if you never state a choice, or when you turn records off or press Delete all. When you state a choice, it becomes your decision record, which stays until you delete it. Records and drafts are encrypted, and Grill's operators could open them.

**How is consent asked?**
> Grill tells your assistant to ask you once before keeping records. Grill's server does not check that it asked. It acts on the yes or no the assistant sends.

**What is kept either way?**
> Your account, with your email address. The time, cost and judge model of your last 400 grills.

**Does Grill send email?**
> It is on unless you turn it off. It goes on a Monday when your account saved a decision that week or a look-back came due. It is sent through Resend.

> To write it, a job opens kept records each Monday.

> Sending is set to stop after 25 January 2027.

**Who else sees the decision?**
> The model router. It gets the masked decision and your question, on a key Grill holds for your account in chat, or on your own key for the installed tool. On every judge request Grill asks it to use only zero-retention endpoints and not to collect the data.

> Whichever company's model the router picks. It sees the masked decision and your question, under that same request.

> The quality check. It sees the masked decision, your question, the verdict and the top five challenges, with no zero-retention flag on that request.

> It runs sign-in with an emailed code, and keeps your email and the sign-in events.

> It stores what Grill keeps. Records, drafts, the 15-minute copy and reactions are encrypted before they reach it. Your account, with your email address, and the counts are not.

> It hosts this site and Grill's server. Its request log sees each address asked for, including a /judge link with a decision in it.

**Which company judges?**
> The judge is from a different company than the one that wrote the plan, when Grill can tell which that is.

> In Cursor, or in an app Grill does not recognise, nobody is ruled out, and the verdict ends with a line that starts "Independence not verified:"

**Can a person delete what is kept?**
> Deleting your account removes your records, drafts, reactions, account and that list of grills. It does not lower any count, and your account ID stays in the Monday email lists until they expire.

## Reviewer sign-in

ChatGPT's reviewer account cannot use an email code, and Grill's sign-in is an emailed code only. The owner picks one of these before filing:

- **A. One password account.** Turn on password sign-in in Clerk for one reviewer user. Then the privacy page, [PRIVACY.md](PRIVACY.md), the sign-in row of [DATA-LEDGER.md](DATA-LEDGER.md) and [HOSTED.md](HOSTED.md) must say that one password account exists for store reviewers, and `scripts/signInWording.test.mjs` changes with them.
- **B. A pre-authorised client.** Sign the reviewer's OAuth client in once in a real browser, so no code is needed at review time. No copy changes. This needs a new OAuth client.

Either way, the reviewer's address goes on `GRILL_INTERNAL_EMAILS` before they sign in, so they are not counted as an outside person. The account should hold one made-up saved decision that is already due, for the look-back case, and should not have answered the records question yet. Nothing in this repository writes that account: the owner sets it up by hand.

## MCP Registry

1. Check `server.json`: version, the `.mcpb` link and its `fileSha256` against the release asset, and the remote `https://grillyour.ai/mcp`.
2. Its description, "A second opinion on your decisions, from a different AI company.", names a company with no condition. Change it to the conditional form in the same release, before you publish.
3. Publish as `mtangoz` with `mcp-publisher publish`, after release 0.2.0 if that release changes the package.

## Before filing

Run these and see them pass:

```bash
node --test scripts/platformPolicy.test.mjs scripts/toolCopy.test.mjs scripts/submissions.test.mjs
node scripts/check-sign-in.mjs
node scripts/mcpSignInLive.mjs
```

## Owner checklist

- [ ] Read both directories' policy pages on the day, and correct this file where they changed.
- [ ] Choose the reviewer sign-in route above and set it up.
- [ ] Add the reviewer's address to `GRILL_INTERNAL_EMAILS`, and seed the account with one made-up due decision.
- [ ] Raise the monthly service cap for the review window.
- [ ] Record the demo video.
- [ ] OpenAI identity verification, and a paid Claude plan for Anthropic's portal.
- [ ] Known review risk, the scope guard. The hosted grill description tells the assistant: "After a grill, don't start doing the decision (no code changes, no PRs, no product questions) unless the person separately asks." A reviewer can read that as a tool steering how the assistant uses other tools. Keep it, reword it, or cut it before filing.
- [ ] Known review risk, the no-additions line. The same description says: "Do not add a fact list, a confidence question, or a record. Do not add a disclaimer to Grill's text." Decide whether it stays.
- [ ] Decide whether the installed tool should stay marked read-only. Some apps run a read-only tool without asking first, and it sends the decision out.
- [ ] Fix the `server.json` description before the registry publish.
- [ ] File. Nothing in this repository files for you.
