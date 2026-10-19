import { readFileSync } from "node:fs";
import path from "node:path";
import { deepMerge } from "./util.mjs";

export const DEFAULTS = {
  harness: "claude",
  model: null,
  harnessArgs: {},
  baseBranch: "HEAD",
  branchPrefix: "nightshift/",
  limits: {
    minutes: 45,
    maxTurns: 60,
    budgetUSD: 0,
    maxTasks: 0,
  },
  gate: ["npm test"],
  protect: [
    "tests/**",
    "test/**",
    "__tests__/**",
    "*.test.*",
    "*.spec.*",
    ".github/**",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "poetry.lock",
    "Cargo.lock",
    "go.sum",
  ],
  notify: {
    webhook: null,
    format: "text",
  },
  paths: {
    tasks: "tasks/queue",
    done: "tasks/done",
    failed: "tasks/failed",
    work: ".nightshift/work",
    logs: ".nightshift/logs",
    state: ".nightshift/state.json",
    report: ".nightshift/REPORT.md",
  },
};

export function loadConfig(cwd) {
  const file = path.join(cwd, "nightshift.config.json");
  let user = {};
  try {
    user = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw new Error(`${file} is not valid JSON: ${err.message}`);
    }
  }
  return deepMerge(DEFAULTS, user);
}

export function defaultConfigFile() {
  return {
    harness: "claude",
    model: null,
    limits: { minutes: 45, maxTurns: 60, budgetUSD: 10, maxTasks: 0 },
    gate: ["npm test"],
    protect: DEFAULTS.protect,
    baseBranch: "HEAD",
    branchPrefix: "nightshift/",
    notify: { webhook: null, format: "text" },
  };
}
