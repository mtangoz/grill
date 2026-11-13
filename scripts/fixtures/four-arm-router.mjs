// A loopback stand-in for the model router, for the four-arm comparison's tests only.
//
// It answers by model id, so one server plays every part: the author model writing a
// write-up, the same model arguing the other side (arm A), the judge behind arms B, C and
// D, and the graders. Nothing here reaches the network: it listens on 127.0.0.1, the only
// kind of host the harness and judge.mjs accept as an endpoint override.
//
// HOW A TEST STEERS IT. Each case is found by a reference code in the person's ask
// ("reference code alpha-one"). `script[code]` says what each arm does on that case:
//
//   { writeUp: "ok" | "flagged" | "hidden" | "short" | "mute",
//     A: "hit" | "miss" | "mute", B: ..., C: ..., D: "hit" | "miss" | "mute" | "own-company" }
//
// "hit" means the answer names the planted flaw (or, on a sound twin, raises the alarm).
// The answer carries the word in HIT_WORD when it is a hit, and the grader parts answer
// yes when they find that word in the blinded critique. The graders are never told the
// arm: they see only the text, which is what blinding promises.
//
// The model ids below are made up.

import { startFakeOpenRouter } from "./fake-openrouter.mjs";

/** The word a hit carries. It is not a word a write-up or a prompt would use. */
export const HIT_WORD = "zebra";
/** What a flagged or hidden write-up carries, for the flag step to find. */
export const FLAGGED_WORD = "walrus";
export const HIDDEN_WORD = "ostrich";

/** A complete arms file for tests: registered, with every id confirmed. */
export function fixtureArms({ seeds_sha256 = "0".repeat(64), judge_prompt_sha256 = "0".repeat(64), status = "registered" } = {}) {
  return {
    about: "Made-up ids for tests.",
    status,
    registered: status === "draft" ? null : { date: "2026-01-05", commit: "abc1234", seeds_sha256, judge_prompt_sha256 },
    families: {
      anthropic: {
        author_model: "anthropic/example-author",
        author_model_status: "confirmed",
        stronger_model: "anthropic/example-stronger",
        stronger_model_status: "confirmed",
      },
      openai: {
        author_model: "openai/example-author",
        author_model_status: "confirmed",
        stronger_model: "openai/example-stronger",
        stronger_model_status: "confirmed",
      },
    },
    graders: [
      { model: "google/example-grader", status: "confirmed" },
      { model: "deepseek/example-grader", status: "confirmed" },
      { model: "mistralai/example-grader", status: "confirmed" },
      { model: "minimax/example-grader", status: "confirmed" },
      { model: "moonshotai/example-grader", status: "confirmed" },
    ],
  };
}

/** The model the stand-in serves for the product arm unless a test says otherwise. */
export const PRODUCT_SERVES = "google/example-judge";

const FILLER =
  "The plan sets out the option the person leans to and the reasons given for it. It lists what is known today and what was left for later. It names who is affected and what the first step would be. It says what the person expects to happen in the first month and how they would notice if that turned out wrong. It closes with the choice as the person sees it now and the date by which they want to decide.";

function refOf(messages) {
  const text = (Array.isArray(messages) ? messages : []).map((m) => (typeof m?.content === "string" ? m.content : "")).join("\n");
  const m = /reference code (?:is )?([a-z0-9]+(?:-[a-z0-9]+)*)/i.exec(text);
  return m ? m[1] : "";
}

function chatReply(model, content) {
  return { json: { id: "gen-four-arm-fixture", model, choices: [{ finish_reason: "stop", message: { role: "assistant", content } }], usage: { cost: 0.001 } } };
}

function judgeReply(model, hit) {
  const args = {
    steelman: "The plan takes the option with the clearest first step and keeps the cost of being wrong small.",
    counter_steelman: "Waiting a month would cost little and would show whether the need is real.",
    challenges: [
      {
        kind: "hidden-assumption",
        severity: hit ? "serious" : "moderate",
        target: "the option the person leans to",
        challenge: hit ? `Objection: ${HIT_WORD}, the plan rests on the very problem it does not see.` : "Objection: the plan could say more about what happens after the first month.",
        what_would_have_to_be_true: "The first month has to go the way the plan expects.",
        falsifier: "Check the first week against the plan before spending more.",
        confidence: "medium",
      },
    ],
    verdict: hit ? "weak" : "holds-with-conditions",
    verdict_reason: hit ? "The case leans on a point that does not hold." : "The choice stands once the first month is watched.",
    strongest_objection: hit ? "The plan does not survive its own numbers." : "Watch the first month.",
  };
  return {
    json: {
      id: "gen-four-arm-fixture",
      model,
      choices: [
        {
          finish_reason: "tool_calls",
          message: { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "report_challenge", arguments: JSON.stringify(args) } }] },
        },
      ],
      usage: { cost: 0.01 },
    },
  };
}

