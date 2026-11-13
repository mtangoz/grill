# How the pages are built

Each page has one job. `/decisions` shows whether a grill changed the call, then gets a due look-back done. `/account` shows who you are, what Grill holds, and how to leave. A section earns its place by helping that job.

The order on a page is: what needs you now, how your judgement is doing, your records, then the small ways to leave. Settings do not sit above the thing the page is for. Danger sits behind a confirm page.

The pages run no JavaScript. A disclosure is a `<details>` element. A confirm is its own page.

## What needs you now

On `/decisions` the first thing, once a decision is saved, is whether a grill changed the call: "N of M grills changed the call", or "No grill is marked as changing a call yet." A Yes on the record, an after mark, or a supersedes line counts. A verdict of "doesn't hold up" is its own row and counts only after Yes. A No tap is stored and does not appear in that summary. A saved challenge kind for a source, a fact, or a figure shows as flagged, and a flag is not proof. Under the headline, one short line names only the counts that are not zero: "N unknown (impact not confirmed)", "N called out (not a confirmed change)", and "N flagged (not proof)". With no saved decision, that block is absent. The due list follows, when there is one: "N decisions due for a look-back". Each row links to the decision. The decision page shows the full text, what you chose, the verdict, an optional Yes or No for whether the grill changed the call, and the same three taps: Held up, Didn't, Mixed. A tap before the look-back date is an early read and can be changed. On that date it becomes the outcome. A later tap overwrites it and keeps the date it was changed. An early read does not count toward how often the verdict held up until the date. A one-line note is optional. A ship, a price, a near forecast, a weekly bet, or a hire with a date gets one optional line after the verdict, and only when records are on. A quick take, a burst, a check, and a one-off life choice do not. With three or more decisions in view, that same impact block has one quieter line under the short count: how many decisions, the percent looked back, and, once three have been looked back, how often the verdict held up. That line is not repeated under the due list. With fewer than three, that line is absent and one sentence says a look-back is due 14 days after the choice. Type and source chips sit in one row. A filter with only one value is hidden. The list is grouped Due, then Open, then Closed. A row is two lines: the whole decision title, then what you chose, the verdict, and the outcome. The record page shows that same full text, and the Held up, Didn't, and Mixed taps stay on that page. One nudge follows, and only when it would change what you do. Export and Delete all are small links at the bottom. Share, delete, and delete this chain are on the record, not the list. The page does not show a dollar cost.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`renderImpact`, `renderDueAction`, `renderDecisions`), test "leads with grill impact from the first saved grill, and the Yes or No tap stays on the record" and test "filters the list by a type taken from the stored words" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

The records switch and the calendar switch stay under the list.

On `/account`, under the calendar switch, the Monday email is on. The button turns it off or back on. The email's unsubscribe link turns it off in one click, with no second page. Outcome links in that email open a confirm page on `/decisions`. The page does not record the outcome. The button does, and only when you are signed in.

Enforced by: test "does not email someone who turned it off, and one click from the email turns it off" and test "opens a confirm page from an outcome link and records only on an authenticated POST" in [scripts/impactDigest.test.mjs](../scripts/impactDigest.test.mjs).

Enforced by: test "puts records before the settings, export and calendar, with settings at the bottom under Manage" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## A record's title

A saved decision's title is the person's own words, in the case they wrote. It is not a section heading, and it is not forced into uppercase. "iPhone launch" stays "iPhone launch". On the list, and in the due list, the title is a link to that one record. The record page shows the full text, what you chose, the verdict, the confidence, and whether the look-back is done. The look-back date is the day the decision named, when it named one, and 14 days otherwise. That page can change the date, turn the look-back off, or add one back. Any decision can. A look-back note is shown in plain words. Share verdict and delete are on that page. A link for a record that is not on this account goes back to the list. The page stays signed in.

Enforced by: [api/_pro.mjs](../api/_pro.mjs) (`.record-title`), [api/_hosted.mjs](../api/_hosted.mjs) (`renderDecision`), test "does not uppercase a record title" and test "opens a grill from its title, with the verdict, choice, confidence and look-back" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A long title with no space wraps inside the card, including at a phone width.

