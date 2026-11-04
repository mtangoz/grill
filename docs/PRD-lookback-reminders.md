# PRD: Look-back reminders for saved decisions

Status: approved by the owner for their own use, 2026-10-16. Builds on Grill in your chat ([HOSTED.md](HOSTED.md)). Invite-only, like the rest of that route.

## 0. Why, in one line

Grill already saves your decisions and gives each one a look-back date. Nothing tells you when that date arrives, so the look-back never happens and the learning loop does not close.

Evidence: in the 2026-10-11 usage review, `grill_look_back` on the owner's hosted account returned "No saved decision is due for a look-back yet", and the 8 Kindo grills in the same window recorded no confidence or prediction, so there was nothing to score. On the hosted route the record says "Saved. Look-back 30 Oct." and then goes quiet.

Grilled 2026-10-16: **solid if**. The challenge was that the feed reminds only someone who switched it on and whose calendar subscribes to URLs. So the switch sits next to the due list on `/decisions` as well as on `/account`, and the feed is a reminder on top of the in-chat line, not a replacement for it.

## 1. What exists today (reused, not rebuilt)

| Piece | Where |
|---|---|
| Saved history: encrypted records, opt-in, export, delete | `api/_hosted.mjs` (`writeRecord`, `loadRecords`, `/decisions`) |
| Look-back date on every record (`review`, 14 days) | `callDecided`, `docs/DECISION-RECORD.md` |
| "Look back" with nothing pasted reads the saved records that are due | `recordsForLookBack` mode `due` |
| A due count on `/decisions` | `decisionHabits` |

So "saved history" is done on this route. The missing piece is the reminder.

## 2. What this adds

1. **A due list at the top of `/decisions`.** Every saved record whose review date has passed and that has no look-back yet, oldest first, with how many days overdue. One line under it: say "look back" in your chat.
2. **One reminder line in the chat.** When you finish a grill with `grill_decided` and other records are due, the confirmation adds: `2 earlier calls are due for a look-back. Say "look back" when you're ready.` At most once a UTC day per account. No titles in that line.
3. **A private calendar link (iCalendar feed), off by default.** Switched on next to the due list on `/decisions`, or from `/account`. Your calendar app subscribes once; each saved record without a look-back appears as an all-day event on its review date. The event says only "Grill look-back due" unless you also switch on titles. The link is shown once, when you turn it on or reset it. Reset makes the old link stop working. Turning it off or deleting the account removes it.
4. **Look-back skips calls already looked back.** Today "look back" with nothing pasted re-reads every due record, including ones already answered. After this, it reads only those still waiting, which is what a reminder points at.

## 3. Privacy

The reminder in chat and the due list add no new destination: they read records the account already holds, in the same request.

The calendar link is the one new flow, and it is opt-in:

| What | Where it goes | Default |
|---|---|---|
| Review dates of records without a look-back, and a link to `/decisions` | Whoever holds the link, which in practice is the calendar app you subscribe with (Google, Apple, Outlook). Their servers fetch it every few hours. | Off |
| Decision titles in those events | The same | Off, and a second switch |
| The link's secret | Stored only as a SHA-256 hash in Upstash. The raw link is shown once. | Not stored raw |

The link sits in the URL path because calendar apps cannot send a header. The host's request log therefore sees it. Grill's operators already hold the key that decrypts records ([DATA-LEDGER.md](DATA-LEDGER.md)), so this does not widen what they can read. It is still written down in the ledger.

No email. The only email remains the sign-in. No push service, no cron job, no new vendor, no new environment variable.

## 4. Decisions taken (owner may overrule)

| Question | Choice | Why |
|---|---|---|
| Channel | Calendar feed plus an in-chat line | A calendar already reminds you on your phone, and you pick the app. Email would add a vendor and break "the only email is the sign-in". |
| Titles in the feed | Off by default | A calendar provider is a new reader. Dates alone are enough to prompt "look back". |
| Link stored raw, or hashed | Hashed, shown once | Same pattern as the managed key. A Redis leak alone cannot read the feed. |
| How often the chat line shows | Once a UTC day | A reminder that repeats every call becomes noise. |

## 5. Not in scope

Email or push reminders. Reminders for the installed (free) tool, which stores nothing; its record already carries the `review` date for your own notes. Pro billing. Changing the 14-day default.

## 6. Done when

- `/decisions` lists due records without a look-back, and no others.
- `grill_decided` adds the due line once per UTC day, and only when another record is due.
- The feed: 404 until switched on; valid iCalendar with stable UIDs; content-free unless titles are on; a looked-back record drops out; reset and off revoke the old link; delete account revokes it.
- `grill_look_back` with nothing pasted skips records already looked back.
- DATA-LEDGER.md, PRIVACY.md, HOSTED.md and the CHANGELOG say so in the same pull request.
- `node --test scripts/*.test.mjs` green. Zero new dependencies.

## 7. How we will know it worked

Look-backs done over look-backs due, on the owner's `/decisions` habits line, 30 days after the feed is on. Today it is 0 of 0 because nothing came due unprompted. Target: at least half of due records get a look-back within 7 days of their date.
