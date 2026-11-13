// OpenAI's plugin review reads every hosted tool description and every input-schema
// field description. Those strings may ask for the decision and a short summary of
// the context that matters. They must not ask for the conversation itself.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGrillTools } from "../server/index.mjs";
import { hostedTools } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Phrases that ask an assistant to hand over chat contents. A sentence that
// forbids them ("do not include the full conversation") is not a request.
const REQUESTING_PHRASES = ["whatever context", "conversation history", "full chat", "already in the chat"];

const BRIEF_CONTEXT = /brief, user-relevant summary of the essential context/;
const FEW_SENTENCES = /at most a few sentences/i;
const DO_NOT_INCLUDE =
  "Do not include the full conversation, chat history, transcripts, memories or unrelated personal data.";

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function negatedBefore(sentence, phrase) {
  const lower = sentence.toLowerCase();
  const at = lower.indexOf(phrase);
  if (at < 0) return false;
  return /\b(do not|don't|never|omit|without|must not|not include)\b/.test(lower.slice(0, at));
}

/** Copy the assistant reads: the tool description and each input field description. */
function assistantCopy(tool) {
  const rows = [{ where: `${tool.name} description`, text: String(tool.description || "") }];
  const properties = tool.inputSchema?.properties ?? {};
  for (const [name, schema] of Object.entries(properties)) {
    if (schema && typeof schema.description === "string") {
      rows.push({ where: `${tool.name}.${name}`, text: schema.description });
    }
  }
  return rows;
}

/** The requesting phrases a text uses without forbidding them, sentence by sentence. */
function requestingPhrasesIn(text) {
  const found = [];
  for (const sentence of sentences(text)) {
    const lower = sentence.toLowerCase();
    for (const phrase of REQUESTING_PHRASES) {
      if (lower.includes(phrase) && !negatedBefore(sentence, phrase)) found.push(`"${phrase}": ${sentence}`);
    }
  }
  return found;
}

function requestingHits(tools) {
  const hits = [];
  for (const tool of tools) {
    for (const row of assistantCopy(tool)) {
      for (const sentence of sentences(row.text)) {
        const lower = sentence.toLowerCase();
        for (const phrase of REQUESTING_PHRASES) {
          if (lower.includes(phrase) && !negatedBefore(sentence, phrase)) {
            hits.push(`${row.where} requests "${phrase}": ${sentence}`);
          }
        }
        // "the chat" / "this chat" as a source of material, not the judge model
        // and not a place to show a line ("not in the chat reply").
        const mentionsChat = /\b(the|this) chat\b/.test(lower);
        const safeChat =
          /this chat's own model/.test(lower) || /chat reply/.test(lower) || negatedBefore(sentence, "chat");
        if (mentionsChat && !safeChat) hits.push(`${row.where} requests chat contents: ${sentence}`);
      }
    }
  }
  return hits;
}

describe("MCP tool copy does not ask for the conversation", () => {
  const local = buildGrillTools({ checkOn: true });
  const hosted = hostedTools();

  for (const [label, tools] of [
    ["local", local],
    ["hosted", hosted],
  ]) {
    it(`${label} tool descriptions and field descriptions do not request the conversation`, () => {
      assert.deepEqual(requestingHits(tools), []);
    });
  }

  it("hosted grill asks only for the decision and a few sentences of essential context", () => {
    const grill = hosted.find((tool) => tool.name === "grill");
    assert.ok(grill, "hosted tools include grill");
    for (const text of [grill.description, grill.inputSchema.properties.subject.description]) {
      assert.match(text, /Send the decision|The decision text/);
      assert.match(text, BRIEF_CONTEXT);
      assert.match(text, FEW_SENTENCES);
      assert.ok(text.includes(DO_NOT_INCLUDE), text);
    }
    assert.match(grill.description, /Do not wait for an OK/);
    assert.match(grill.description, /at most one short question/);
    assert.match(grill.description, /Never add a required question before the verdict/);
    assert.match(grill.description, /quick or bulk/);
    assert.match(grill.description, /Ask only what the subject strictly needs/);
    assert.match(grill.inputSchema.properties.question.description, /Leave it empty/);
    assert.match(grill.inputSchema.properties.question.description, /Do not invent one/);
    assert.match(grill.inputSchema.properties.big.description, /Never ask whether it is big/);
  });

  it("the other hosted tools do not ask for chat contents either", () => {
    const names = hosted.map((tool) => tool.name);
    assert.deepEqual(names, ["grill", "grill_result", "grill_look_back", "grill_decided", "grill_feedback"]);
    const others = hosted.filter((tool) => tool.name !== "grill");
    assert.equal(others.length, 4);
    assert.deepEqual(requestingHits(others), []);
  });

  // The skill and the copy-and-paste prompt are instructions an assistant follows too.
  // They are not tool descriptions, but they say what to send, so the same phrases are out.
  it("the grill skill and the copy-and-paste prompt do not ask for the conversation either", () => {
    const old = "1. **Send the decision as I stated it,** with whatever context is already in the chat.";
    assert.equal(requestingPhrasesIn(old).length, 2, "the check catches the sentence the prompt used to carry");
    assert.deepEqual(requestingPhrasesIn("Do not include whatever context is already in the chat."), []);
    const skill = readFileSync(join(ROOT, "skills/grill/SKILL.md"), "utf8");
    const prompt = readFileSync(join(ROOT, "prompts/grill.md"), "utf8");
    for (const [file, text] of [
      ["skills/grill/SKILL.md", skill],
      ["prompts/grill.md", prompt],
    ]) {
      assert.deepEqual(requestingPhrasesIn(text), [], `${file} asks for the conversation`);
      assert.match(text, FEW_SENTENCES, `${file} does not cap the context at a few sentences`);
    }
    assert.match(skill, BRIEF_CONTEXT);
    assert.ok(skill.includes(DO_NOT_INCLUDE));
    assert.ok(
      prompt.includes("**Send the decision as I stated it,** plus a brief summary of the essential context, at most a few sentences."),
      "prompts/grill.md should ask for a brief summary of the essential context",
    );
  });
});
