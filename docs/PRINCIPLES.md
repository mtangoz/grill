# Principles

## Mission

Grill helps people make better decisions with AI. An AI from a different company argues the other side; you decide; later you look back and see how your judgement did.

Enforced by: a different company is [scripts/judgeCore.mjs](../scripts/judgeCore.mjs), test "excludes the author's company on that router, and only that company" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs), and test "excludes the host's company when the call leaves author empty, and a call's own author still wins" in [scripts/server.test.mjs](../scripts/server.test.mjs). You decide is prompt text + review in [skills/grill/SKILL.md](../skills/grill/SKILL.md). Looking back is [scripts/reflection.mjs](../scripts/reflection.mjs), test "the skill, the paste prompt and the site ask the same three questions" in [scripts/reflection.test.mjs](../scripts/reflection.test.mjs).

## Vision

AI that makes people's judgement stronger, not weaker: every important call meets its strongest objection, the person still makes the call, and learns from how it turned out, including when to change course.

Enforced by: prompt text + review in [skills/grill/SKILL.md](../skills/grill/SKILL.md) and [prompts/grill.md](../prompts/grill.md). The strongest objection is the judge in [scripts/judgeCore.mjs](../scripts/judgeCore.mjs), test "states the checked and yours split in the system prompt and in JUDGE_TOOL" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs).

## North Star

The goal for now is 100 real users. A real user is a person who ran a grill. We count that from evidence. A download is not a user. A person who leaves an email to hear when Pro is ready is Pro interest. That sign-up is not a user, and it is never counted toward the 100.

Evidenced look-backs are reported alongside the 100, and never added to it. The count is public signal issues with `Event: resolved`, plus outreach replies that confirm a look-back. It uses those existing reports. It does not add tracking or collect anything new.

Enforced by: prompt text + review. A launch-list sign-up is interest, not a user, in [api/_notify.mjs](../api/_notify.mjs), test "GET shows a button and does not confirm; POST is what adds the contact" in [scripts/notify.test.mjs](../scripts/notify.test.mjs).

## Privacy

Only the write-up you approve leaves your machine for the judge. It goes to OpenRouter on your own key, and to the judge model.

Enforced by: [scripts/judge.mjs](../scripts/judge.mjs) sends that write-up to OpenRouter, test "secrets never leave" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs), and test "that one fetch can reach only the two OpenRouter endpoints, or loopback in tests, and nothing else" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs). Showing it and waiting for approval is prompt text + review in [skills/grill/SKILL.md](../skills/grill/SKILL.md).

If you turn on anonymous usage stats (off by default), the tool also sends a metadata-only ping to Grill's website after a grill. That ping is a random install ID, the version, the client, whether the grill succeeded, coarse timing, and the UTC day. It never includes decision text. With the setting off, the tool does not call Grill's servers. `GRILL_PING=off` and `DO_NOT_TRACK=1` stop the ping even when the setting is on.

Enforced by: [scripts/usageStats.mjs](../scripts/usageStats.mjs), test "posts exactly the allowed keys to the ping URL, with no decision text" in [scripts/usageStats.test.mjs](../scripts/usageStats.test.mjs), and test "when off, a finished grill makes no request to grillyour.ai and creates no state file" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs).

The optional Jev quality check sees the masked write-up and the report. That check is zero-retention. It keeps nothing.

Enforced by: [scripts/upstreamCore.mjs](../scripts/upstreamCore.mjs), test "flags a second endpoint from the same provider that is not zero-retention" in [scripts/upstreamCore.test.mjs](../scripts/upstreamCore.test.mjs). The judge request itself is zero-retention, test "shows the privacy fields on the payload it would send" in [scripts/judge.test.mjs](../scripts/judge.test.mjs).

The HTTP-Referer header lets OpenRouter count Grill usage in aggregate. It adds no new destination for the write-up.

Enforced by: [scripts/judge.mjs](../scripts/judge.mjs), test "that one fetch can reach only the two OpenRouter endpoints, or loopback in tests, and nothing else" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs).

The website counts visits without cookies. It never counts the words of a decision. The installed tool can optionally send anonymous usage metadata to this site if you turn that on at install; off by default; never decision words.

Enforced by: test "says the website counts visits anonymously, and the tool's usage ping is opt-in" in [scripts/site.test.mjs](../scripts/site.test.mjs).

Grill never collects decision text, notes, reflections, or keys. It does not collect anything that identifies you unless you opt in to anonymous usage stats, and then only a random install ID.

Enforced by: [scripts/usageStats.mjs](../scripts/usageStats.mjs), test "posts exactly the allowed keys to the ping URL, with no decision text" in [scripts/usageStats.test.mjs](../scripts/usageStats.test.mjs), and test "secrets never leave" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs).

The free tool has no account. It stores nothing about a decision. The opt-in usage-stats file on your computer holds only that random ID and when a ping was sent, and only if you turned the setting on.

