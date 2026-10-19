import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const isWin = process.platform === "win32";

function quoteWin(value) {
  const s = String(value);
  if (s === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function killTree(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // already gone
  }
}

/**
 * Run a command, stream stdout+stderr to a log file, keep the tail in memory
 * for parsing, and kill the whole process tree on timeout.
 *
 * - shell:true with no args means "command is already a full shell line".
 * - On Windows, `.cmd`/`.ps1` shims need a shell, so hooks default to shell there.
 */
export function runLogged({
  command,
  args = [],
  input = null,
  cwd,
  timeoutMs = 0,
  logPath = null,
  shell,
  tailBytes = 1_000_000,
  env,
}) {
  return new Promise((resolve) => {
    if (logPath) mkdirSync(path.dirname(logPath), { recursive: true });
    const out = logPath ? createWriteStream(logPath) : null;

    const useShell = shell === true || (shell === undefined && isWin);
    const rawLine = useShell
      ? args.length
        ? [command, ...args].map(quoteWin).join(" ")
        : String(command)
      : null;

    let settled = false;
    let tail = "";
    let timedOut = false;
    let timer = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        out?.end();
      } catch {
        // ignore
      }
      resolve({ timedOut, tail, ...payload });
    };

    const spawnError = (err) => {
      out?.write(`[nightshift] could not start: ${err.message}\n`);
      finish({ code: -1, signal: null, error: err.message });
    };

    let child;
    try {
      child = spawn(useShell ? rawLine : command, useShell ? [] : args, {
        cwd,
        shell: useShell,
        windowsHide: true,
        detached: !isWin,
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      return spawnError(err);
    }

    const onData = (chunk) => {
      const s = chunk.toString();
      tail += s;
      if (tail.length > tailBytes) tail = tail.slice(-tailBytes);
      out?.write(s);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", spawnError);
    child.on("close", (code, signal) => finish({ code, signal, error: null }));

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid);
        // Safety net: do not hang forever if the tree refuses to die.
        setTimeout(() => finish({ code: -1, signal: "timeout", error: "timeout" }), 5_000).unref?.();
      }, timeoutMs);
    }

    try {
      if (input != null) child.stdin.write(input);
      child.stdin.end();
    } catch {
      // stdin may already be closed
    }
  });
}