Enforced by: [api/_pro.mjs](../api/_pro.mjs) (`.banner`), test "wraps a long title inside the card style" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A button, a pill link and an input are at least 44px tall, including the field that shows a new calendar link.

Enforced by: [api/_pro.mjs](../api/_pro.mjs), test "gives a button and an input a 44px tap target" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

Anything the person wrote is escaped. A title is text, not markup.

Enforced by: test "escapes a title instead of rendering it" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## Dates

A date on `/decisions` uses the same day format as the chat ("15 Jan"), for the record date, the review date and a chain note.

Enforced by: [scripts/hostedCore.mjs](../scripts/hostedCore.mjs) (`formatDay`), test "shows dates the same way the chat does" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A list row says Due once the review date is today or earlier, in UTC. A review date can read as due late in the evening in a timezone behind UTC, and as due just after midnight UTC.

Enforced by: prompt text + review.

## A form comes back as a redirect

A successful form on `/decisions` or `/account` answers 303 to that page. A second identical submit does not change what the first one did. Turning a calendar link on when it is already on does not replace the link.

Enforced by: test "answers 303 after a successful form and leaves a second identical post unchanged" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A new calendar link is shown once, on the page that follows the redirect. It rides in a short-lived HttpOnly cookie and is not stored. It does not appear on a later visit, and it is not on `/account`.

Enforced by: test "shows a calendar secret only on the one-time page" in [scripts/pages.test.mjs](../scripts/pages.test.mjs). The cookie is in [docs/DATA-LEDGER.md](DATA-LEDGER.md) and [docs/PRIVACY.md](PRIVACY.md).

## Danger

Delete all records, and delete this account, each open a confirm page. The confirm value is the button on that page, not a hidden field. Deleting one record, or one chain, is still one tap.

Enforced by: test "asks on a page before deleting every record or the account" in [scripts/pages.test.mjs](../scripts/pages.test.mjs). One record and one chain staying one tap is prompt text + review.

## Share a verdict

The record page offers Share verdict. That opens a confirm page. The list does not. The page shows the exact words the public page will show, and nothing else from the record. The button POSTs, and the decisions page then shows the link. Stop sharing is a POST. Deleting the record stops the link too. The public page, `/share/<token>`, needs no sign-in. It shows the verdict, one challenge, and a link to grillyour.ai. It is `noindex` and runs no script.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`handleShare`), tests in [scripts/shareVerdict.test.mjs](../scripts/shareVerdict.test.mjs).

"Delete this chain" is only on a record that replaces another, or was replaced.

Enforced by: test "offers delete this chain only on a record that is in a chain" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## A way out, in the person's words

A page a person can land on with nothing else to do links back to Grill: a deleted account, an invite-only email, a missed sign-in, and a sign-in that isn't set up. Those pages do not name Clerk, an environment variable, or an allowed-origin setting.

Enforced by: test "gives every dead-end page a way back" in [scripts/pages.test.mjs](../scripts/pages.test.mjs) and test "does not name operator settings on a person-facing page" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

Each of those pages has a specific title, `lang="en"`, a viewport meta, and `noindex`.

Enforced by: test "gives every dead-end page a way back" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## Pricing, while paid plans are off

`/pricing` states the same prices as the rest of the site: $9 a month or $90 a year. The homepage does not offer Pro. Those offers live on `/pricing`. While paid plans are off, a view of that page, a view of `/checkout`, and a Notify me click are anonymous counts. The page runs no script. Nothing is charged. A signed-in checkout, once billing is on, puts the account id on the session so a later payment can be tied to that account. The prices do not change.

## An invite code

