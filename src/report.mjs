import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fmtDuration, fmtUSD, nowISO, oneLine } from "./util.mjs";

export function ensureReport(file) {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "# Nightshift report",
      "",
      "Every task the overnight supervisor processed, newest at the bottom.",
      "Start with the [FAIL] entries.",
      "",
    ].join("\n"),
  );
}

export function appendTask(file, r) {
  const icon = r.status === "done" ? "[ok]" : "[FAIL]";
  const bits = [fmtDuration(r.durationMs)];
  if (r.costUSD) bits.push(fmtUSD(r.costUSD));
  if (r.turns) bits.push(`${r.turns} turns`);
  if (r.changed) bits.push(`${r.changed} file(s)`);
  if (r.sha) bits.push(`commit ${r.sha}`);

  const lines = ["", `## ${icon} ${r.id} - ${bits.join(" | ")}`, ""];
  lines.push(`- ${nowISO()} | branch \`${r.branch}\` | harness \`${r.harness}\``);
  if (r.status === "done" && r.stat) lines.push(`- **diff:** ${r.stat}`);
  if (r.reason) lines.push(`- **why:** ${r.reason}`);
  if (r.gate) lines.push(`- **gate:** ${r.gate}`);
  if (r.blocked) lines.push(`- **agent is blocked:** ${oneLine(r.blocked, 400)}`);
  if (r.worktree) lines.push(`- **inspect:** \`${r.worktree}\``);
  if (r.log) lines.push(`- **log:** \`${r.log}\``);

  appendFileSync(file, lines.join("\n") + "\n");
}

export async function notify(cfg, text) {
  const webhook = cfg.notify?.webhook;
  if (!webhook) return;

  const format = cfg.notify?.format ?? "text";
  const body = format === "discord" ? { content: text } : format === "slack" ? { text } : text;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`nightshift: webhook failed (${err.message})`);
  }
}
