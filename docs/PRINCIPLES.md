# Principles

Grill helps people make better decisions with AI.

## Mission

A second opinion from a model made by a different company catches what your own assistant misses. That saves rework. The reflection builds judgement over time. The reflection is "Before you decide", the decision record, and the look back.

## North Star

The goal for now is 100 real users. A real user is a person who ran a grill. We count that from evidence. A download is not a user. A person who leaves an email to hear when Pro is ready is Pro interest. That sign-up is not a user, and it is never counted toward the 100.

## Privacy

Only the write-up you approve leaves your machine for the judge. It goes to OpenRouter on your own key, and to the judge model.

If you turn on anonymous usage stats (off by default), the tool also sends a metadata-only ping to Grill's website after a grill. That ping is a random install ID, the version, the client, whether the grill succeeded, coarse timing, and the UTC day. It never includes decision text. With the setting off, the tool does not call Grill's servers. `GRILL_PING=off` and `DO_NOT_TRACK=1` stop the ping even when the setting is on.

The optional Jev quality check sees the masked write-up and the report. That check is zero-retention. It keeps nothing.

The HTTP-Referer header lets OpenRouter count Grill usage in aggregate. It adds no new destination for the write-up.

The website counts visits without cookies. It never counts the words of a decision. The installed tool can optionally send anonymous usage metadata to this site if you turn that on at install; off by default; never decision words.

Grill never collects decision text, notes, reflections, or keys. It does not collect anything that identifies you unless you opt in to anonymous usage stats, and then only a random install ID.

The free tool has no account. It stores nothing about a decision. The opt-in usage-stats file on your computer holds only that random ID and when a ping was sent, and only if you turned the setting on.

Any telemetry is opt-in. It is off by default. It is disclosed in [docs/PRIVACY.md](PRIVACY.md). It never includes decision text. It uses only a random install ID.

Grill Pro is accounts and stored history. It is not live. It will be disclosed in [docs/PRIVACY.md](PRIVACY.md) and on the site before launch. It will be opt-in.

## Product guardrails

The judge is always from a different company than the model being judged. Only that company is excluded.

Grill uses OpenRouter's Auto Router. It does not pin models.

The human decides. Grill only advises.

Numbers stay honest. Downloads are not users. A claim needs evidence. Pro launch-list sign-ups are interest, reported beside the real-user count, and never added to it.

The tool has no third-party dependencies.
