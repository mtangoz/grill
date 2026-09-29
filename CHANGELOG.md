# Changelog

## 0.1.1

- Requests to OpenRouter send `HTTP-Referer: https://grillyour.ai` next to `X-Title: Grill`, so OpenRouter can show aggregate usage counts for the app. Decision text still goes only to OpenRouter.
- The Desktop extension manifest stays valid for Claude Desktop. The release also includes `grill-smithery.mcpb`, the same bundle with each tool's input schema from `tools/list`, for the Smithery registry.
- The optional judge model setting says to leave it blank for Grill's default, which picks a judge automatically from a different company than your assistant.
- `server.json` names the v0.1.1 bundle. Its checksum is still the published 0.1.0 file until that bundle exists.

## 0.1.0

- First release. An outside judge for a decision you approve, with zero-retention routing, a Desktop extension, and a paste route.
