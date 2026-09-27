# Weekly review

Say **"run my weekly decision review"** in Claude. This is optional, and it is separate from a single grill.

Grill does not connect to your email, calendar or notes. Claude reads only the connectors you turn on (**Customize → Connectors**). What each one is for, and where a log can live: [CONNECTIONS.md](CONNECTIONS.md).

With those, the review can:

- list the decisions you made this week;
- ask you to put a number on each: what you expect, by when, and how sure you are;
- grill the one that matters most;
- bring back the ones whose results are in.

Your log lives where you choose: a Google Drive folder, a Notion database, or notes you already keep. If nothing is connected, the review runs on what you tell it.

**Install:** upload [weekly-review-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/weekly-review-skill.zip) the same way as the Grill skill, or add the plugin.

## Look back, with no log

Every grill ends with a version 1 decision record you can copy. The block is specified in [DECISION-RECORD.md](DECISION-RECORD.md). Paste one or more of those blocks back and say **look back**. Grill asks what happened, scores the calls, and says what the pattern is. That works on the paste route and in the MCP tool `grill_look_back`. Nothing is stored, and no connector is required.

## The monthly Count

Once a month, if the log has at least four calls due, you can place one number: how many of that set will come true. That bet is The Count, in `skills/weekly-review/the-count.md`. It needs the log. A single grill does not do it, and the paste route does not do it. With fewer than four calls, the review asks nothing and treats that as an ordinary thin month, not a shortfall.
