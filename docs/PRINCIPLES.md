# Principles

## Mission

Grill helps people make better decisions with AI. An AI from a different company argues the other side; you decide; later you look back and see how your judgement did.

## Vision

AI that makes people's judgement stronger, not weaker: every important call meets its strongest objection, the person still makes the call, and learns from how it turned out, including when to change course.

## North Star

The goal for now is 100 real users. A real user is a person who ran a grill. We count that from evidence. A download is not a user. A person who leaves an email to hear when Pro is ready is Pro interest. That sign-up is not a user, and it is never counted toward the 100.

Evidenced look-backs are reported alongside the 100, and never added to it. The count is public signal issues with `Event: resolved`, plus outreach replies that confirm a look-back. It uses those existing reports. It does not add tracking or collect anything new.

## Privacy

Only the write-up you approve leaves your machine for the judge. It goes to OpenRouter on your own key, and to the judge model.

If you turn on anonymous usage stats (off by default), the tool also sends a metadata-only ping to Grill's website after a grill. That ping is a random install ID, the version, the client, whether the grill succeeded, coarse timing, and the UTC day. It never includes decision text. With the setting off, the tool does not call Grill's servers. `GRILL_PING=off` and `DO_NOT_TRACK=1` stop the ping even when the setting is on.

The optional Jev quality check sees the masked write-up and the report. That check is zero-retention. It keeps nothing.

The HTTP-Referer header lets OpenRouter count Grill usage in aggregate. It adds no new destination for the write-up.

The website counts visits without cookies. It never counts the words of a decision. The installed tool can optionally send anonymous usage metadata to this site if you turn that on at install; off by default; never decision words.

Grill never collects decision text, notes, reflections, or keys. It does not collect anything that identifies you unless you opt in to anonymous usage stats, and then only a random install ID. With a Grill account in chat, the approved write-up passes through Grill's server in memory. It is never logged or stored. Decision records are kept only if you choose, and you can export or delete them.

The free tool has no account. It stores nothing about a decision. The opt-in usage-stats file on your computer holds only that random ID and when a ping was sent, and only if you turned the setting on.

Any telemetry is opt-in. It is off by default. It is disclosed in [docs/PRIVACY.md](PRIVACY.md). It never includes decision text. It uses only a random install ID.

A Grill account is opt-in, and invite-only until Grill turns it on. It can keep your decision records if you choose, encrypted, with export and delete. It stores your sign-in, your credit, and the cost, time and model of each grill. It never stores the write-up, and it never keeps a full report for more than 15 minutes. You never see the model-router key; Grill holds it for you. The account is off until Grill turns it on. Details: [docs/PRIVACY.md](PRIVACY.md) and [docs/DATA-LEDGER.md](DATA-LEDGER.md).

## Product guardrails

The judge is always from a different company than the model being judged. Only that company is excluded.

Grill uses OpenRouter's Auto Router. It does not pin models.

The human decides. Grill only advises.

The verdict never becomes the decision. The verdict changes only on new evidence. Your decision can change for new evidence, new goals, a changed situation or a different weighing, and the record says which. Changing your mind is part of the record, not a mark against it.

A copy-paste check is in [docs/manual-check.md](manual-check.md).

Numbers stay honest. Downloads are not users. A claim needs evidence. Pro launch-list sign-ups are interest, reported beside the real-user count, and never added to it. Evidenced look-backs are reported beside that count too, and never added to it.

The tool has no third-party dependencies.