Enforced by: [scripts/usageStats.mjs](../scripts/usageStats.mjs), test "sends on the first success and never again, including on a later day" in [scripts/usageStats.test.mjs](../scripts/usageStats.test.mjs).

Any telemetry is opt-in. It is off by default. It is disclosed in [docs/PRIVACY.md](PRIVACY.md). It never includes decision text. It uses only a random install ID.

Enforced by: [scripts/usageStats.mjs](../scripts/usageStats.mjs), test "defaults to off in every install config" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs). The disclosure is [docs/PRIVACY.md](PRIVACY.md).

Grill Pro is accounts and stored history. It is not live. It will be disclosed in [docs/PRIVACY.md](PRIVACY.md) and on the site before launch. It will be opt-in.

Enforced by: prompt text + review in [docs/PRIVACY.md](PRIVACY.md).

## Product guardrails

The judge is always from a different company than the model being judged. Only that company is excluded.

Enforced by: [scripts/judgeCore.mjs](../scripts/judgeCore.mjs) (DEFAULT_CHAIN), test "excludes the author's company on that router, and only that company" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs), test "asks only the auto router, excludes the default company, and names no pinned fallback" in [scripts/judge.test.mjs](../scripts/judge.test.mjs), and test "errors when every retry is still the excluded company, and never calls a pinned fallback" in [scripts/judge.test.mjs](../scripts/judge.test.mjs).

Grill uses OpenRouter's Auto Router. It does not pin models.

Enforced by: [scripts/judgeCore.mjs](../scripts/judgeCore.mjs) (`export const DEFAULT_CHAIN = "openrouter/auto";`), test "is only the Auto Router — no pinned vendor model" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs), and test "asks only the auto router, excludes the default company, and names no pinned fallback" in [scripts/judge.test.mjs](../scripts/judge.test.mjs).

The human decides. Grill only advises.

Enforced by: prompt text + review in [skills/grill/SKILL.md](../skills/grill/SKILL.md) and [prompts/grill.md](../prompts/grill.md).

The verdict never becomes the decision. The verdict changes only on new evidence. Your decision can change for new evidence, new goals, a changed situation or a different weighing, and the record says which. Changing your mind is part of the record, not a mark against it.

Enforced by: prompt text + review in [skills/grill/SKILL.md](../skills/grill/SKILL.md), test "the skill, the paste prompt and the site ask the same three questions" in [scripts/reflection.test.mjs](../scripts/reflection.test.mjs).

A copy-paste check is in [docs/manual-check.md](manual-check.md).

Enforced by: [docs/manual-check.md](manual-check.md), test "the skill, the paste prompt and the site ask the same three questions" in [scripts/reflection.test.mjs](../scripts/reflection.test.mjs).

Numbers stay honest. Downloads are not users. A claim needs evidence. Pro launch-list sign-ups are interest, reported beside the real-user count, and never added to it. Evidenced look-backs are reported beside that count too, and never added to it.

Enforced by: prompt text + review. Sign-ups stay off the user count in [api/_notify.mjs](../api/_notify.mjs), test "GET shows a button and does not confirm; POST is what adds the contact" in [scripts/notify.test.mjs](../scripts/notify.test.mjs).

The tool has no third-party dependencies.

Enforced by: [package.json](../package.json), test "ships the same runnable code as the Desktop extension, and nothing else runnable" in [scripts/packaging.test.mjs](../scripts/packaging.test.mjs), and test "imports only Node built-ins and its own files: no third-party code at all" in [scripts/privacy.test.mjs](../scripts/privacy.test.mjs).

Feedback is about your calls, never about the person: no scores, points, badges or streaks. A changed mind is shown, never scored.

Enforced by: prompt text + review in [skills/grill/reflection.md](../skills/grill/reflection.md) and [prompts/grill.md](../prompts/grill.md).

Your values and judgment calls are yours. Every verdict separates what the judge could check for you (bugs, facts, figures, consistency) under "Checked for you" from what hinges on your own values or unwritten rules under "Your call".

Enforced by: [scripts/judgeCore.mjs](../scripts/judgeCore.mjs), test "renders Checked for you before Your call, and a missing call counts as yours" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs), and test "drops an invalid call value instead of rejecting the challenge" in [scripts/judgeCore.test.mjs](../scripts/judgeCore.test.mjs).

Speed comes first on quick or bulk grills. Never add a required question before the verdict on a quick or bulk grill. Reflection, such as a forecast, is an optional one-line offer after the verdict, for decisions you mark as big.

Enforced by: [server/index.mjs](../server/index.mjs) and [skills/grill/SKILL.md](../skills/grill/SKILL.md), test "tells Claude, before every call, to write the subject as a clerk and keep the question from leaning" in [scripts/server.test.mjs](../scripts/server.test.mjs), and test "the skill, the paste prompt and the site ask the same three questions" in [scripts/reflection.test.mjs](../scripts/reflection.test.mjs).
