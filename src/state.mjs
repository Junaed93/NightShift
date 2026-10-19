import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMPTY = () => ({ attempts: {}, sessions: {}, spentUSD: 0, runs: [] });

export function loadState(file) {
  try {
    return { ...EMPTY(), ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return EMPTY();
  }
}

export function saveState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}
