# Principles

Grill helps people make better decisions with AI.

## Mission

A second opinion from a model made by a different company catches what your own assistant misses. That saves rework. The reflection builds judgement over time. The reflection is "Before you decide", the decision record, and the look back.

## North Star

The goal for now is 100 real users. A real user is a person who ran a grill. We count that from evidence. A download is not a user.

## Privacy

Only the write-up you approve leaves your machine. It goes to OpenRouter on your own key, and to the judge model.

The optional Jev quality check sees the masked write-up and the report. That check is zero-retention. It keeps nothing.

The HTTP-Referer header lets OpenRouter count Grill usage in aggregate. It adds no new destination.

The website counts visits without cookies. It never counts the words of a decision.

Grill never collects decision text, notes, reflections, or keys. In the free tool it never collects anything that identifies you.

The free tool has no account. It stores nothing.

Any future telemetry is opt-in. It is off by default. It is disclosed in [docs/PRIVACY.md](PRIVACY.md) before it ships. It never includes decision text. It uses only a random install ID.

Grill Pro is accounts and stored history. It is not live. It will be disclosed in [docs/PRIVACY.md](PRIVACY.md) and on the site before launch. It will be opt-in.

## Product guardrails

The judge is always from a different company than the model being judged. Only that company is excluded.

Grill uses OpenRouter's Auto Router. It does not pin models.

The human decides. Grill only advises.

Numbers stay honest. Downloads are not users. A claim needs evidence.

The tool has no third-party dependencies.
