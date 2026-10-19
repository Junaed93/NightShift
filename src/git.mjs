import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function git(cwd, args, { allowFail = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = (err.stderr || err.message || "").toString().trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export const isRepo = (dir) =>
  git(dir, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }) === "true";

export const revParse = (dir, ref) =>
  git(dir, ["rev-parse", "--verify", "--quiet", ref], { allowFail: true });

/** Create the worktree, or reuse it if a previous attempt left one behind. */
export function ensureWorktree(repo, dir, branch, base) {
  if (existsSync(dir)) return { reused: true, branch };

  const branchExists = Boolean(revParse(repo, `refs/heads/${branch}`));
  if (branchExists) {
    git(repo, ["worktree", "add", dir, branch]);
  } else {
    git(repo, ["worktree", "add", "-b", branch, dir, base]);
  }
  return { reused: false, branch };
}

/** Changed files vs `base`, including commits the agent made itself. */
export function changedFiles(wt, base) {
  const tracked = git(wt, ["diff", "--name-only", base], { allowFail: true }) ?? "";
  const untracked = git(wt, ["ls-files", "--others", "--exclude-standard"], { allowFail: true }) ?? "";
  const all = [...tracked.split("\n"), ...untracked.split("\n")]
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

export function commitAll(wt, message) {
  git(wt, ["add", "-A"]);
  const staged = git(wt, ["diff", "--cached", "--name-only"], { allowFail: true });
  if (!staged) return null;
  git(wt, [
    "-c",
    "user.name=nightshift",
    "-c",
    "user.email=nightshift@localhost",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  return git(wt, ["rev-parse", "--short", "HEAD"], { allowFail: true });
}

export function diffStat(wt, base) {
  return git(wt, ["diff", "--shortstat", base], { allowFail: true }) ?? "";
}

export function removeWorktree(repo, dir) {
  return git(repo, ["worktree", "remove", "--force", dir], { allowFail: true });
}

export function listWorktrees(repo) {
  const raw = git(repo, ["worktree", "list", "--porcelain"], { allowFail: true }) ?? "";
  return raw
    .split("\n\n")
    .map((block) => {
      const line = block.split("\n").find((l) => l.startsWith("worktree "));
      return line ? line.slice("worktree ".length) : null;
    })
    .filter(Boolean);
}

/** Keep .nightshift/ out of commits even if the target repo has no .gitignore. */
export function ensureExcluded(repo, entry = ".nightshift/") {
  const common = git(repo, ["rev-parse", "--git-common-dir"], { allowFail: true });
  if (!common) return;
  const base = path.isAbsolute(common) ? common : path.join(repo, common);
  const file = path.join(base, "info", "exclude");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const body = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (!body.split(/\r?\n/).includes(entry)) {
      writeFileSync(file, `${body}${!body || body.endsWith("\n") ? "" : "\n"}${entry}\n`);
    }
  } catch {
    // best effort only
  }
}
