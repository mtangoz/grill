/**
 * Grill's learning signal, the way OpenRouter's router learns: from aggregate, anonymous choices,
 * never from content.
 *
 * A signal is a GitHub issue filed through .github/ISSUE_TEMPLATE/grill-signal.yml, a form made
 * only of dropdowns. This module parses those issues and aggregates them. It accepts a signal
 * only when every field is one of the form's own options. An issue whose body was edited to carry
 * anything else is dropped whole, so free text can't enter the tally even by hand.
 *
 * Two questions it answers for the maintainer:
 *   1. Which judges help? The "worth engaging" rate by judge family, and by kind of decision.
 *   2. Do verdicts predict outcomes? For resolved calls: how often each verdict's call came true.
 * Its output is recommendations in an issue, never an automatic change. Any change it suggests
 * (excluding a judge family, reworking the prompt) must also pass the synthetic evals.
 */

export const FIELDS = Object.freeze({
  event: { label: "Event", options: ["rated", "resolved"], required: true },
  category: {
    label: "Kind of decision",
    options: ["pricing", "hiring", "fundraising", "product", "timing", "vendor", "operations", "personal", "other"],
    required: true,
  },
  judge: {
    label: "Judge family",
    options: ["openai", "google", "deepseek", "meta", "mistral", "qwen", "xai", "moonshot", "other", "paste-route"],
    required: true,
  },
  verdict: { label: "Verdict", options: ["solid", "solid if", "shaky", "doesn't hold up"], required: true },
  rating: { label: "Worth engaging?", options: ["yes", "no", "not-asked"] },
  confidence: { label: "Your confidence when you made the call", options: ["under-30", "30-49", "50-69", "70-89", "90-plus", "none"] },
  outcome: { label: "Did it come true? (resolved only)", options: ["yes", "no", "unclear", "not-yet"] },
  client: { label: "Where you used Grill", options: ["desktop", "web", "phone", "code"] },
});

const NO_RESPONSE = "_No response_";

/** Older signal issues used the tool's internal verdict names. They still count, under the public names. */
const LEGACY_VERDICT = Object.freeze({
  holds: "solid",
  "holds-with-conditions": "solid if",
  weak: "shaky",
  refuted: "doesn't hold up",
});

