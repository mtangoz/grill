// The contribute page lists shipped changes. A name is shown only when consent is exactly true.
// data/contributors.json starts as []. The owner adds a name only after that person agrees.
// Credit is the product feedback. A person's own decision is never a field this renders.

const ESCAPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ESCAPE[c]);
}

function entryLink(link) {
  if (typeof link !== "string" || !link.trim()) {
    throw new Error("each entry needs an https link to a pull request or the changelog");
  }
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error("each entry needs an https link to a pull request or the changelog");
  }
  const pullRequest = url.hostname === "github.com" && /^\/mtangoz\/grill\/pull\/\d+$/.test(url.pathname);
  const changelog = url.hostname === "github.com" && /^\/mtangoz\/grill\/blob\/[^/]+\/CHANGELOG\.md$/.test(url.pathname);
  const hashOk = url.hash === "" || /^#[A-Za-z0-9._-]+$/.test(url.hash);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    (url.port && url.port !== "443") ||
    !hashOk ||
    (!pullRequest && !changelog)
  ) {
    throw new Error("each entry needs an https link to a pull request or the changelog");
  }
  return { href: url.href, label: changelog ? "Changelog" : "Pull request" };
}

function renderOne(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("each contributor entry must be an object");
  }
  if (typeof entry.change !== "string" || !entry.change.trim()) {
    throw new Error("each entry needs a shipped change");
  }
  const change = entry.change.trim();
  const { href, label } = entryLink(entry.link);
  const consented = entry.consent === true;
  if (consented && typeof entry.credit !== "string") {
    throw new Error("a consented entry needs a name or handle");
  }
  const credit = typeof entry.credit === "string" ? entry.credit.trim() : "";
  if (!consented && credit && (change.includes(credit) || String(entry.link).includes(credit) || href.includes(credit))) {
    throw new Error("an entry without consent must not put the credit in the change or the link");
  }
  const who = consented && credit ? escapeHtml(credit) : "suggested by a tester";
  return `  <li>${escapeHtml(change)} <a href="${escapeHtml(href)}">${label}</a>. ${who}.</li>`;
}

/** HTML for the list. An empty list says so, and names nobody. */
export function renderContributorEntries(entries) {
  if (!Array.isArray(entries)) throw new Error("contributors must be a list");
  if (entries.length === 0) {
    return `<p class="note">Nothing is listed yet. A name is added only after that person agrees.</p>`;
  }
  return `<ul class="steps">\n${entries.map(renderOne).join("\n")}\n</ul>`;
}
