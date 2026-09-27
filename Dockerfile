# Glama builds this image and speaks MCP over stdio.
# No API key is required to start: tools/list answers either way.
# A grill needs GRILL_API_KEY. OPENROUTER_API_KEY is accepted when GRILL_API_KEY is unset.
FROM node:22-slim

WORKDIR /app
COPY --chown=node:node server/index.mjs server/index.mjs
COPY --chown=node:node scripts/judge.mjs scripts/judgeCore.mjs scripts/checkCore.mjs scripts/

USER node
ENTRYPOINT ["node", "server/index.mjs"]
