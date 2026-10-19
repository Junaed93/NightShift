# nightshift

Overnight supervisor for headless coding agents. Drop small, verifiable tasks
into a queue, go to sleep, wake up to a report and one git branch per task.

It does not care which agent you use. It wraps the same primitive every harness
already has — "run this prompt non-interactively and exit" — and adds the three
things that make unattended work safe:

1. **A fresh process and fresh context per task** (no 8-hour context rot).
2. **An external gate** — the agent's "done" means nothing; your tests decide.
3. **A worktree per task** — one bad task cannot poison the next one.

```
tasks/queue/*.md  ->  worktree  ->  agent  ->  gate  ->  commit on nightshift/<id>
                                    |
                                    +-> tasks/failed/ + REPORT.md entry
```

## Install

Requires Node 20+ and git.

```powershell
npm install -g @junaed93/nightshift
```

The command it installs is `nightshift`.

For unreleased changes, install straight from GitHub:

```powershell
npm install -g github:Junaed93/NightShift
```

For development, clone and link:

```powershell
git clone https://github.com/Junaed93/NightShift.git D:\nightshift
cd D:\nightshift
npm link                          # gives you `nightshift` on PATH, everywhere
```

Offline, move the tarball by hand:

```powershell
npm pack                          # -> junaed93-nightshift-0.1.0.tgz
npm install -g .\junaed93-nightshift-0.1.0.tgz
```

## Quickstart

```powershell
# 1. scaffold the repo you want worked on
nightshift init --cwd C:\code\myapp

# 2. set the gate to your real check
#    C:\code\myapp\nightshift.config.json -> "gate": ["npm test", "npm run build"]

# 3. prove the plumbing for free (no model calls)
nightshift run --cwd C:\code\myapp --dry-run --once

# 4. one real task
nightshift run --cwd C:\code\myapp --once

# 5. the whole queue, then read the report
nightshift run --cwd C:\code\myapp
nightshift status --cwd C:\code\myapp
```

Without a global install, run it in place:
`node D:\nightshift\src\cli.mjs run --cwd C:\code\myapp`.

## A task

One file per task in `tasks/queue/`. The filename is the id and the branch name.
Frontmatter is optional.

```md
---
minutes: 20
turns: 30
gate: npm test -- src/auth
model: sonnet
---

# Fix the expired-session redirect

After the token expires, `/app` renders a blank page instead of redirecting to
`/login`.

Acceptance:
- a session with an expired token redirects to `/login`
- valid sessions are unaffected
- no new dependencies
```

Write tasks like you are briefing a competent contractor who cannot ask
follow-up questions: one outcome, a clear definition of done, and a file or two
of context. "Improve the codebase" produces eight hours of confident garbage.

## How a task is processed

1. The task file is atomically moved to `tasks/queue/.running/` (crash-safe).
2. A worktree is created at `.nightshift/work/<id>` on branch
   `nightshift/<id>`, cut from `baseBranch` and **pinned to that commit**.
3. The full instructions are written to `.nightshift/prompt.md` and the harness
   is told to read it. (Keeping the task text out of `argv` avoids every shell
   quoting problem on Windows.)
4. The agent runs with a wall-clock limit. Output streams to
   `.nightshift/logs/<id>.jsonl`.
5. **Protected paths are checked.** If the agent touched tests, CI config, or a
   lockfile, the task fails without running the gate.
6. The gate commands run. All must exit 0.
7. On success: commit, move to `tasks/done/`, log the diffstat.
   On failure: move to `tasks/failed/`, capture `BLOCKED.md` if there is one.

Nothing is merged. You wake up to branches and a report, and merge what you
trust.

## Harnesses

| Harness | Invocation | Needs |
|---|---|---|
| `claude` (default) | `claude -p --dangerously-skip-permissions --output-format stream-json` | Claude Code CLI, logged in or `ANTHROPIC_API_KEY` |
| `codex` | `codex exec --full-auto --json` | Codex CLI |
| `opencode` | `opencode run` | OpenCode CLI + auto-approved permissions in that repo |
| `dummy` | internal | nothing — used by `--dry-run` |

Pick per run with `--harness codex`, or set `"harness"` in the config.

`claude` also reports `total_cost_usd`, so the `budgetUSD` limit is exact for it.
For the others the budget is advisory; the wall clock and `maxTasks` still hold.

