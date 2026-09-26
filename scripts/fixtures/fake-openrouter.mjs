// A loopback stand-in for the two OpenRouter endpoints judge.mjs can reach, for tests only.
//
// One server answers both paths, the way the real host does, and records every request it
// receives, so a test can assert what was sent where — and that a path was never hit at all.
// Nothing here reaches the real network: it listens on 127.0.0.1, which is the only kind of
// host judge.mjs will accept as an endpoint override.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";

export const CHAT_PATH = "/api/v1/chat/completions";
export const DECISIONS_PATH = "/api/alpha/decisions";

const USABLE = readFileSync(new URL("./usable-response.json", import.meta.url), "utf8");

/**
 * A decisions response answering every question in `request`, in the documented shape:
 * nouls at `noul`, scores at `score`, choices on their first option. `answers` overrides or
 * adds individual answers; `provider` lets a test impersonate an endpoint off the allowlist.
 */
export function typesafeAnswer(request, { provider = "TypeSafe", noul = 0.9, score = 1.8, cost = 0.00021, answers = {} } = {}) {
  const out = {};
  for (const [name, q] of Object.entries(request?.questions ?? {})) {
    if (q.type === "noul") out[name] = { type: "noul", noul };
    else if (q.type === "score") {
      out[name] = { type: "score", score, confidence: 0.8, probabilities: [0.05, 0.1, 0.85], legend: q.criteria };
    } else if (q.type === "choice") {
      const choice = Object.keys(q.criteria)[0];
      out[name] = { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
    }
  }
  return {
    id: "dec-fixture",
    model: "typesafe/jev-1.13",
    provider,
    answers: { ...out, ...answers },
    usage: { input_tokens: 1200, output_tokens: 24, cost },
  };
}

/**
 * Start the server. `chat` and `decisions` each map a parsed request body to a reply:
 * `{json}` or `{status, text}` to answer, `{stall: true}` to send headers and never finish the
 * body, or `{redirect: url}` to answer 307. By default the chat path returns the usable judge
 * fixture and the decisions path answers every question as TypeSafe.
 */
export async function startFakeOpenRouter({ chat, decisions } = {}) {
  const seen = { chat: [], decisions: [], other: [] };
  const handlers = {
    chat: chat ?? (() => ({ text: USABLE })),
    decisions: decisions ?? ((body) => ({ json: typesafeAnswer(body) })),
    other: () => ({ status: 404, text: "" }),
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        // recorded raw; a test that cares asserts on it
      }
      const route = req.url === CHAT_PATH ? "chat" : req.url === DECISIONS_PATH ? "decisions" : "other";
      seen[route].push({ url: req.url, headers: req.headers, raw, body });
      const reply = handlers[route](body) ?? {};
      if (reply.stall) {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"answers":'); // and never res.end()
        return;
      }
      if (reply.redirect) {
        res.writeHead(307, { Location: reply.redirect });
        res.end();
        return;
      }
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(reply.text ?? JSON.stringify(reply.json));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    seen,
    base,
    env: { JUDGE_OPENROUTER_URL: `${base}${CHAT_PATH}`, JUDGE_DECISIONS_URL: `${base}${DECISIONS_PATH}` },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
