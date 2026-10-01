# Glama and Smithery build this image and speak MCP over stdio.
# No API key is required to start: tools/list answers either way.
# A grill needs GRILL_API_KEY. OPENROUTER_API_KEY is accepted when GRILL_API_KEY is unset.
FROM node:22-slim

WORKDIR /app
COPY --chown=node:node server/index.mjs server/index.mjs
COPY --chown=node:node scripts/judge.mjs scripts/judgeCore.mjs scripts/checkCore.mjs scripts/reflection.mjs scripts/usageStats.mjs scripts/
# Bake the image build's UTC day into RELEASE_DATE. The script is not part of the running server.
COPY --chown=node:node scripts/releaseDate.mjs scripts/releaseDate.mjs
RUN node --input-type=module -e 'import { stampReleaseDateFile } from "./scripts/releaseDate.mjs"; stampReleaseDateFile("server/index.mjs");' \
 && rm scripts/releaseDate.mjs \
 && chown node:node server/index.mjs

USER node
ENTRYPOINT ["node", "server/index.mjs"]
