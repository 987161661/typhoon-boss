const fs = require("fs");
const path = require("path");

const chunksDir = path.join(process.cwd(), ".next", "static", "chunks");
const serverDir = path.join(process.cwd(), ".next", "server");
const serverVendorDir = path.join(serverDir, "vendor-chunks");

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

if (fs.existsSync(serverDir)) {
  fs.mkdirSync(serverVendorDir, { recursive: true });
  for (const chunkName of findReferencedServerVendorChunks(serverDir)) {
    if (chunkName.endsWith("/")) continue;
    const target = path.join(serverDir, `${chunkName}.js`);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `exports.id=${JSON.stringify(chunkName)};exports.ids=[${JSON.stringify(chunkName)}];exports.modules={};\n`
    );
  }
}

function findReferencedServerVendorChunks(root) {
  const chunks = new Set();
  for (const file of walkJsFiles(root)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/"((?:vendor-chunks)\/[^"]+?)"/g)) {
      chunks.add(match[1]);
    }
  }
  return chunks;
}

function walkJsFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}
