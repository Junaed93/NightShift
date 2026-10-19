// Pre-publish checks. Run with `npm test`, and automatically on `npm publish`.
//
// These guard the failure modes that only show up after install:
//   - a module that does not parse or resolve
//   - a prompt template that lost a placeholder (the agent would get a raw {{token}})
//   - a package.json "files" list that omits something needed at runtime
//   - the CLI failing to answer --help / version

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const srcDir = path.join(root, "src");

let failures = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const fail = (msg, err) => {
  failures += 1;
  const detail = err ? `: ${String(err.stderr ?? err.message ?? err).trim().split("\n")[0]}` : "";
  console.error(`  FAIL  ${msg}${detail}`);
};

console.log("nightshift verify\n");

// 1. Every module parses, resolves its imports, and evaluates without exploding.
const modules = readdirSync(srcDir).filter((f) => f.endsWith(".mjs"));
for (const file of modules) {
  if (file === "cli.mjs") continue; // importing cli.mjs runs main()
  try {
    await import(pathToFileURL(path.join(srcDir, file)).href);
  } catch (err) {
    fail(`src/${file}`, err);
  }
}
if (!failures) ok(`${modules.length - 1} modules load`);

// 2. The prompt template must keep every placeholder the runner substitutes.
try {
  const template = readFileSync(path.join(root, "prompts", "task.md"), "utf8");
  const missing = ["{{id}}", "{{task}}", "{{gate}}", "{{protect}}", "{{attempt}}"].filter(
    (token) => !template.includes(token),
  );
  if (missing.length) fail(`prompts/task.md lost ${missing.join(", ")}`);
  else ok("prompt template has all placeholders");
} catch (err) {
  fail("prompts/task.md", err);
}

// 3. Anything imported at runtime must be shipped in the tarball.
try {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  for (const required of ["src", "prompts"]) {
    if (!pkg.files?.includes(required)) fail(`package.json "files" is missing "${required}"`);
  }
  if (pkg.private) fail('package.json still has "private": true, so npm publish will refuse');
  if (!pkg.bin?.nightshift) fail('package.json has no "bin.nightshift" entry');
  if (failures === 0) ok("package.json is publishable");
} catch (err) {
  fail("package.json", err);
}

// 4. The CLI must answer for itself.
for (const args of [["--help"], ["version"], ["status"]]) {
  try {
    execFileSync(process.execPath, [path.join(srcDir, "cli.mjs"), ...args], { stdio: "pipe" });
    ok(`cli ${args.join(" ")}`);
  } catch (err) {
    fail(`cli ${args.join(" ")}`, err);
  }
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
