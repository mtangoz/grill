# If something's off

| You see | It means |
|---|---|
| "Grill isn't set up yet" | Your key is missing. Claude Desktop: **Settings → Extensions → Grill**. Grill reads `GRILL_API_KEY` first. `OPENROUTER_API_KEY` works when that is unset. |
| "Still grilling (job …)" | Normal. Claude collects the report itself; it takes 1–3 minutes |
| A 402 or credit error | Add credit at [openrouter.ai/credits](https://openrouter.ai/credits) |
| A warning banner in the report | The judge couldn't see everything, for example a subject that was too long. The report says what |

Look-back needs no key. If `grill_look_back` says it found no decision record, the paste needs a version 1 block: a fence tagged `grill-record`, then `version: 1`, then `date`, `title`, `verdict`, `falsifier`, `confidence` and `review`. The field list is in [docs/DECISION-RECORD.md](DECISION-RECORD.md). A block with no version line, or a different version, is not read.
