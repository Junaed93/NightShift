import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as G from "./git.mjs";
import { buildCommand, parseOutput } from "./harness.mjs";
import { runLogged } from "./proc.mjs";
import { claim, ensureDirs, finish, parseTask, paths as makePaths, recover } from "./queue.mjs";
import { appendTask, ensureReport, notify } from "./report.mjs";
import { loadState, saveState } from "./state.mjs";
import { filterMatches } from "./glob.mjs";
import { fmtDuration, fmtUSD, nowISO } from "./util.mjs";

const TEMPLATE = fileURLToPath(new URL("../prompts/task.md", import.meta.url));

/** How long the gate gets, and how much of the budget we reserve for it. */
const GATE_RESERVE_MS = 3 * 60_000;
const GATE_MAX_MS = 15 * 60_000;

export async function runSession({ cwd, cfg, dryRun = false, once = false, log = console.log }) {
  if (!G.isRepo(cwd)) {
    throw new Error(`${cwd} is not a git repository. Run "nightshift init" there first.`);
  }

  const P = makePaths(cwd, cfg);
  ensureDirs(P);
  ensureReport(P.report);
  G.ensureExcluded(cwd);
  recover(P);

  const state = loadState(P.state);
  const harness = dryRun ? "dummy" : cfg.harness;
  const limits = cfg.limits ?? {};
  const sessionStart = Date.now();
  let processed = 0;
  let ok = 0;

  while (true) {
    if (once && processed >= 1) break;
    if (limits.maxTasks > 0 && processed >= limits.maxTasks) break;
    if (limits.budgetUSD > 0 && state.spentUSD >= limits.budgetUSD) {
      log(`budget reached (${fmtUSD(state.spentUSD)} >= ${fmtUSD(limits.budgetUSD)}), stopping`);
      break;
    }

    const claimed = claim(P);
    if (!claimed) {
      if (processed === 0) log("queue is empty — nothing to do");
      break;
    }

    processed += 1;
    const result = await runTask({ cwd, cfg, P, state, harness, claimed, log });
    if (result.status === "done") ok += 1;

    saveState(P.state, state);
    appendTask(P.report, result);
    log(
      `${result.status === "done" ? "done  " : "failed"} ${result.id} ` +
        `(${fmtDuration(result.durationMs)}${result.costUSD ? `, ${fmtUSD(result.costUSD)}` : ""})` +
        (result.reason ? ` — ${result.reason}` : ""),
    );
  }

  const summary =
    processed === 0
      ? "nightshift: nothing to do."
      : `nightshift: ${ok}/${processed} task(s) done in ${fmtDuration(Date.now() - sessionStart)}` +
        `${state.spentUSD ? `, ${fmtUSD(state.spentUSD)} spent so far` : ""}.`;

  if (processed > 0) {
    log(summary);
    log(`report: ${P.report}`);
    await notify(cfg, summary);
  }

  return { processed, ok, state };
}

