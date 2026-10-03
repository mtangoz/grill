# Data ledger: Grill in your chat

Update this file in the same pull request whenever the hosted data flow changes. The installed tool is not this table. Its privacy stance is unchanged and is the comparison column on the right.

Hosted mode is off unless `GRILL_HOSTED=on`. When it is on, it is invite-only.

The approved write-up passes through Grill's server in memory. It is never logged or stored.

## What leaves the machine

| What | Where it goes | How long | Who can delete it | Installed tool, for comparison |
|---|---|---|---|---|
| The approved write-up | Through Grill's server memory, then to OpenRouter and the judge, with `provider: { zdr: true, data_collection: "deny" }`. Not written to a log or a store. | The length of that grill, in memory only | There is nothing to delete. A process restart drops it. | Goes from your computer straight to OpenRouter. Grill's server never sees it. |
| The question, if you set one | Same path as the write-up | Same | Same | Same, and Grill's server never sees it. |
| Masked write-up and the report, when the quality check is on (the default) | Jev, at TypeSafe, through OpenRouter's decisions endpoint. Zero-retention, and dropped if any other endpoint answers. Skip one grill by saying so. | Not stored by Grill | Not a Grill copy. TypeSafe does not retain it. | The installed tool sends the same check from your computer. |
| The full report | Encrypted in Upstash Redis. The key is inside the job id returned to the chat, not stored beside the ciphertext. | At most 15 minutes. Reading it deletes it. The key expires with the job. | You collect it and it is deleted. Grill can flush the Redis entry. Operators cannot read it without the job id, which Grill does not keep. | Stays in the chat. Grill stores nothing. |
| Decision record (the version 1 block, top 3 challenge lines, and look-back answers) | Encrypted in Upstash Redis, only if you choose to keep records. A per-person key is wrapped with `GRILL_RECORD_KEY`. | Until you delete it, or delete the account | You, from `/decisions` (one record, a chain, or all) or by deleting the account. Grill's operators hold `GRILL_RECORD_KEY`, so they could decrypt records. Say so if you ask. | Not stored. You copy the block into your own notes. |
| `source_app` on that record | Inside the same encrypted record | Same | Same | The installed tool does not write this line. |
| What you decided, and a supersedes / changed line | Inside the same encrypted record, only in words you gave | Same | Same | Not stored. |
| Sign-in | Clerk. Email, and the sign-in event. Google or an emailed code. | Until you delete the account. Clerk's own retention applies to its logs. | You, by deleting the account (Grill calls Clerk's delete). Clerk, under their policy. | No sign-in. |
| Verified email | On the Grill account row in Upstash, and as a one-way hash used so one email cannot mint two starter keys | Until you delete the account | You, by deleting the account | Not collected. |
| Model-router key | Created on Grill's OpenRouter account, hard-capped (default $1, no refill). Stored encrypted with `GRILL_KEY_ENCRYPTION_KEY`. The raw key is not shown and is not returned to the chat. | Until you delete the account, which revokes the key | You, by deleting the account. Grill, by revoking it. | Your own key, on your computer. Grill does not hold it. |
| Spend of that key | Cost, time, and the served model of each grill, on the account row, and on OpenRouter's usage for that key. No write-up and no report text. | Account lifetime, then gone with the account. OpenRouter keeps its own billing record. | You, by deleting the account. OpenRouter, under their billing retention. | On your own OpenRouter account, if you look. Grill does not copy it. |
| Running-job counter and daily count | Upstash. Opaque job ids and a number. No text. | The running set expires in 15 minutes. The daily count expires in two days. | They expire. Deleting the account removes the account row, not a counter that already expired. | None. |

## What does not leave

- The write-up is not logged, and not stored.
- A token in the query string is rejected. Grill reads a bearer token from the header only.
- Account pages load no analytics script. The website's visit counter is not on `/decisions` or `/account`.
- The judge is not the host chat's model. The request is `openrouter/auto`, with one company excluded, and no pinned model list.
- Records you did not agree to keep are not written.

## Compared with the local tool

The installed tool has no account. The only thing that leaves your machine is the approved write-up, and it goes to the model router (and to Jev, if the quality check is on). Grill does not see it. There is no look-back database.

The in-chat account adds a server in the middle, a sign-in company (Clerk), a store (Upstash), and a key Grill holds. It adds those so a chat can grill without a key on your computer, and so you can keep records if you say yes. It does not add a copy of the write-up. That sentence is the line that must stay true: the approved write-up passes through Grill's server in memory. It is never logged or stored.
