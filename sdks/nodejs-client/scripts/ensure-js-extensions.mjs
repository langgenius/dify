import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distRoot = path.resolve(__dirname, "..", "dist");

const isTargetFile = (filename) =>
  filename.endsWith(".js") || filename.endsWith(".d.ts");
const skipExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".node"]);

const shouldAppendJs = (specifier) => {
  if (!specifier.startsWith(".")) {
    return false;
  }
  if (specifier.endsWith("/")) {
    return false;
  }
  const ext = path.extname(specifier);
  if (ext && skipExtensions.has(ext)) {
    return false;
  }
  return ext.length === 0;
};

const appendJs = (specifier) =>
  shouldAppendJs(specifier) ? `${specifier}.js` : specifier;

const rewriteImportSpecifiers = (source) => {
  let next = source;
  next = next.replace(
    /(\b(?:import|export)\s+[^'"]*?\sfrom\s+)(["'])([^"']+)\2/g,
    (match, prefix, quote, specifier) =>
      `${prefix}${quote}${appendJs(specifier)}${quote}`
  );
  next = next.replace(
    /(\bimport\s+)(["'])([^"']+)\2/g,
    (match, prefix, quote, specifier) =>
      `${prefix}${quote}${appendJs(specifier)}${quote}`
  );
  next = next.replace(
    /(\bimport\()\s*(["'])([^"']+)\2(\s*\))/g,
    (match, prefix, quote, specifier, suffix) =>
      `${prefix}${quote}${appendJs(specifier)}${quote}${suffix}`
  );
  return next;
};

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (isTargetFile(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
};

const main = async () => {
  const files = await walk(distRoot);
  for (const file of files) {
    const original = await readFile(file, "utf8");
    const updated = rewriteImportSpecifiers(original);
    if (updated !== original) {
      await writeFile(file, updated, "utf8");
    }
  }
};

main().catch((error) => {
  console.error("Failed to rewrite import specifiers:", error);
  process.exitCode = 1;
});
