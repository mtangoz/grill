# Security

Grill runs on your machine with your model-router key, so a flaw in it matters.

**Report a vulnerability privately:** use **Report a vulnerability** on this repo's Security tab, or email hello@hold.quest. Please don't open a public issue.

**In scope:** anything that could leak a key or a write-up, send data anywhere but the model router, or let a release differ from this source. Each release carries checksums and, from the first public release, a signed build-provenance attestation (`gh attestation verify <file> --repo mtangoz/grill`).
