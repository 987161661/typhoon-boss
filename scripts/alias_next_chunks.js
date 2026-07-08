const fs = require("fs");
const path = require("path");

const chunksDir = path.join(process.cwd(), ".next", "static", "chunks");

const aliases = [
  { pattern: /^main-app-.+\.js$/, alias: "main-app.js" },
  { pattern: /^polyfills-.+\.js$/, alias: "polyfills.js" }
];

if (!fs.existsSync(chunksDir)) {
  process.exit(0);
}

const files = fs.readdirSync(chunksDir);

for (const { pattern, alias } of aliases) {
  const source = files.find((file) => pattern.test(file));
  if (!source) continue;
  fs.copyFileSync(path.join(chunksDir, source), path.join(chunksDir, alias));
}
