# Pull request automation

Two workflows watch pull requests into `main`. Auto-merge squash-merges a low-risk diff after the required checks pass. Grill CI sends every other diff from an allowlisted author to this repo's own judge and posts the result as one comment.

Both jobs check out the base commit and read the pull request through the GitHub API. Neither checks out the pull request branch, and neither runs that branch's code.

## Auto-merge when green

A low-risk pull request gets the `automerge` label. GitHub then squash-merges it after the required checks pass. Any other pull request loses that label, and auto-merge is turned off.

`scripts/automergeCore.mjs` makes the decision. `.github/workflows/automerge.yml` runs it when a pull request targeting `main` is opened, pushed to, reopened, marked ready for review, labeled, or unlabeled.

A follow-up push runs the check again. If the pull request no longer qualifies, the workflow disables auto-merge.

### When a pull request qualifies

Every rule has to hold.

- It is not a draft.
- The author is listed in `.github/automerge.json`. The list is `mtangoz`, `cursor[bot]` (the Cursor GitHub App, which opens automation and service-account pull requests), `cursoragent` (the Cursor cloud agent account, when it is the pull request author), `claude[bot]` (the Claude GitHub App at `github.com/apps/claude`, which is the login `anthropics/claude-code-action` uses), and `chatgpt-codex-connector[bot]` (OpenAI's ChatGPT Codex Connector at `github.com/apps/chatgpt-codex-connector`, the login that opens Codex pull requests). A pull request Claude Code or Codex opens under `mtangoz` is already covered by that login. Add another agent by appending its GitHub login to `authors` in that file. The classifier reads the file and does not keep its own copy of the list.
- It has neither the `do-not-merge` label nor the `needs-review` label.
- Every changed path is on the safe list below, and no blocked path is touched. A rename counts the old path and the new path.
- The diff is at most 300 changed lines and at most 15 files. Additions and deletions both count.
- Nothing in the diff is high risk. A high-risk path blocks auto-merge even when a safe pattern would also match.

### Safe paths

- `README.md`
- `LEARNING.md`
- `docs/**`, except the privacy note
- New files under `evals/cases/**`. An edit or a deletion of a case does not qualify.
- `site/page.html` only. That file is the onboarding page: the words and the styles, with no script and no request. `site/terms.html` is the terms page. `scripts/build-site.mjs` reads billing settings from `api/_pro.mjs`. `vercel.json` routes `/checkout`, `/pro/auth`, and the other account pages. None of those are copy.
- `.github/ISSUE_TEMPLATE/**`

### Paths that block auto-merge

These block even when a safe pattern would also match. Matching ignores case. `stripe`, `auth`, `key`, and `secret` match anywhere in the path, so `docs/author-guide.md` is blocked because it contains `auth`.

- `api/**`
- `scripts/judge*.mjs` and `scripts/checkCore*`
- `prompts/**`
- `manifest.json` and `server.json`
- `.claude-plugin/**` and `.mcp.json`
- `package.json` and lockfiles (`package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock`, `bun.lockb`), in any directory
- `.github/workflows/**` and `.github/automerge.json`
- `SECURITY.md` and `docs/PRIVACY.md`
- Terms and privacy pages: a file whose name is `terms` or `privacy`, or a folder with that name, including `site/terms.html`

Changes to these workflows and to the classifier are outside the safe list, so a pull request cannot loosen these rules and then merge itself.

### Opt out, or ask for a review

Add the `do-not-merge` label. The workflow removes `automerge` and disables auto-merge. Add `needs-review` for the same stop when you want a person to look. Grill CI also adds `needs-review` when a verdict is shaky or does not hold up. Take the label off and the next run can arm the pull request again, if the diff still qualifies.

A later solid grill clears `needs-review`. Use `do-not-merge` when that pull request should stay unmerged anyway.

Marking a pull request as a draft does not itself start the auto-merge workflow. GitHub will not squash-merge a draft. The next push, label change, or ready-for-review event runs the classifier again.

### What auto-merge writes

On a qualifying pull request it ensures the `automerge` label exists, enables squash auto-merge with `gh pr merge --auto --squash`, and posts one comment that says why the diff qualified. Otherwise it removes `automerge`, runs `gh pr merge --disable-auto` when auto-merge might be on, and updates that same comment with the rule that failed. The comment starts with `<!-- grill-automerge -->`.

## Risk tiers

`classify` returns `low`, `medium`, or `high`.

- **Low.** Every auto-merge rule holds. These pull requests are not grilled.
- **High.** The diff touches a high-risk path, or it changes more than 800 lines. High risk wins over every other signal, including a draft.
- **Medium.** Everything else that is not low: a draft, an unknown author, a blocking label, a path that is merely off the safe list (`package.json`, `.mcp.json`, the classifier, this policy file), or a diff of 301 to 800 lines.

High-risk paths, matched case-insensitively:

- `api/**`
- `scripts/judge*` and `scripts/checkCore*`
- `prompts/**`
- `manifest.json`, `server.json`, and `.claude-plugin/**`
- `.github/workflows/**`
- `SECURITY.md`, `docs/PRIVACY.md`, and terms or privacy pages
- A path containing `stripe`, `auth`, `key`, `secret`, or `payment`. `docs/author-guide.md` is high because it contains `auth`. `docs/payments.md` is high because it contains `payment`, and it does not auto-merge even though `docs/**` is otherwise safe.

A diff over 4,000 changed lines, or a diff body over 500,000 characters, is still high or medium, and Grill CI skips the judge. The caps live in `.github/automerge.json` (`highChangedLines`, `grillSkipChangedLines`, `grillSkipDiffChars`, `diffCharBudget`).

## Grill CI

`.github/workflows/grill-pr.yml` runs on `opened`, `synchronize`, `ready_for_review`, and `reopened` for a pull request into `main`. The job runs only when the pull request is not a draft and its head repository is this one. Forks are skipped because secrets are not available to them. Authors outside the allowlist are skipped with no comment.

The job checks out `github.event.pull_request.base.sha` and runs `scripts/grillPr.mjs` from that commit. The script reads the title, body, and changed-file list with `gh`, and the diff with `Accept: application/vnd.github.diff`. It writes a subject file under the runner temp directory and deletes it after the judge returns.

The subject tells the judge what the pull request claims (title and body), the risk tier and why, the changed files, and the diff. The diff is capped at 24,000 characters and the subject says when that cap cut it. Secret-shaped strings and contact details are stripped before the judge sees the text. The question passed to `scripts/judge.mjs` is: "Should this PR be merged as is? What could break, what's untested, and what's the cheapest check before merging?"

The judge runs with `OPENROUTER_API_KEY` set from the repository secret `GRILL_CI_OPENROUTER_KEY`. If that secret is missing, the job posts one comment that Grill CI is not configured and exits successfully. That comment does not record the head SHA, so the next push grills the pull request once the secret exists.

### Who is excluded from judging

Grill CI does not pin a judge model. It asks OpenRouter's Auto Router, `openrouter/auto`, and tells that router which company to keep out with `--author`, the same switch `scripts/judge.mjs` uses. `x-ai` is excluded on every run. The login map is `authorFamilies` in `.github/automerge.json`.

| Author | Writing model | Excluded |
| --- | --- | --- |
| `claude[bot]` | Anthropic | Anthropic, passed as `--author`. `x-ai` is still excluded after the run. |
| `chatgpt-codex-connector[bot]` | OpenAI | OpenAI, passed as `--author`. `x-ai` is still excluded after the run. |
| `mtangoz`, `cursor[bot]`, `cursoragent`, or any other login, with no `Written-by-model` line | Not known | `x-ai` only. `--author` is `x-ai`, so Anthropic is not excluded by default. |

A login that does not name a vendor can say which model wrote the pull request with one line in the body:

```
Written-by-model: anthropic/claude-opus-4
```

That vendor is then excluded, the same way a known login is. A `Written-by-model` line does not override `claude[bot]` or `chatgpt-codex-connector[bot]`.

`--author` names one family, and it replaces judge.mjs's default Anthropic exclusion. When the author company is known, that company is the family passed to `--author`, and `x-ai` is still on the post-run exclusion list. When the author company is unknown, `--author` is `x-ai`, so the router does not exclude Anthropic by default. The comment still says the author vendor is unknown.

After the run, Grill CI reads the model that actually answered. The comment shows `Author model vendor: X, judge: Y (different company ✓)`, including when the author is unknown. If that vendor is one of the excluded companies, the comment is marked NOT decorrelated, the pull request gets `needs-review`, and the job fails. A failed check is not treated as already grilled, so a later run tries again.

### What Grill CI writes

One comment, marked `<!-- grill-ci -->`. A later push updates that comment instead of posting another. The comment carries the verdict (`solid`, `solid if`, `shaky`, or `doesn't hold up`), the challenges and the cheapest check for each, the model that answered, the cost, and the risk tier.

A finished grill, a size skip, and a low-risk follow-up that replaces an older grill comment record the head SHA. The same SHA is not sent to the judge again. A degraded run is posted as "no review" and changes no labels.

Labels:

- `shaky` or `doesn't hold up` adds `needs-review` and removes `grill-solid`. `needs-review` is a blocking label, so auto-merge turns off.
- `solid` or `solid if` adds `grill-solid` and removes `needs-review`. `grill-solid` does not make the pull request low risk.
- A low-risk follow-up does not clear labels. Remove `needs-review` yourself if that diff should auto-merge.

The verdict is advisory. The job passes for a solid verdict and for a shaky one. It fails when the judge run errors, and it fails when the model that answered is from an excluded company. It does not block merging unless branch protection is later told to require it. `needs-review` still blocks auto-merge.

## Repository settings

1. In **Settings → General → Pull Requests**, turn on **Allow auto-merge** and **Allow squash merging**.
2. On `main`, require status checks before merging. From `.github/workflows/ci.yml`, require these check names:
   - `test (20)`
   - `test (22)`
   The `test` job's matrix is `node: [20, 22]`, and GitHub publishes each cell under that name. Do not require the `automerge` job (`gate`) or the Grill CI job (`grill`).
3. Leave required reviews off if low-risk pull requests should merge with nobody approving. A required review holds auto-merge until someone approves.
4. Add a repository secret named `GRILL_CI_OPENROUTER_KEY` with an OpenRouter API key. Grill CI reads it as `OPENROUTER_API_KEY` for `scripts/judge.mjs`.

Fork pull requests run with a read-only token, so auto-merge cannot arm them, and Grill CI does not start. Until `scripts/automerge.mjs` or `scripts/grillPr.mjs` exists on `main`, a pull request that introduces it finds nothing to run on the base commit and leaves the pull request alone.