## Config

`nightshift.config.json` in the target repo. Every field is optional.

```json
{
  "harness": "claude",
  "model": null,
  "limits": { "minutes": 45, "maxTurns": 60, "budgetUSD": 10, "maxTasks": 0 },
  "gate": ["npm test"],
  "protect": ["tests/**", "*.test.*", ".github/**", "package-lock.json"],
  "baseBranch": "HEAD",
  "branchPrefix": "nightshift/",
  "harnessArgs": { "claude": [] },
  "notify": { "webhook": null, "format": "text" }
}
```

- `limits.minutes` — wall clock per task, enforced with a process-tree kill.
- `limits.budgetUSD` — stop the night when spent. `0` = unlimited.
- `notify.format` — `text` (ntfy, custom), `discord`, or `slack`.
- `baseBranch` — cut worktrees from this ref. `HEAD` is fine for solo work.

## Commands

```
nightshift init [--cwd DIR]        scaffold a target repo
nightshift run                     work through the queue
nightshift run --once              one task
nightshift run --dry-run           plumbing test, no model calls
nightshift status                  counts, spend, recent report
nightshift retry <id>              tasks/failed/<id>.md -> queue
nightshift clean                   remove worktrees (--all also branches)
```

Per-run overrides: `--harness`, `--model`, `--minutes`, `--max-turns`,
`--budget`, `--max-tasks`.

## Safety

Unattended agents edit files and run commands with permissions skipped. Treat
that box as compromised:

- Run it in a container or a throwaway VM, not on your daily driver with your
  SSH keys. See `docker/`.
- No production credentials in the environment. The agent inherits it.
- `protect` is a speed bump, not a security boundary.
- Never let it push or merge automatically. It commits to a branch; you review.
- Keep `budgetUSD` and `limits.minutes` set. Runaway loops are the normal
  failure mode, not the exotic one.

## Where to run it

The supervisor must run on a machine that stays awake — that is the whole point.

- **Home server / mini PC / VPS**: `tmux new -s night`, run it, detach, close the
  laptop. `systemctl` if you want it recurring.
- **GitHub Actions**: see `templates/github-action.yml`. Free-ish, always on,
  and the laptop can be off entirely.
- **This laptop**: it will not run while asleep. Either keep it awake while a
  job runs, or accept that the machine must be on.

## Roadmap

- [ ] `nightshift doctor` — verify the harness is installed and authenticated
- [ ] concurrency > 1 with a merge queue
- [ ] reviewer pass: second model checks the diff against the task
- [ ] PR mode (`gh pr create` per task) instead of local branches
- [ ] resume a failed task with its harness session id
- [ ] daily digest instead of per-run webhook

## Releasing

Releases go out from CI, not from a laptop. `.github/workflows/publish.yml`
publishes on any `v*` tag using trusted publishing (OIDC), so there is no npm
token in this repo and none in the workflow's secrets:

```powershell
npm version patch      # or minor / major; commits and tags
git push --follow-tags
```

The tag starts the workflow, which installs, runs `npm test`, and publishes.
npm verifies the workflow's identity over OIDC and attaches a provenance
attestation, so every release traces back to a commit.

One-time setup per package: on npmjs.com, open the package, then
Settings -> Trusted Publisher -> GitHub Actions, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `Junaed93` |
| Repository | `NightShift` |
| Workflow filename | `publish.yml` |
| Environment name | leave blank |
| Allowed actions | `npm publish` |

The environment name must stay blank to match the workflow. npm expires a new
trusted publisher if its first publish does not succeed within 2 days, so
exercise it fairly soon after saving.

### Publishing by hand

Only needed before the trusted publisher exists. npm requires 2FA for every
publish, so this is interactive:

```powershell
npm login
npm test
npm publish            # prompts for a one-time password
```

A granular access token with **bypass 2FA** enabled can publish without the
prompt, but npm is phasing those out and they cannot be used for account
settings. Prefer the workflow.

`prepublishOnly` runs `npm test`, so a tree that fails verification cannot be
published from either path.

### Name

The package is scoped (`@junaed93/nightshift`) because the registry rejects the
unscoped name as "too similar to existing package night-shift", a 2017 macOS
Night Shift toggle. `publishConfig.access` is `public`, so no `--access` flag is
needed. The installed command is still `nightshift`.

