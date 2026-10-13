# Data ledger: Grill in your chat

Update this file in the same pull request whenever the hosted data flow changes. The installed tool is not this table. Its privacy stance is unchanged and is the comparison column on the right.

Hosted mode is off unless `GRILL_HOSTED=on`. When it is on, it is invite-only.

The decision, as you stated it, passes through Grill's server in memory. It is never logged or stored.

## What leaves the machine

| What | Where it goes | How long | Who can delete it | Installed tool, for comparison |
|---|---|---|---|---|
| The decision, as you stated it | Through Grill's server memory, then to OpenRouter and the judge, with `provider: { zdr: true, data_collection: "deny" }`. Not written to a log or a store. | The length of that grill, in memory only | There is nothing to delete. A process restart drops it. | Goes from your computer straight to OpenRouter. Grill's server never sees it. |
| The question, if you set one | Same path as the write-up | Same | Same | Same, and Grill's server never sees it. |
| Masked write-up and the report, when the quality check is on (the default) | Jev, at TypeSafe, through OpenRouter's decisions endpoint. Zero-retention, and dropped if any other endpoint answers. Skip one grill by saying so. | Not stored by Grill | Not a Grill copy. TypeSafe does not retain it. | The installed tool sends the same check from your computer. |
| The layers the chat can show (layer 1, at most 50 words; a later "more" or "options" layer, about 60 to 80 words; and a fuller note with no model name and no Jev score) | Encrypted in Upstash Redis. The key is inside the job id returned to the chat, not stored beside the ciphertext. Not the write-up, not the steelman, and not a Jev score. | At most 15 minutes. Reading a layer does not delete it, so a later layer can be served from the same slot. The key expires with the job. | It expires on its own. Grill can flush the Redis entry. Operators cannot read it without the job id, which Grill does not keep. | Stays in the chat. The installed server keeps the same layers in memory until that process exits. Nothing is written to disk for them. |
| Draft, if you chose to keep records and have not yet said what you chose | Encrypted in Upstash Redis. Title, verdict (including a quick take), cheap test, any prediction, goal or guardrail already in your words, and the later layers (more, options, and the fuller note). Not the full write-up, not the steelman, and not a Jev score. No look-back date. | 14 days, or until you say what you chose, whichever comes first | It expires on its own. Saying what you chose turns it into a decision record you can delete. Deleting the account deletes it. | Not stored. |
| Decision record (the version 1 block, up to two challenge lines, and look-back answers) | Encrypted in Upstash Redis, only if you choose to keep records, and only after you state a choice. A per-person key is wrapped with `GRILL_RECORD_KEY`. | Until you delete it, or delete the account | You, from `/decisions` (one record, a chain, or all) or by deleting the account. Grill's operators hold `GRILL_RECORD_KEY`, so they could decrypt records. Say so if you ask. | Not stored. You copy the block into your own notes. |
| Disclosure flag | A yes/no in Upstash, keyed to the account id. No decision text. | Until you delete the account | You, by deleting the account | Not stored. The installed tool says the disclosure from its tool description, once. |
| `source_app` on that record | Inside the same encrypted record | Same | Same | The installed tool does not write this line. |
| What you decided, who first proposed it (ai or me), and a supersedes / changed line | Inside the same encrypted record, only in words you gave | Same | Same | Not stored. |
| Sign-in | Clerk. Email, and the sign-in event. Google, an emailed code, or AgentID for an agent. | Until you delete the account. Clerk's own retention applies to its logs. | You, by deleting the account (Grill calls Clerk's delete). Clerk, under their policy. | No sign-in. |
| Verified email | On the Grill account row in Upstash, and as a one-way hash used so one email cannot mint two starter keys. For an agent allowed through their owner, that hash is the owner's email, so one person's agents share one starter key. | Until you delete the account that holds the cap | You, by deleting that account | Not collected. |
| Owner email, for an AgentID sign-in | Read from AgentID only to check the invite list and to key the per-person starter cap. Cached in Upstash for about 10 minutes. Also kept on the agent account row so deleting the account that holds the cap clears the right hash. Not logged. Not shown on the account page. | The cache expires in about 10 minutes. The copy on the account row lasts until that account is deleted. | The cache expires on its own. Deleting the account that holds the cap removes the hash. | Not collected. |
| Model-router key | Created on Grill's OpenRouter account, hard-capped (default $1, no refill). Stored encrypted with `GRILL_KEY_ENCRYPTION_KEY`. The raw key is not shown and is not returned to the chat. | Until you delete the account, which revokes the key | You, by deleting the account. Grill, by revoking it. | Your own key, on your computer. Grill does not hold it. |
| Spend of that key | Cost, time, and the served model of each grill (the last 400), in Upstash keyed to the account id, and on OpenRouter's usage for that key. No write-up and no report text. | Account lifetime, then gone with the account. OpenRouter keeps its own billing record. | You, by deleting the account. OpenRouter, under their billing retention. | On your own OpenRouter account, if you look. Grill does not copy it. |
| Monthly spend counters for the caps | Upstash. One number for the whole service per month, and one per person per month keyed to a one-way hash of the email the starter credit belongs to. A number only: no email, no text, no model. | About 40 days, then they expire. The per-person counter is not cleared when you delete the account, so deleting and re-joining can't reset the month's cap. | They expire on their own. | None. |
| Running-job counter and daily count | Upstash. Opaque job ids and a number. No text. | The running set expires in 15 minutes. The daily count expires in two days. | They expire. Deleting the account removes the account row, not a counter that already expired. | None. |
| Active-user counts | Upstash HyperLogLog keys, one per UTC day, ISO week and month. Each holds an approximate count of distinct people who made a tool call. The member added is a keyed hash (HMAC-SHA256, salted with a server secret) of the person the starter credit belongs to: not the email, not the account id, and not matchable to an email without the secret. A HyperLogLog cannot list its members back. No text, no model, no time of day. | Day keys about 120 days, week keys about 400 days, month keys about 800 days, then they expire. | They expire on their own. Deleting the account does not remove the hash from a count, and nothing in a count can be traced back to the account. | None. |

## What does not leave

- The write-up is not logged, and not stored.
- A token in the query string is rejected. Grill reads a bearer token from the header only.
- The "Your habits" section on `/decisions` is worked out from that person's own records and drafts each time the page loads. It is not stored, not logged and not counted, and only that person sees it.
- Account pages load no analytics script. The website's visit counter is not on `/decisions` or `/account`.
- The judge is not the host chat's model. The request is `openrouter/auto`, with one company excluded, and no pinned model list.
- Records you did not agree to keep are not written. A record is not written until you state a choice. If you never answer, the draft expires and no look-back is scheduled.

## Compared with the local tool

The installed tool has no account. The only thing that leaves your machine is the decision as you stated it, and it goes to the model router (and to Jev, if the quality check is on). Grill does not see it. There is no look-back database.

The in-chat account adds a server in the middle, a sign-in company (Clerk), a store (Upstash), and a key Grill holds. It adds those so a chat can grill without a key on your computer, and so you can keep records if you say yes. It does not add a copy of the write-up. That sentence is the line that must stay true: the decision, as you stated it, passes through Grill's server in memory. It is never logged or stored.
