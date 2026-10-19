// Small shared helpers. No dependencies on purpose.

export function deepMerge(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return b === undefined ? a : b;
  if (typeof a !== "object" || a === null) return b === undefined ? a : b;
  if (typeof b !== "object" || b === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = k in a ? deepMerge(a[k], v) : v;
  }
  return out;
}

export function slug(s) {
  const out = String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return out || "task";
}

export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtUSD(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

export function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function oneLine(s, max = 200) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}
