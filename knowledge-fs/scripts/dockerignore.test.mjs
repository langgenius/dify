import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");

test("Docker build context excludes nested build artifacts and dependencies", () => {
  for (const pattern of ["**/.next", "**/.turbo", "**/coverage", "**/dist", "**/node_modules"]) {
    assert.match(dockerignore, new RegExp(`^${escapeRegExp(pattern)}$`, "m"));
  }
});

test("Docker build context does not ignore source workspaces", () => {
  assert.doesNotMatch(dockerignore, /^apps$/m);
  assert.doesNotMatch(dockerignore, /^packages$/m);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