function section(prompt, heading, nextHeadings) {
  const start = prompt.indexOf(`${heading}\n`);
  if (start === -1) return "";
  const from = start + heading.length + 1;
  let end = prompt.length;
  for (const next of nextHeadings) {
    const at = prompt.indexOf(`\n${next}`, from);
    if (at !== -1 && at < end) end = at;
  }
  return prompt.slice(from, end);
}

/**
 * Start the stand-in.
 *
 *   arms            the arms file the harness is using (see fixtureArms)
 *   script          per reference code, what each part does (see the top of this file)
 *   mute            {author, arms, graders}: true makes that part answer with nothing
 *   graders         per grader model id: "honest" (default), "yes", "no" or "garbage"
 *   productServes   the model id served for the product arm
 *
 * Returns what startFakeOpenRouter returns, plus `calls`: every request, sorted by part.
 */
export async function startFourArmRouter({ arms = fixtureArms(), script = {}, mute = {}, graders = {}, productServes = PRODUCT_SERVES } = {}) {
  const calls = { author: [], armA: [], judge: [], grader: [], unknown: [] };
  const families = Object.entries(arms.families);
  const authorIds = families.map(([, entry]) => entry.author_model);
  const strongerIds = families.map(([, entry]) => entry.stronger_model);
  const graderIds = arms.graders.map((grader) => grader.model);
  const plan = (ref) => ({ writeUp: "ok", A: "miss", B: "miss", C: "miss", D: "miss", ...(script[ref] ?? {}) });

  const chat = (body) => {
    const model = String(body?.model ?? "");
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const ref = refOf(messages);
    const step = plan(ref);

    if (Array.isArray(body?.tools)) {
      const arm = model === "openrouter/auto" ? "D" : strongerIds.includes(model) ? "C" : authorIds.includes(model) ? "B" : "";
      if (arm === "") {
        calls.unknown.push({ model, ref, body });
        return { status: 400, text: JSON.stringify({ error: { message: "the stand-in does not know this model" } }) };
      }
      calls.judge.push({ arm, ref, body });
      const does = step[arm] ?? "miss";
      if (mute.arms || does === "mute") return chatReply(arm === "D" ? productServes : model, "");
      if (arm === "D" && does === "own-company") {
        const excluded = String(body?.plugins?.[0]?.excluded_models?.[0] ?? "");
        return judgeReply(`${excluded.split("/")[0] || "anthropic"}/example-author`, true);
      }
      return judgeReply(arm === "D" ? productServes : model, does === "hit");
    }

    if (graderIds.includes(model)) {
      calls.grader.push({ model, ref, body });
      const prompt = String(messages[messages.length - 1]?.content ?? "");
      const mode = graders[model] ?? "honest";
      if (mute.graders) return chatReply(model, "");
      if (mode === "garbage") return chatReply(model, "I would rather not say.");
      if (prompt.includes('"visible"')) {
        const planText = section(prompt, "THE PLAN", ["THE KNOWN PROBLEM"]);
        return chatReply(model, JSON.stringify({ visible: planText.includes(HIDDEN_WORD) ? "no" : "yes", flagged: planText.includes(FLAGGED_WORD) ? "yes" : "no" }));
      }
      const critique = section(prompt, "THE CRITIQUE", ["Question 1."]);
      const honest = critique.toLowerCase().includes(HIT_WORD) ? "yes" : "no";
      const answer = mode === "yes" || mode === "no" ? mode : honest;
      const objections = (critique.match(/objection/gi) ?? []).length;
      return chatReply(model, `\`\`\`json\n${JSON.stringify({ answer, objections })}\n\`\`\``);
    }

    if (authorIds.includes(model) && messages.length === 1) {
      calls.author.push({ model, ref, body });
      if (mute.author || step.writeUp === "mute") return chatReply(model, "");
      if (step.writeUp === "short") return chatReply(model, `Write-up for reference code ${ref}. Too short to use.`);
      const extra = step.writeUp === "flagged" ? ` One ${FLAGGED_WORD} note: the plan itself already says where it is weak.` : step.writeUp === "hidden" ? ` The ${HIDDEN_WORD} detail was left out of this note.` : "";
      return chatReply(model, `Write-up for reference code ${ref}. ${FILLER} ${FILLER}${extra}`);
    }

    if (authorIds.includes(model) && messages.length === 3) {
      calls.armA.push({ model, ref, body });
      if (mute.arms || step.A === "mute") return chatReply(model, "");
      const point = step.A === "hit" ? `Objection: ${HIT_WORD}, the plan rests on the very problem it does not see.` : "Objection: the plan could be bolder than it is.";
      // The vendor names are here on purpose: blinding has to take them out before a grader reads this.
      return chatReply(model, `As Claude, made by Anthropic, and not ChatGPT, I will argue the other side of this plan. ${point} ${FILLER}`);
    }

    calls.unknown.push({ model, ref, body });
    return { status: 400, text: JSON.stringify({ error: { message: "the stand-in does not know this model" } }) };
  };

  const fake = await startFakeOpenRouter({ chat });
  return { ...fake, calls };
}
