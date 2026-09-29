#!/bin/sh
# Append one Pro-interest line to metrics.jsonl. These numbers are not users.
# Requires the Upstash env vars. Does not send email.
cd "$(dirname "$0")/.." || exit 1
node scripts/notify-interest.mjs >> metrics.jsonl
