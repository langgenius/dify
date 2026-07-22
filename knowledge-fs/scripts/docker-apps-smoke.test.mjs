import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("root package exposes an app image smoke command with an isolated API bundle check", () => {
  assert.equal(
    packageJson.scripts["docker:apps:smoke"],
    [
      "pnpm docker:api:build",
      "pnpm docker:admin:build",
      "pnpm docker:api:bundle-smoke",
      "pnpm docker:admin:http-smoke",
    ].join(" && "),
  );
});

test("app image smoke keeps static tests in the default check gate", () => {
  assert.equal(
    packageJson.scripts["docker:apps:smoke:test"],
    "node --test scripts/docker-apps-smoke.test.mjs",
  );
  assert.match(packageJson.scripts.check, /docker:apps:smoke:test/);
});
