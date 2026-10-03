# Privacy: who can see your decision

What we will and won't do with your data, and how we build: [docs/PRINCIPLES.md](PRINCIPLES.md).

**Short version:** The free tool has no account, and Grill never sees a decision. Accounts (a starter key or Pro) are not available yet. Until 16 November 2026, a few invited people have a free key we created for them; [below](#invite-keys-until-16-november-2026) says what that means. The section below describes what would change if they launch; this page will be updated before they do. If you choose to join the Pro launch list on the website, we keep your email address, and nothing else, until Pro launches ([below](#the-pro-launch-list)). Bring your own key and there is no account. This website counts visits anonymously, with no cookies and nothing that identifies you. The Grill tool does not track you unless you turn on optional anonymous usage stats at install (off by default). If you leave them off, the tool still only talks to the model router. If you turn them on, it also sends one tiny metadata ping to Grill's website after your first successful grill, and not again — never the words of a decision. Details below. Your notes stay in your tools. With the setting off, the one thing that leaves your machine is the write-up you approve, and it goes only to the judge you chose.

## Who sees what

| Who | What they see | What stops more |
|---|---|---|
| **You** | Everything | — |
| **Claude** (Anthropic) | The conversation you're already having | Your Claude privacy settings |
| **The model router** (OpenRouter), one-click route | The approved write-up, in transit; request metadata (token counts, timing) | It stores no prompts unless you opt in (below). It samples a small number of prompts for anonymous categorization |
| **The judge's model provider** | The approved write-up, in transit | Grill routes **only** to zero-data-retention endpoints (`provider: { zdr: true, data_collection: "deny" }`), and never falls back to one that retains |
| **The app you paste into**, paste route | The approved write-up | That app's settings. Use its private mode, for example a Temporary Chat in ChatGPT |
| **Jev (TypeSafe)**, quality check, on by default | The masked write-up and the judge's report | A zero-data-retention endpoint, checked weekly; the check is dropped if any other endpoint answers |
| **Grill's maintainers** | **Nothing.** Only the choices you share, if you share them. With Pro, also your billing details and your key's usage, as below. If you were sent an invite key, that key's spend (cost, model and time, never the text), and that the key is yours | There is nowhere for anything else to go |
| **This website** | An anonymous count of page views, plus whether a decision record was shown or copied, whether a look-back started or finished, and how many records were pasted. It can also record a click on a download, the paste prompt, or the OpenRouter keys page, with an optional channel tag (`ref`) from a fixed list when the page address includes one. A missing tag is left off. No cookie, nothing that identifies you, and never the words of a decision | Vercel Web Analytics, on the website only. The Grill tool never loads it |
| **Grill's ping endpoint** (optional, off by default) | A random install ID, Grill version, client/route, success or failure, latency bucket, and the UTC day. **Never** the write-up, question, verdict, notes, or your key | You opt in once at install (or in settings). You can turn it off anytime. No IP address or request header is read, logged or stored. Events kept ≤ 90 days; then aggregates only. The ping never runs if the setting is off |
| **Stripe**, Grill Pro only | Your email, card and billing address | Stripe's own privacy policy. Grill never sees your card. Accounts are not available yet |
| **Resend**, accounts only | Your email address | The sign-in email is sent through Resend (sees your email address). Accounts are not available yet |
| **Upstash Redis**, accounts only | Account records | Account records live in an Upstash Redis store. Accounts are not available yet |
| **Resend**, Pro launch list, only if you join | Your email address, after you confirm it | Stored as a contact in Resend with no other details, never linked to a grill, a key or a visit. One confirmation email, then one email when Pro is ready. One-click unsubscribe. Deleted 60 days after that email |
| **Upstash Redis**, Pro launch list | A hash of your email for 24 hours (so the form can't be used to flood someone's inbox), a daily count of confirmation emails sent, and counts of confirmed sign-ups | The hash expires after a day. The counts are numbers only, never tied to an address |
| **Grill's Pro server**, managed keys only | Your email, sign-in, and (when paid plans are on) checkout and subscription status, which assistant and judge you picked, counts of sign-ups, keys issued, first grills, allowances used up and upgrade clicks, and, only if you turn it on, copies of reports you choose to keep | It runs when you sign in, when a key is issued, and when a subscription changes. Write-ups do not pass through it. The counts are numbers only, never decision text. Saving report copies is off until you turn it on, and you can delete them. A developer test mode can run a sample grill on a laptop, and that mode cannot be turned on in production. Accounts are not available yet |
| **Grill's router account**, Grill Pro only | Your key's usage: cost, model and time of each check, never the text | Logging is off and every request is zero-retention, account-wide |

## What Grill enforces in code

Each of these is pinned by a test, so it can't quietly stop being true.
- **Nothing leaves without your OK.** Claude shows you the write-up before anything is sent.
- **Keys and tokens never leave.** If the write-up, question or context contains anything shaped like an API key, token or private key, the run stops before any network call and says so. It never echoes the value.
- **Contact details are masked.** Email addresses, phone numbers and card numbers are replaced with `[email]`, `[phone]` and `[card number]` before sending. The report says how many, never what.
- **Your key stays on your computer.** If you save it with `npx -y grillyour --set-key`, it goes in `~/.config/grill/key`, readable only by you (mode 600). Grill reads it there and sends it only to the model router, as the request's credential. Status lines show its last four characters, never the key.
- **Destinations.** By default the code you install makes exactly one kind of network call, to the model router. If you opt in to anonymous usage stats, it may also POST one metadata-only ping to `https://grillyour.ai/api/ping` after your first successful grill, and not again. That ping never includes decision text. With the setting off (the default), no call to Grill's servers is made from the tool. Both destinations are pinned by `scripts/privacy.test.mjs`. There is still no third-party package in the tool.
- Requests to OpenRouter identify the app as Grill (grillyour.ai), so OpenRouter can show aggregate usage counts for the app. No decision text goes anywhere new.
- **Quotes are checked locally.** Every quote a challenge attacks is checked against your write-up on your own machine, so a made-up objection is flagged. This sends nothing anywhere.
- **The Jev quality check is on by default.** Jev scores whether the falsifiers are real tests and the verdict fits. Claude tells you before each grill that Jev will see it. Skip it for one grill by saying so, or switch it off in Grill's settings to send the write-up to the judge only. The result is kept only if Jev's zero-retention endpoint answered.
- **Nothing stored.** The write-up reaches the judge through a pipe, never a file. The report's temporary copy is deleted once read. The only file the tool writes for itself is the opt-in usage-stats state (`~/.grill/usage-stats.json`: a random install ID and the day a ping was sent), and only after you turn anonymous usage stats on. With the setting off, that file is never created or read.
- **Verifiable builds.** Each release is built by GitHub Actions from the tagged source, with a signed provenance attestation and checksums. You can confirm the extension is exactly this code.

## Two router settings to check (one-click route)

Both are off by default. Keep them off:
1. **Input & Output Logging** (Observability settings). If you use it for other work, add your Grill key under **Excluded API Keys**.
2. **Use of inputs/outputs** (Privacy settings), the 1% discount for letting the router use your data.

## Grill Pro

Accounts (a starter key or Pro) are not available yet. The section below describes what would change if they launch; this page will be updated before they do.

The sign-in email is sent through Resend (sees your email address), and account records live in an Upstash Redis store.

Pro changes who pays for the AI, not where your write-up goes.
- **Your write-ups still go straight** from your Claude to the router, using your Pro key. They never pass through Grill's server.
- **Your Pro key comes from Grill's router account.** That account is set to zero-data-retention endpoints only, with logging off, for every key.
- **What Grill keeps for a managed key** (a free starter allowance, or Pro once paid plans are on):
  - your email, so we can send a sign-in link;
  - your subscription, in Stripe once billing is connected;
  - which assistant and judge you picked;
  - a hash of your key, on the account and on your Stripe customer when you have one. Not the key itself;
  - each key's usage in the router account (cost, model and time of each check, never the text). A starter key's cap is a dollar allowance of judge spend. It does not refill;
  - counts only: accounts created, keys issued, first grills, allowances used up, and upgrade clicks. No decision text. A weekly look at activation (signed up, then a first grill) and depletion (the allowance ran out) reads these counts. They live on the account store. The account pages do not load website analytics, because those pages can show a raw key;
  - copies of reports, only if you turn saving on at your account's Reports page. Off until you do. You can delete any copy or all of them, and turn saving off. The text stays on the account store, never on your Stripe customer. Grill does not email a verdict or a weekly note today, so nothing is saved until a report exists and saving is on. In test mode, a sample grill is saved the same way.
- **The key is shown when it is created or rotated**, then dropped. If you lose it, sign in and rotate it. We switch the old one off. Rotating a starter key keeps whatever allowance is left. It does not reset the cap.
- **Bring your own key and there is no account.** The free tool is unchanged: no sign-in, and checks are unlimited on your own credit. The tool does not track you unless you turn on anonymous usage stats. That setting is off by default.

### Invite keys (until 16 November 2026)

We emailed a few people a free model-router key by hand, so they can try Grill without an OpenRouter account or a card. There is no account, no sign-in and no Grill server involved.

- **The key** is created on Grill's router account, capped at $0.50 of judge spend, with no refill. That account allows zero-data-retention endpoints only, with logging off. Your write-ups go from your computer to the router and the judge, as with your own key, and never pass through us.
- **What we can see:** the key's spend in the router account (cost, model and time of each check, never the text). The key's label is a number, not your name. We keep a private note of which number we sent to whom, so we can tie that spend to you.
- **What we keep:** that note, and the email thread you and we already have. Nothing in Resend, Upstash, Stripe or any Grill database.
- **What we ask:** one follow-up question by email, which you can ignore.
- **Deleting it:** write to support@grillyour.ai or reply to the invite. We switch the key off and delete our note within 7 days.
- **The end:** on 16 November 2026 the keys stop working and we delete them and the note. We keep totals only (how many keys were used, total spend), with no names.

## The Pro launch list

The website has an opt-in form to hear when Pro is ready. The Grill tool never asks for your email. For a limited time before Pro launches, after a finished grill, it can show one line, at most once a session, with a link to that form. It shows that line only when the day is within 7 days of the release date baked into that build, or on the first 3 days of a month. Outside those windows it shows nothing. Set `GRILL_NEWS=off`, or switch off "Show Grill news" in Grill's settings, to hide it. The line is only text: showing it sends nothing, and it stops after 2026-11-13.

- **What we keep:** your email address, as a contact in Resend, only after you click the confirmation link. Before that we keep nothing, except a one-way hash of the address for 24 hours to stop repeat sends. Resend keeps its usual delivery log of the confirmation email. The confirmation link is encrypted, so your address can't be read from it.
- **What we never keep:** anything you grilled, your key, your model-router usage, or which page you came from. We keep a separate count of sign-ups by where the link was (the tool line, the paste route, the website), and that count is not tied to your address.
- **What you'll get:** one confirmation email, and one email when Pro is ready. No newsletter.
- **Unsubscribe:** the link in any email we send, or write to support@grillyour.ai.
- **How long:** we delete the list 60 days after the launch email. If Pro doesn't happen, we delete it within 30 days of that decision.

## Your key

- **Claude Desktop:** you paste it into the extension's install dialog, which masks it and stores it securely.
- **Claude Code:** the plugin asks for it and stores it securely, or reads `OPENROUTER_API_KEY` from your environment.
- **The paste route** needs no key.

The judge sends the key only to the model router, in the `Authorization` header. It is never logged, never written to a file, and never asked for in chat.

## Your log

The weekly review keeps your decision log where you choose: a Google Drive folder, a Notion database, a local folder, or your own notes. It holds summaries and short quotes, never full transcripts, and leaves out personal, health and HR details about named people unless you ask.

## On your own computer

Claude Desktop may keep local logs of tool calls, including the write-up, on your computer. That is Claude's local logging, not Grill's.

## Reflection and look back

The questions at the end of a grill, and the decision record, stay in your chat or in notes you keep. Grill does not store them and does not send them to the judge. Looking back means you paste those records again. On the one-click route that paste is read on your machine. On the paste route it stays in the assistant you are already talking to. There is no look-back database. The monthly Count in the weekly review is separate: it needs a decision log you keep, and a single grill does not do it.

On this website, the anonymous visit count can also record that a decision record was shown or copied, that a look-back started or finished, and how many records were pasted. Those events are numbers only. They never include the title, the falsifier, the verdict, or what happened. It can also record a click on a download, the paste prompt, or the OpenRouter keys page, plus an optional channel tag (`ref`) from a fixed list (left off when missing or unknown), and never a decision, a title, a URL of your content, an email, or a key. The Grill tool you install does not send them.

## Anonymous usage stats (optional)

Off by default. Asked once in the install dialog (Claude Desktop) or documented for Claude Code / stdio. Turn off anytime in settings or with `GRILL_PING=off`.

- **What we receive:** a random install ID (not derived from your machine or key), the Grill version, which client you used, whether the grill succeeded, how long it took (coarse), and the UTC day.
- **What we never receive:** the decision, the question, the verdict, your notes, your key, your email, or your IP address (the server does not store IPs).
- **Why:** so we can tell whether installs become real first grills, without accounts and without reading decisions.
- **How often:** once, after your first successful grill (if opted in), and never again. Later grills do not ping.
- **Limits:** this samples people who opt in; it is not a full user count. Downloads and OpenRouter aggregates remain separate signals.
- **Paste route:** does not send this ping (there is no install). The optional GitHub signal form is unchanged.

## Helping Grill improve

Grill improves under the same privacy controls as a grill: masked text, zero-retention routing, nothing kept, and never a real decision ([LEARNING.md](../LEARNING.md)).
- **After a grill,** Claude may offer a link that pre-fills a public GitHub issue with a few choices: the kind of decision, the judge's model family, the verdict, whether it was worth engaging, and where you used Grill.
- **The form has no text boxes.** Grill's monthly report discards any issue edited to contain anything else.
- **You open the link and submit it yourself, or you don't.** It's off unless you choose it, every time.
