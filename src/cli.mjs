#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defaultConfigFile, loadConfig } from "./config.mjs";
import { paths as makePaths } from "./queue.mjs";
import { runSession } from "./runner.mjs";
import { HARNESSES } from "./harness.mjs";
import { fmtUSD } from "./util.mjs";

const BOOLEAN = new Set(["once", "dryRun", "force", "help", "version", "all"]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const [rawKey, inline] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) {
      out[key] = inline;
    } else if (BOOLEAN.has(key)) {
      out[key] = true;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[++i];
    } else {
      out[key] = true;
    }
  }
  return out;
}

function applyOverrides(cfg, flags) {
  if (typeof flags.harness === "string") cfg.harness = flags.harness;
  if (typeof flags.model === "string") cfg.model = flags.model;
  if (flags.minutes) cfg.limits.minutes = Number(flags.minutes);
  if (flags.maxTurns) cfg.limits.maxTurns = Number(flags.maxTurns);
  if (flags.budget) cfg.limits.budgetUSD = Number(flags.budget);
  if (flags.maxTasks) cfg.limits.maxTasks = Number(flags.maxTasks);
  return cfg;
}

function help() {
  console.log(`nightshift — overnight supervisor for headless coding agents

Usage:
  nightshift init [--cwd DIR]              scaffold a target repo
  nightshift run [--once] [--dry-run]      work through tasks/queue/*.md
  nightshift status                        queue counts + recent report
  nightshift retry <id>                    move tasks/failed/<id>.md back to queue
  nightshift clean [--all]                 remove worktrees, optionally branches

Flags:
  --cwd DIR          target repo (default: current directory)
  --harness NAME     claude | codex | opencode      (default: from config)
  --model NAME       model passed to the harness
  --minutes N        wall-clock limit per task          (default: 45)
  --max-turns N      harness turn limit                 (default: 60)
  --budget USD       stop the night after this spend    (default: 0 = unlimited)
  --max-tasks N      stop after N tasks                 (default: 0 = whole queue)
  --dry-run          use the built-in dummy harness, spend nothing
  --once             process a single task then exit
`);
}

async function main() {
  const [command = "run", ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  const cwd = path.resolve(flags.cwd ? String(flags.cwd) : process.cwd());

  if (flags.help || command === "help" || command === "--help") return help();
  if (command === "version" || flags.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return console.log(pkg.version);
  }

  if (command === "init") return init(cwd);

  if (command === "status") return status(cwd);

  if (command === "retry") {
    const id = flags._[0];
    if (!id) throw new Error("usage: nightshift retry <task-id>");
    const cfg = applyOverrides(loadConfig(cwd), flags);
    const P = makePaths(cwd, cfg);
    const src = path.join(P.failed, `${id}.md`);
    if (!existsSync(src)) throw new Error(`no failed task "${id}" in ${P.failed}`);
    mkdirSync(P.queue, { recursive: true });
    renameSync(src, path.join(P.queue, `${id}.md`));
    return console.log(`requeued ${id}`);
  }

  if (command === "clean") {
    const cfg = applyOverrides(loadConfig(cwd), flags);
    const P = makePaths(cwd, cfg);
    const worktrees = existsSync(P.work) ? readdirSync(P.work) : [];
    const { git } = await import("./git.mjs");
    for (const name of worktrees) {
      git(cwd, ["worktree", "remove", "--force", path.join(P.work, name)], { allowFail: true });
    }
    git(cwd, ["worktree", "prune"], { allowFail: true });
    if (flags.all) {
      const branches = (git(cwd, ["branch", "--list", `${cfg.branchPrefix}*`], { allowFail: true }) ?? "")
        .split("\n")
        .map((b) => b.replace(/^[*+]\s*/, "").trim())
        .filter(Boolean);
      for (const branch of branches) git(cwd, ["branch", "-D", branch], { allowFail: true });
      console.log(`removed ${branches.length} branch(es)`);
    }
    return console.log(`pruned ${worktrees.length} worktree(s)`);
  }

  if (command !== "run") throw new Error(`unknown command "${command}" (try: nightshift help)`);

  const cfg = applyOverrides(loadConfig(cwd), flags);
  if (flags.dryRun) console.log("dry run: using the dummy harness, no model calls");
  if (!HARNESSES.includes(cfg.harness) && !flags.dryRun) {
    throw new Error(`unknown harness "${cfg.harness}" (expected: ${HARNESSES.join(", ")})`);
  }

  const result = await runSession({ cwd, cfg, dryRun: Boolean(flags.dryRun), once: Boolean(flags.once) });
  if (result.processed === 0) console.log("nothing to do");
  else console.log(`spent ${fmtUSD(result.state.spentUSD)} in total`);
}

function init(cwd) {
  if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
  mkdirSync(path.join(cwd, "tasks", "queue"), { recursive: true });

  const configPath = path.join(cwd, "nightshift.config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfigFile(), null, 2) + "\n");
    console.log(`wrote ${configPath}`);
  } else {
    console.log(`kept existing ${configPath}`);
  }

  const example = path.join(cwd, "tasks", "queue", "000-example.md");
  if (!existsSync(example)) {
    writeFileSync(
      example,
      [
        "---",
        "minutes: 20",
        "turns: 30",
        "---",
        "",
        "# Example task: add a health endpoint",
        "",
        "Delete this file once you have written a real task.",
        "",
        "Add `GET /health` returning `{\"ok\":true}` with status 200.",
        "",
        "Acceptance:",
        "- an existing test style is followed",
        "- `npm test` passes",
        "- no new dependencies",
        "",
      ].join("\n"),
    );
    console.log(`wrote ${example}`);
  }

  const gitignore = path.join(cwd, ".gitignore");
  const body = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!body.split(/\r?\n/).includes(".nightshift/")) {
    appendFileSync(gitignore, `${!body || body.endsWith("\n") ? "" : "\n"}.nightshift/\n`);
    console.log("added .nightshift/ to .gitignore");
  }

  console.log(`
Next:
  1. Edit nightshift.config.json — set "gate" to your real check command.
  2. Write small, verifiable tasks in tasks/queue/ (one file per task).
  3. Prove the plumbing:  nightshift run --dry-run --once
  4. Run for real:        nightshift run --once
  5. Read .nightshift/REPORT.md in the morning.
`);
}

function status(cwd) {
  const cfg = loadConfig(cwd);
  const P = makePaths(cwd, cfg);
  const count = (dir, ext = ".md") =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).length : 0;

  const stateFile = P.state;
  let spent = 0;
  let runs = 0;
  try {
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    spent = Number(state.spentUSD) || 0;
    runs = state.runs?.length ?? 0;
  } catch {
    // no state yet
  }

  console.log(`queue:  ${count(P.queue)}`);
  console.log(`done:   ${count(P.done)}`);
  console.log(`failed: ${count(P.failed)}`);
  console.log(`runs:   ${runs} (${fmtUSD(spent)} total)`);
  console.log(`report: ${P.report}`);

  if (existsSync(P.report)) {
    const tail = readFileSync(P.report, "utf8").split(/\r?\n/).slice(-40).join("\n");
    console.log(`\n--- last report entries ---\n${tail}`);
  }
}

main().catch((err) => {
  console.error(`nightshift: ${err.message}`);
  process.exit(1);
});