`/redeem` is for a signed-in person who is not on the invite list. They enter a code, then a confirm page. The confirm value is the button on that page. A code can come from `GRILL_INVITE_CODES` or from a single-use code in the codes store, one per lead. After the code is used, the page says you're in and the next step is a plain link to `/start`. `/start` asks which AI you use. ChatGPT shows four short steps on chatgpt.com, and a short note: use it there in the same account or workspace where you added it, pick @Grill so ChatGPT actually calls it, and the phone app can't run custom connectors yet. If ChatGPT answers as Grill without a Grill tool call, it hasn't really grilled anything. A line on the page says that when Grill is connected, most apps show a Grill tool call when it runs, and if yours shows none and the answer still claims to be Grill's, Grill may not have run. Claude shows a pre-filled add-connector link, and a note that it works on the web, the desktop app and the phone app, the free plan allows only one custom connector, and on a Team plan an owner adds Grill, then each person signs in to Grill themselves. Grok Bot shows the one line that adds `https://grillyour.ai/mcp`, and that it works on the desktop app and the phone app, on Premium, Super and Ultra on The X Subscription, and to check your X plan includes Grok Bot. Cursor and VS Code show the hosted connector at `https://grillyour.ai/mcp`, then the npx setup for your own key. Cursor's note says a desktop connection and a Cloud Agent connection are separate sign-ins. Other AI shows the copy-and-paste steps for Copilot, DeepSeek, Gemini, Muse, Grok and more, and that connecting Grill in Microsoft 365 Copilot needs an admin to add it first, while copy and paste works without that. Consumer Copilot's documented connectors don't include custom servers, so use copy and paste. Then one prompt to copy. Its only script copies that prompt. A `?ref=` on `/start` is recorded as a count for that source and is not shown on the page. `/redeem` runs no script. When open sign-up is off, the invite-only message links here. Open sign-up is on in production.

Enforced by: test "asks on a confirm page before a code is used, with no script", test "points the invite-only page at the redeem page", and test "the success page's next step is a plain link to /start, with no script" in [scripts/inviteCode.test.mjs](../scripts/inviteCode.test.mjs), and test "asks which AI, then shows that tool's steps and one prompt" in [scripts/site.test.mjs](../scripts/site.test.mjs).

## A waitlist

Someone without an invite code can join a waitlist from `/start` or the invite wall. The form asks for an email, and the `?ref=` source comes along. A second page asks them to confirm. Nothing is emailed, and joining does not let them in. The thank-you page says they are on the list, and that once they are let in they can use the free option right away in their own AI chat via the connector, with a link to the setup guide. Approving later mints a single-use invite code. They still redeem it at `/redeem`. The pages run no script. Sign-ups are a count the weekly metrics can read.

## Founding members

The first 100 people let in are founding members. `/start` and `/redeem` say "First 100 users get Grill free for life, N spots left", or "All 100 founding spots are taken" once those spots are gone. One spot left says "1 spot left". After a code is used, and on the account page, the line is "Founding member #N of 100: Grill is free for you for life." Pricing and checkout tell a founding member "You don't need to pay." A paid plan does not apply to them. `/pricing`, `/checkout` and `/redeem` run no script. `/start` has one script, and it only copies the starter prompt.

## A judge page, when the assistant cannot connect

`/judge` is for a person whose assistant cannot add a connector. `/judge?q=` opens a signed-in page with that decision filled in. The page does not run a grill on GET. The button POSTs, and that runs the same hosted grill as the connector: the same judge, the same caps, and the same choice about records. The first time, the page asks whether to keep records and does not send the decision until they answer. A later grill uses that answer. The verdict is plain text to copy back. A decision over 4000 characters is refused and not sent. The page runs no script.

An optional `from` names the assistant that wrote the decision. It uses the same client list as a connector, including `gemini`, `gemini-cli`, `antigravity`, `Google-Discovery-Engine`, `claude`, `chatgpt` and `grok`. The page says which company the judge is not from, and the POST excludes that company. The value is a hidden field, so it is sent with the decision. A missing or unknown `from` excludes nobody. `from=signin` is still only the sign-in return.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`handleJudge`), test "shows a prefilled form and does not grill on GET", test "asks before the first send, then grills on the answer and not before", and test "excludes the company named by from, and carries that hint in the form" in [scripts/judgePage.test.mjs](../scripts/judgePage.test.mjs).

## Changes you asked for

On `/contribute`, shipped changes people asked for are listed from `data/contributors.json`. The page source runs no script. The list is written when the site is built. A name or handle is shown only when that entry's `consent` is exactly true. Otherwise the line says "suggested by a tester." Credit names the product feedback only, never a person's own decisions. The list starts empty. A name is added only after that person agrees.

Enforced by: [scripts/contributorsCore.mjs](../scripts/contributorsCore.mjs), test "never renders a name when consent is not exactly true" in [scripts/contributors.test.mjs](../scripts/contributors.test.mjs).