async function runTask({ cwd, cfg, P, state, harness, claimed, log }) {
  const { id, file } = claimed;
  const started = Date.now();

  const task = parseTask(file, id);
  const meta = task.meta ?? {};
  const worktree = path.join(P.work, id);
  const branch = `${cfg.branchPrefix}${id}`;
  const baseRef = cfg.baseBranch || "HEAD";
  const harnessLog = path.join(P.logs, `${id}.jsonl`);

  // Pin the comparison base: after the agent commits (or we do), a symbolic
  // "HEAD" would move and make the diff and the protected-file check useless.
  state.bases = state.bases ?? {};
  const base = state.bases[id] ?? G.revParse(cwd, baseRef) ?? baseRef;
  state.bases[id] = base;

  state.attempts[id] = (state.attempts[id] ?? 0) + 1;
  const attempt = state.attempts[id];

  const result = {
    id,
    status: "failed",
    branch,
    harness,
    worktree,
    changed: 0,
    costUSD: 0,
    turns: null,
    durationMs: 0,
  };

  try {
    G.ensureWorktree(cwd, worktree, branch, base);

    const minutes = Number(meta.minutes ?? cfg.limits.minutes ?? 45);
    const deadline = Date.now() + minutes * 60_000;
    const gate = meta.gate ? [meta.gate] : cfg.gate;

    const promptFile = path.join(worktree, ".nightshift", "prompt.md");
    mkdirSync(path.dirname(promptFile), { recursive: true });
    writeFileSync(
      promptFile,
      renderPrompt({ id, task, gate, protect: cfg.protect, attempt }),
    );

    let run;
    if (harness === "dummy") {
      // Dry run: prove the plumbing without spending money.
      appendFileSync(path.join(worktree, "nightshift-dryrun.txt"), `dry run for ${id}\n`);
      run = { code: 0, tail: "", timedOut: false, error: null };
    } else {
      const command = buildCommand(harness, {
        model: meta.model ?? cfg.model,
        maxTurns: Number(meta.turns ?? cfg.limits.maxTurns) || null,
        resumeSession: attempt > 1 ? state.sessions[id] : null,
        extraArgs: cfg.harnessArgs?.[harness] ?? [],
      });

      const budgetLeft = Math.max(60_000, deadline - Date.now() - GATE_RESERVE_MS);
      run = await runLogged({
        ...command,
        cwd: worktree,
        timeoutMs: budgetLeft,
        logPath: harnessLog,
      });
      result.log = harnessLog;
    }

    const parsed =
      harness === "dummy" ? { ok: true, costUSD: 0, turns: 0, sessionId: null } : parseOutput(harness, run.tail);

    if (parsed.sessionId) state.sessions[id] = parsed.sessionId;
    result.costUSD = parsed.costUSD ?? 0;
    result.turns = parsed.turns ?? null;
    state.spentUSD = (state.spentUSD ?? 0) + result.costUSD;

    const files = G.changedFiles(worktree, base);
    result.changed = files.length;

    const protectedHits = filterMatches(files, cfg.protect);

    if (run.timedOut) {
      result.reason = `hit the ${minutes}m task limit`;
    } else if (!parsed.ok) {
      result.reason = parsed.error || `harness exited ${run.code}`;
    } else if (protectedHits.length) {
      result.reason = `touched protected paths: ${protectedHits.slice(0, 5).join(", ")}`;
    } else {
      const gateResults = [];
      let gateOk = true;

      for (const [i, command] of gate.entries()) {
        const left = Math.max(30_000, deadline - Date.now());
        const g = await runLogged({
          command,
          cwd: worktree,
          timeoutMs: Math.min(left, GATE_MAX_MS),
          logPath: path.join(P.logs, `${id}.gate-${i + 1}.log`),
          shell: true,
        });
        gateResults.push({ command, code: g.code, timedOut: g.timedOut });
        if (g.code !== 0 || g.timedOut) {
          gateOk = false;
          break;
        }
      }

      result.gate = gateResults
        .map((g) => `\`${g.command}\` ${g.code === 0 ? "ok" : g.timedOut ? "timeout" : `exit ${g.code}`}`)
        .join(", ");

      if (!gateOk) {
        result.reason = `gate failed: ${result.gate}`;
      } else {
        result.sha = G.commitAll(worktree, `nightshift: ${id}`);
        result.stat = G.diffStat(worktree, base);
        result.status = "done";
      }
    }

    if (result.status === "done") {
      finish(file, P.done);
    } else {
      const blocked = path.join(worktree, "BLOCKED.md");
      if (existsSync(blocked)) result.blocked = readFileSync(blocked, "utf8");
      finish(file, P.failed);
    }
  } catch (err) {
    result.reason = err.message;
    try {
      finish(file, P.failed);
    } catch {
      // the task file may already be gone
    }
  }

  result.durationMs = Date.now() - started;
  state.runs = state.runs ?? [];
  state.runs.push({
    id,
    status: result.status,
    at: nowISO(),
    costUSD: result.costUSD,
    durationMs: result.durationMs,
    branch,
  });

  return result;
}

function renderPrompt({ id, task, gate, protect, attempt }) {
  const override = path.join(path.dirname(TEMPLATE), "task.local.md");
  const template = existsSync(override) ? readFileSync(override, "utf8") : readFileSync(TEMPLATE, "utf8");

  return template
    .replaceAll("{{id}}", id)
    .replaceAll("{{task}}", task.body)
    .replaceAll("{{gate}}", gate.map((c) => `- \`${c}\``).join("\n") || "- (no gate configured)")
    .replaceAll("{{protect}}", protect.map((p) => `\`${p}\``).join(", ") || "(none)")
    .replaceAll("{{attempt}}", String(attempt));
}
