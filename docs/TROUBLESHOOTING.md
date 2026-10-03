# If something's off

| You see | It means |
|---|---|
| "Grill isn't set up yet" | Your key is missing. Claude Desktop: **Settings → Extensions → Grill**. Grill reads `GRILL_API_KEY` first. `OPENROUTER_API_KEY` works when that is unset. |
| "no model router key" from `node scripts/judge.mjs` | Same: no key in `GRILL_API_KEY`, `OPENROUTER_API_KEY` or the key file. Save one once with `node scripts/judge.mjs --set-key` (paste it, press Enter, then Ctrl-D). `--key-status` says where the key comes from, without printing it. |
| A key that used to work is gone (for example from a project's `.env`) | A key can't be read back: OpenRouter shows it once, and CI secrets are write-only. Make a new one at [openrouter.ai/keys](https://openrouter.ai/keys) and save it with `--set-key`. The key file is outside every project, so rewriting a project's `.env` can't lose it again. |
| "Still grilling (job …)" | Normal. Claude collects the report itself; it takes 1–3 minutes |
| A 402 or credit error | Add credit at [openrouter.ai/credits](https://openrouter.ai/credits) |
| A warning banner in the report | The judge couldn't see everything, for example a subject that was too long. The report says what |

Look-back needs no key. If `grill_look_back` says it found no decision record, the paste needs a version 1 block: a fence tagged `grill-record`, then `version: 1`, then `date`, `title`, `verdict`, `falsifier`, `confidence` and `review`. `prediction` may be there too. `goal`, `guardrails` and `source_app` may be there too, after `review`, and a block without them still reads. The field list is in [docs/DECISION-RECORD.md](DECISION-RECORD.md). A block with no version line, or a different version, is not read.
