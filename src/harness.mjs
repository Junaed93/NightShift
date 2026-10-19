// Adapters for headless coding agents.
//
// Every harness is invoked with a short pointer, never the full task text:
//   "Read .nightshift/prompt.md and follow it exactly."
// That keeps argv free of quotes/newlines (safe on Windows cmd.exe, where npm
// shims like claude.cmd must be run through a shell) and leaves a persistent
// artifact of exactly what the agent was told.

export const POINTER = "Read .nightshift/prompt.md and follow it exactly. Do not ask questions.";

export const HARNESSES = ["claude", "codex", "opencode"];

export function buildCommand(name, options = {}) {
  const { model, maxTurns, resumeSession, extraArgs = [] } = options;

  switch (name) {
    case "claude": {
      const args = ["-p", "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"];
      if (maxTurns) args.push("--max-turns", String(maxTurns));
      if (model) args.push("--model", model);
      if (resumeSession) args.push("--resume", resumeSession);
      args.push(...extraArgs);
      // claude -p reads the prompt from stdin when none is given as an argument.
      return { command: "claude", args, input: POINTER };
    }

    case "codex": {
      const args = ["exec", "--full-auto", "--json"];
      if (model) args.push("--model", model);
      args.push(...extraArgs, POINTER);
      return { command: "codex", args, input: null };
    }

    case "opencode": {
      const args = ["run"];
      if (model) args.push("--model", model);
      args.push(...extraArgs, POINTER);
      return { command: "opencode", args, input: null };
    }

    default:
      throw new Error(`unknown harness "${name}" (expected one of: ${HARNESSES.join(", ")})`);
  }
}

/**
 * Best-effort parse of the harness output tail. Never throws: if we cannot
 * parse, we fall back to the process exit code plus the external gate.
 */
export function parseOutput(name, tail = "") {
  const result = { ok: true, sessionId: null, costUSD: 0, turns: null, error: null };
  const lines = String(tail).split(/\r?\n/).filter(Boolean);

  if (name === "claude") {
    for (let i = lines.length - 1; i >= 0; i--) {
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (obj.type === "result") {
        result.sessionId = obj.session_id ?? null;
        result.costUSD = Number(obj.total_cost_usd ?? 0) || 0;
        result.turns = obj.num_turns ?? null;
        result.ok = !obj.is_error;
        if (obj.is_error) result.error = obj.result || obj.subtype || "agent reported an error";
        return result;
      }
    }
    return result;
  }

  if (name === "codex") {
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj.type === "thread.started") result.sessionId = obj.thread_id ?? null;
      if (obj.type === "turn.completed" && obj.usage) {
        result.turns = obj.usage.output_tokens ?? result.turns;
      }
      if (obj.type === "error") {
        result.ok = false;
        result.error = obj.message ?? "agent error";
      }
    }
  }

  return result;
}
