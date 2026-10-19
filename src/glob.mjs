// Tiny gitignore-flavoured glob matcher. Supports *, **, ?.
// A pattern without a slash matches at any depth, like .gitignore.

export function globToRegExp(pattern) {
  const p = String(pattern).replace(/\\/g, "/").replace(/^\.\//, "");
  const hasSlash = p.includes("/");
  let re = "";

  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        re += ".*";
        i++;
        if (p[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${hasSlash ? "" : "(?:.*/)?"}${re}$`);
}

export function matchesAny(file, patterns = []) {
  if (!patterns.length) return false;
  const f = String(file).replace(/\\/g, "/");
  return patterns.some((p) => globToRegExp(p).test(f));
}

export function filterMatches(files, patterns = []) {
  return files.filter((f) => matchesAny(f, patterns));
}
