// Source-only export. No network, environment secret access, or Git history.
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, existsSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".local/public-export");
// Refuse stale output rather than accidentally uploading previously removed files.
if (existsSync(output)) throw new Error("Export already exists. Move it aside or remove .local/public-export after reviewing it, then rerun.");
const paths = JSON.parse(readFileSync(resolve(root, "public-export-files.json"), "utf8"));
if (!Array.isArray(paths) || !paths.length || new Set(paths).size !== paths.length) {
  throw new Error("Expected a nonempty, unique reviewed file allowlist.");
}
const forbidden = /(^|\/)(?:\.git|\.agents|\.local|\.cache|\.config|\.conversation|node_modules|dist|data|docs|attached_assets|screenshots|mockup-sandbox)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key|sql|dump|sqlite\d*|tsbuildinfo)$/i;
const checks = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["GitHub token", /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ["API token", /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{24,}/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["credential URL", /(?:postgres(?:ql)?|mysql|https?):\/\/[^/\s:'"]+:[^@\s'"]+@/],
];
const entries = paths.sort().map(path => {
  if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..") || forbidden.test(path)) {
    throw new Error(`Disallowed export path: ${path}`);
  }
  const source = resolve(root, path);
  const within = relative(root, source);
  if (within.startsWith(`..${sep}`) || within === ".." || source === root || realpathSync(source) !== source || !lstatSync(source).isFile()) {
    throw new Error(`Not a regular workspace file: ${path}`);
  }
  const bytes = readFileSync(source);
  if (bytes.includes(0)) throw new Error(`Binary content requires separate review: ${path}`);
  for (const [name, pattern] of checks) {
    if (pattern.test(bytes.toString("utf8"))) throw new Error(`Potential ${name} in ${path}; export stopped (value not displayed).`);
  }
  const sha = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  return { path, mode: "100644", type: "blob", sha, bytes: bytes.length, content: bytes.toString("base64"), encoding: "base64" };
});
// Validate every file before writing output.
mkdirSync(output, { recursive: true });
for (const entry of entries) {
  const destination = resolve(output, "snapshot", entry.path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.from(entry.content, "base64"));
}
writeFileSync(resolve(output, "manifest.json"), JSON.stringify(entries.map(({content, encoding, ...entry}) => entry), null, 2));
let batch = [], size = 0, number = 0;
const flush = () => {
  if (!batch.length) return;
  writeFileSync(resolve(output, `batch-${number++}.json`), JSON.stringify(batch));
  batch = []; size = 0;
};
for (const entry of entries) {
  const length = JSON.stringify(entry).length;
  if (size + length > 500_000) flush();
  batch.push(entry); size += length;
}
flush();
console.log(JSON.stringify({ files: entries.length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0), batches: number, output }));