## A public page

A public page is one file in `site/` and one `writePage` call in the build script. It opens with its `<title>`, and the title has the word Grill in it. It has one `<h1>`. It borrows the home page's styles. A new page has no `<style>` and no `<script>` of its own. Three older pages, look-back, start and miss, keep one script each, and a test names them. Its address is one segment with no dot, such as `/how-we-test/`, so the routes that already exist serve it and its Markdown twin. Registering it puts it in the sitemap and in `llms.txt`. The steps are in [CONTRIBUTING.md](../CONTRIBUTING.md), under "Add a page".

Enforced by: [scripts/build-site.mjs](../scripts/build-site.mjs) (`writePage`), test "names Grill in the title of every sitemap page" in [scripts/site.test.mjs](../scripts/site.test.mjs), test "publishes one SoftwareApplication JSON-LD block and no other script" in [scripts/site.test.mjs](../scripts/site.test.mjs), test "writes a markdown twin for every sitemap page, from that page's own words" in [scripts/site.test.mjs](../scripts/site.test.mjs) and test "negotiates markdown for every sitemap page and adds Vary: Accept to the HTML" in [scripts/site.test.mjs](../scripts/site.test.mjs).

No page has an em dash or an en dash. Every page keeps the footer span that says Made at Hold. On a deploy the build writes the live commit into that span, and the build stops if a page has lost it.

Enforced by: test "no page source has an em dash or an en dash, and every one keeps the Hold footer span" in [scripts/site.test.mjs](../scripts/site.test.mjs), test "names the live commit in every public page footer when the deploy provides one, and nothing otherwise" in [scripts/site.test.mjs](../scripts/site.test.mjs) and test "when any page has lost the footer span the live commit is written into" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs).

A number on a page comes from a committed file and is written in when the site is built. It is not typed into the page. `/how-we-test/` shows [data/results.json](../data/results.json) through one marker, and the build stops if the marker or the file is wrong. Counts go in a list, not a table: a list reads well on a phone and in the Markdown twin. A count is written "2 of 6". A rate is shown only when 10 cases or more are behind it.

Enforced by: [scripts/resultsCore.mjs](../scripts/resultsCore.mjs) (`renderResults`), test "is a script-free prose page in the shared chrome, with one marker for the results" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs), test "when the results marker is missing, or is there twice" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs), test "when the results file breaks a rule of its shape, and it names where" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs) and test "shows a rate only when 10 cases or more are behind it, and refuses one under that" in [scripts/resultsCore.test.mjs](../scripts/resultsCore.test.mjs).

A page about a measurement opens with what has not been measured. A count that looks bad sits in the same list as one that looks good, in the same markup. The page ends with one call to action: a link to `/start/` that carries the page's own name, such as `/start/?ref=how-we-test`.

Enforced by: test "opens with what has not been measured yet, and the description, the blurb and llms.txt lead with it" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs), test "gives the false alarms and the quotes not found the same weight as the catches" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs) and test "ends with exactly one call to action, tagged for this page" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs).

A sentence that says the judge is from a different company keeps its condition: when Grill can tell which company wrote the plan. A page does not carry a claim about how good the judge is that has not been measured.

Enforced by: test "states the rule in its conditional shape, and no sentence says different company without the condition" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs), test "uses none of the words Grill does not say, promises no date, and shows no rate sign anywhere" in [scripts/howWeTest.test.mjs](../scripts/howWeTest.test.mjs) and, for the other pages, test "public copy does not claim the judge is more accurate before it is measured" in [scripts/claims.test.mjs](../scripts/claims.test.mjs).

A new page is looked at 390 px wide, in light and in dark, before it ships.

Enforced by: prompt text + review.

## No script

The decisions page, the account page, the judge page and the dead-end pages ship no `<script>`. The shared response headers are `WELCOME_HEADERS` in [api/_pro.mjs](../api/_pro.mjs): a strict content security policy, no third-party script, no analytics.

Enforced by: test "renders the decisions page with no script" in [scripts/pages.test.mjs](../scripts/pages.test.mjs). The content security policy is prompt text + review in [api/_pro.mjs](../api/_pro.mjs).
