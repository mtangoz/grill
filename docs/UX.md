# How the pages are built

Each page has one job. `/decisions` gets a due look-back done. `/account` shows who you are, what Grill holds, and how to leave. A section earns its place by helping that job.

The order on a page is: what needs you now, how your judgement is doing, your records, manage, leave. Settings do not sit above the thing the page is for. Danger sits behind a confirm page.

The pages run no JavaScript. A disclosure is a `<details>` element. A confirm is its own page.

## What needs you now

On `/decisions` the due list is the first section under the title, before credit, the records switch and the export links.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`renderDue`), test "puts what needs you now above credit, the records switch and export" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

How your judgement is doing, then the records, then the controls, then leaving, is the order to keep. The records switch, the calendar switch and the export links still sit above the habit counts and the cards.

Enforced by: prompt text + review.

## A record's title

A saved decision's title is the person's own words, in the case they wrote. It is not a section heading, and it is not forced into uppercase. "iPhone launch" stays "iPhone launch".

Enforced by: [api/_pro.mjs](../api/_pro.mjs) (`.record-title`), test "does not uppercase a record title" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A long title with no space wraps inside the card, including at a phone width.

Enforced by: [api/_pro.mjs](../api/_pro.mjs) (`.banner`), test "wraps a long title inside the card style" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

A button, a pill link and an input are at least 44px tall, including the field that shows a new calendar link.

Enforced by: [api/_pro.mjs](../api/_pro.mjs), test "gives a button and an input a 44px tap target" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

Anything the person wrote is escaped. A title is text, not markup.

Enforced by: test "escapes a title instead of rendering it" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## Dates

A date on `/decisions` uses the same day format as the chat ("15 Jan"), for the record date, the review date and a chain note.

Enforced by: [scripts/hostedCore.mjs](../scripts/hostedCore.mjs) (`formatDay`), test "shows dates the same way the chat does" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

"Due today" and "1 day overdue" are worked out in UTC. A review date can read as due today late in the evening in a timezone behind UTC, and as overdue just after midnight UTC.

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

`/decisions` offers Share verdict on each saved record. That opens a confirm page. The page shows the exact words the public page will show, and nothing else from the record. The button POSTs, and the decisions page then shows the link. Stop sharing is a POST. Deleting the record stops the link too. The public page, `/share/<token>`, needs no sign-in. It shows the verdict, one challenge, and a link to grillyour.ai. It is `noindex` and runs no script.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`handleShare`), tests in [scripts/shareVerdict.test.mjs](../scripts/shareVerdict.test.mjs).

"Delete this chain" is only on a record that replaces another, or was replaced.

Enforced by: test "offers delete this chain only on a record that is in a chain" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## A way out, in the person's words

A page a person can land on with nothing else to do links back to Grill: a deleted account, an invite-only email, a missed sign-in, and a sign-in that isn't set up. Those pages do not name Clerk, an environment variable, or an allowed-origin setting.

Enforced by: test "gives every dead-end page a way back" in [scripts/pages.test.mjs](../scripts/pages.test.mjs) and test "does not name operator settings on a person-facing page" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

Each of those pages has a specific title, `lang="en"`, a viewport meta, and `noindex`.

Enforced by: test "gives every dead-end page a way back" in [scripts/pages.test.mjs](../scripts/pages.test.mjs).

## An invite code

`/redeem` is for a signed-in person who is not on the invite list. They enter a code, then a confirm page. The confirm value is the button on that page. After the code is used, the page says you're in and the next step is a plain link to `/start`. `/start` says to sign in with the same email you signed up with, every time, so a code works for someone who was never emailed an invite. The pages run no script. The invite-only message links here.

Enforced by: test "asks on a confirm page before a code is used, with no script", test "points the invite-only page at the redeem page", and test "the success page's next step is a plain link to /start, with no script" in [scripts/inviteCode.test.mjs](../scripts/inviteCode.test.mjs), and test "tells a code user to sign in with the email they signed up with" in [scripts/site.test.mjs](../scripts/site.test.mjs).

## A judge page, when the assistant cannot connect

`/judge` is for a person whose assistant cannot add a connector. `/judge?q=` opens a signed-in page with that decision filled in. The page does not run a grill on GET. The button POSTs, and that runs the same hosted grill as the connector: the same judge, the same caps, and the same choice about records. The first time, the page asks whether to keep records and does not send the decision until they answer. A later grill uses that answer. The verdict is plain text to copy back. A decision over 4000 characters is refused and not sent. The page runs no script.

An optional `from` names the assistant that wrote the decision. It uses the same client list as a connector, including `gemini`, `gemini-cli`, `antigravity`, `Google-Discovery-Engine`, `claude`, `chatgpt` and `grok`. The page says which company the judge is not from, and the POST excludes that company. The value is a hidden field, so it is sent with the decision. A missing or unknown `from` excludes nobody. `from=signin` is still only the sign-in return.

Enforced by: [api/_hosted.mjs](../api/_hosted.mjs) (`handleJudge`), test "shows a prefilled form and does not grill on GET", test "asks before the first send, then grills on the answer and not before", and test "excludes the company named by from, and carries that hint in the form" in [scripts/judgePage.test.mjs](../scripts/judgePage.test.mjs).

## Changes you asked for

On `/contribute`, shipped changes people asked for are listed from `data/contributors.json`. The page source runs no script. The list is written when the site is built. A name or handle is shown only when that entry's `consent` is exactly true. Otherwise the line says "suggested by a tester." Credit names the product feedback only, never a person's own decisions. The list starts empty. A name is added only after that person agrees.

Enforced by: [scripts/contributorsCore.mjs](../scripts/contributorsCore.mjs), test "never renders a name when consent is not exactly true" in [scripts/contributors.test.mjs](../scripts/contributors.test.mjs).

## No script

The decisions page, the account page, the judge page and the dead-end pages ship no `<script>`. The shared response headers are `WELCOME_HEADERS` in [api/_pro.mjs](../api/_pro.mjs): a strict content security policy, no third-party script, no analytics.

Enforced by: test "renders the decisions page with no script" in [scripts/pages.test.mjs](../scripts/pages.test.mjs). The content security policy is prompt text + review in [api/_pro.mjs](../api/_pro.mjs).
