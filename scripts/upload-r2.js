// Uploads the books to the private R2 bucket the hosted shelf reads from (worker/).
// Keys are the path under D:\Books, as in books.js. Only new or changed files are sent;
// what's been uploaded is remembered in data/r2-manifest.json (size + modified time).
// Usage: node scripts/upload-r2.js [--dry]

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = "D:\\Books";
const BUCKET = "bookshelf";
const MANIFEST = path.join(__dirname, "..", "data", "r2-manifest.json");
const dry = process.argv.includes("--dry");

global.window = {};
require(path.join(__dirname, "..", "app", "books.js"));
const keys = window.BOOKS.map((b) => b.path.replace(/^D:\/Books\//i, ""));

let manifest = {};
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch {}
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

const todo = [];
for (const key of keys) {
  const file = path.join(ROOT, ...key.split("/"));
  let st;
  try { st = fs.statSync(file); } catch { console.log("missing:", key); continue; }
  const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
  if (manifest[key] !== sig) todo.push({ key, file, sig, size: st.size });
}
const mb = (n) => (n / 1048576).toFixed(1) + " MB";
console.log(`${todo.length} of ${keys.length} to upload (${mb(todo.reduce((a, t) => a + t.size, 0))})`);
if (dry || !todo.length) process.exit(0);

// wrangler's entry script, run with node directly: no shell, so names with spaces and quotes
// pass through untouched (`npx -y wrangler@4 --version` puts it in the npx cache)
function findWrangler() {
  const base = path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const dir = path.join(base, d, "node_modules", "wrangler");
    try {
      if (JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version.startsWith("4.")) return path.join(dir, "bin", "wrangler.js");
    } catch {}
  }
  throw new Error("wrangler not found: run `npx -y wrangler@4 --version` first");
}
const WRANGLER = findWrangler();

const put = (t) => new Promise((ok) => {
  const p = spawn(process.execPath, [WRANGLER, "r2", "object", "put", `${BUCKET}/${t.key}`,
    "--file", t.file, "--content-type", "application/pdf", "--remote"], { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  p.stderr.on("data", (d) => (err += d));
  p.on("close", (code) => ok({ code, err }));
});

(async () => {
  let done = 0, failed = 0;
  const queue = todo.slice();
  const worker = async () => {
    for (let t; (t = queue.shift()); ) {
      // a slow uplink can time a big upload out; try again a couple of times
      let code, err;
      for (let i = 0; i < 3 && code !== 0; i++) ({ code, err } = await put(t));
      if (code === 0) { manifest[t.key] = t.sig; save(); done++; console.log(`ok   ${done}/${todo.length}  ${mb(t.size).padStart(9)}  ${t.key}`); }
      else { failed++; console.log(`FAIL ${t.key}\n${err.split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join("\n")}`); }
    }
  };
  // two at a time: more just splits the uplink and makes big files time out
  await Promise.all([worker(), worker()]);
  console.log(`done: ${done} uploaded, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