/** Parse one issue body rendered from the form. Returns the signal, or null if anything is off-form. */
export function parseSignal(body) {
  if (typeof body !== "string") return null;
  const sections = body.split(/^### /m).slice(1);
  const byLabel = new Map();
  for (const section of sections) {
    const nl = section.indexOf("\n");
    const label = (nl === -1 ? section : section.slice(0, nl)).trim();
    const value = (nl === -1 ? "" : section.slice(nl + 1)).trim();
    byLabel.set(label, value);
  }
  const known = new Set(Object.values(FIELDS).map((f) => f.label));
  for (const label of byLabel.keys()) if (!known.has(label)) return null; // an added section
  const signal = {};
  for (const [id, field] of Object.entries(FIELDS)) {
    const raw = byLabel.get(field.label);
    if (raw === undefined || raw === "" || raw === NO_RESPONSE) {
      if (field.required) return null;
      continue;
    }
    const value = id === "verdict" && LEGACY_VERDICT[raw] ? LEGACY_VERDICT[raw] : raw;
    if (!field.options.includes(value)) return null; // free text, or an option the form never offered
    signal[id] = value;
  }
  return signal;
}

const rate = (yes, n) => (n === 0 ? null : yes / n);

/** Aggregate parsed signals. Pure. */
export function aggregate(signals) {
  const rated = signals.filter((s) => s.event === "rated" && (s.rating === "yes" || s.rating === "no"));
  const byJudge = {};
  const byJudgeCategory = {};
  for (const s of rated) {
    const j = (byJudge[s.judge] ??= { yes: 0, n: 0 });
    j.n += 1;
    if (s.rating === "yes") j.yes += 1;
    const key = `${s.judge} · ${s.category}`;
    const jc = (byJudgeCategory[key] ??= { yes: 0, n: 0 });
    jc.n += 1;
    if (s.rating === "yes") jc.yes += 1;
  }
  const resolved = signals.filter((s) => s.event === "resolved" && (s.outcome === "yes" || s.outcome === "no"));
  const byVerdict = {};
  for (const s of resolved) {
    const v = (byVerdict[s.verdict] ??= { cameTrue: 0, n: 0 });
    v.n += 1;
    if (s.outcome === "yes") v.cameTrue += 1;
  }
  const overallYes = rated.filter((s) => s.rating === "yes").length;
  return {
    counts: { signals: signals.length, rated: rated.length, resolved: resolved.length },
    worthEngaging: { overall: rate(overallYes, rated.length), byJudge, byJudgeCategory },
    verdictOutcomes: byVerdict,
  };
}

/** Recommendations, never actions. Thresholds favour silence on thin data. */
export function recommend(agg, { minN = 10 } = {}) {
  const out = [];
  const overall = agg.worthEngaging.overall;
  for (const [judge, { yes, n }] of Object.entries(agg.worthEngaging.byJudge)) {
    const r = rate(yes, n);
    if (n >= minN && overall !== null && overall >= 0.7 && r < 0.5) {
      out.push(
        `Judge family \`${judge}\` is rated worth engaging ${Math.round(r * 100)}% of the time (n=${n}), against ${Math.round(overall * 100)}% overall. Consider excluding it from the auto-router, and run the evals before merging.`,
      );
    }
  }
  const good = ["solid", "solid if"].map((v) => agg.verdictOutcomes[v]).filter(Boolean);
  const bad = ["shaky", "doesn't hold up"].map((v) => agg.verdictOutcomes[v]).filter(Boolean);
  const sum = (xs) => xs.reduce((a, x) => ({ cameTrue: a.cameTrue + x.cameTrue, n: a.n + x.n }), { cameTrue: 0, n: 0 });
  const g = sum(good);
  const b = sum(bad);
  if (g.n >= minN && b.n >= minN && rate(b.cameTrue, b.n) >= rate(g.cameTrue, g.n)) {
    out.push(
      `Verdicts don't predict outcomes yet: calls judged shaky or doesn't hold up came true ${Math.round(rate(b.cameTrue, b.n) * 100)}% of the time (n=${b.n}), against ${Math.round(rate(g.cameTrue, g.n) * 100)}% for solid or solid if (n=${g.n}). Review the judge prompt against the evals.`,
    );
  }
  return out;
}

/** The monthly report, as markdown. No subject text exists anywhere in its inputs. */
export function renderReport(agg, recs, { dropped = 0, period = "" } = {}) {
  const pct = (r) => (r === null ? "–" : `${Math.round(r * 100)}%`);
  const lines = [`# Grill learning report${period ? `: ${period}` : ""}`, ""];
  lines.push(
    `${agg.counts.signals} signals (${agg.counts.rated} rated, ${agg.counts.resolved} resolved)${dropped ? `; ${dropped} dropped as off-form` : ""}.`,
    "",
  );
  lines.push("## Worth engaging, by judge family", "", "| Judge | Rated | Worth engaging |", "|---|---|---|");
  for (const [j, { yes, n }] of Object.entries(agg.worthEngaging.byJudge).sort((a, b) => b[1].n - a[1].n)) {
    lines.push(`| ${j} | ${n} | ${pct(rate(yes, n))} |`);
  }
  lines.push(`| **all** | ${agg.counts.rated} | ${pct(agg.worthEngaging.overall)} |`, "");
  lines.push("## Do verdicts predict outcomes?", "", "| Verdict | Resolved | Came true |", "|---|---|---|");
  for (const v of ["solid", "solid if", "shaky", "doesn't hold up"]) {
    const x = agg.verdictOutcomes[v];
    if (x) lines.push(`| ${v} | ${x.n} | ${pct(rate(x.cameTrue, x.n))} |`);
  }
  lines.push("", "## Recommendations", "");
  lines.push(...(recs.length ? recs.map((r) => `- ${r}`) : ["- None yet: too few signals to justify a change."]));
  lines.push("", "_Every change these suggest must also pass the synthetic evals before it merges._", "");
  return lines.join("\n");
}
