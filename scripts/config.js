// Local settings for the scripts, read from shelf.config.json at the repo root (git-ignored).
// Copy shelf.config.example.json to start; any field left out uses the default below.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const defaults = {
  booksDir: path.join(ROOT, "books"), // folder of PDFs; each top-level folder becomes a tab
  port: 8931,
  driveDir: "", // optional folder to mirror booksDir into (e.g. a Google Drive for desktop folder); "" turns sync off
  driveSkip: [], // folder names the mirror leaves out
  r2Bucket: "bookshelf", // Cloudflare R2 bucket for the hosted site (scripts/upload-r2.js)
};

let file = {};
try {
  file = JSON.parse(fs.readFileSync(path.join(ROOT, "shelf.config.json"), "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw new Error(`shelf.config.json: ${e.message}`);
}

const config = { ...defaults, ...file };
config.booksDir = path.resolve(ROOT, config.booksDir);
if (config.driveDir) config.driveDir = path.resolve(ROOT, config.driveDir);
// how book paths are written in books.js: forward slashes, no trailing slash
config.booksRoot = config.booksDir.replace(/\\/g, "/").replace(/\/$/, "");
module.exports = config;
