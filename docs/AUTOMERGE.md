# Auto-merge when green

A low-risk pull request into `main` gets the `automerge` label. GitHub then squash-merges it after the required checks pass. Any other pull request loses that label, and auto-merge is turned off.

`scripts/automergeCore.mjs` makes the decision. `.github/workflows/automerge.yml` runs it on pull requests targeting `main` when they are opened, pushed to, reopened, marked ready for review, labeled, or unlabeled. The job checks out the base commit and reads the changed-file list from the GitHub API. It does not check out the pull request branch and does not run that branch's code.

A follow-up push runs the check again. If the pull request no longer qualifies, the workflow disables auto-merge.

## When a pull request qualifies

Every rule has to hold.

- It is not a draft.
- The author is listed in `.github/automerge.json`. The list is `mtangoz`, `cursor[bot]` (the Cursor GitHub App, which opens automation and service-account pull requests), `cursoragent` (the Cursor cloud agent account, when it is the pull request author), `claude[bot]` (the Claude GitHub App at `github.com/apps/claude`, which is the login `anthropics/claude-code-action` uses), and `chatgpt-codex-connector[bot]` (OpenAI's ChatGPT Codex Connector at `github.com/apps/chatgpt-codex-connector`, the login that opens Codex pull requests). A pull request Claude Code or Codex opens under `mtangoz` is already covered by that login. Add another agent by appending its GitHub login to `authors` in that file. The classifier reads the file and does not keep its own copy of the list.
- It has neither the `do-not-merge` label nor the `needs-review` label.
- Every changed path is on the safe list below, and no blocked path is touched. A rename counts the old path and the new path.
- The diff is at most 300 changed lines and at most 15 files. Additions and deletions both count.

## Safe paths

- `README.md`
- `LEARNING.md`
- `docs/**`, except the privacy note
- New files under `evals/cases/**`. An edit or a deletion of a case does not qualify.
- `site/page.html` only. That file is the onboarding page: the words and the styles, with no script and no request. `site/terms.html` is the terms page. `scripts/build-site.mjs` reads billing settings from `api/_pro.mjs`. `vercel.json` routes `/checkout`, `/pro/auth`, and the other account pages. None of those are copy.
- `.github/ISSUE_TEMPLATE/**`

## Paths that block auto-merge

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

Changes to this workflow and to the classifier are outside the safe list, so a pull request cannot loosen these rules and then merge itself.

## Opt out, or ask for a review

Add the `do-not-merge` label. The workflow removes `automerge` and disables auto-merge. Add `needs-review` for the same stop when you want a person to look. Take the label off and the next run can arm the pull request again, if the diff still qualifies.

Marking a pull request as a draft does not itself start this workflow. GitHub will not squash-merge a draft. The next push, label change, or ready-for-review event runs the classifier again.

## What the workflow writes

On a qualifying pull request it ensures the `automerge` label exists, enables squash auto-merge with `gh pr merge --auto --squash`, and posts one comment that says why the diff qualified. Otherwise it removes `automerge`, runs `gh pr merge --disable-auto` when auto-merge might be on, and updates that same comment with the rule that failed.

## Repository settings

1. In **Settings → General → Pull Requests**, turn on **Allow auto-merge** and **Allow squash merging**.
2. On `main`, require status checks before merging. From `.github/workflows/ci.yml`, require these check names:
   - `test (20)`
   - `test (22)`
   The `automerge` job (`gate`) is not one of them. The `test` job's matrix is `node: [20, 22]`, and GitHub publishes each cell under that name.
3. Leave required reviews off if these pull requests should merge with nobody approving. A required review holds auto-merge until someone approves.

Fork pull requests run with a read-only token, so this job cannot arm them. Until `scripts/automerge.mjs` exists on `main`, a pull request that introduces it finds nothing to run on the base commit and leaves auto-merge off.
