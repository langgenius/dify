import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("GitHub Flow workflow has PR/main/manual triggers and concurrency", () => {
  assert.match(workflow, /^name: GitHub Flow$/m);
  assert.match(workflow, /^ {2}pull_request:$/m);
  assert.match(workflow, /^ {2}push:$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:$/m);
  assert.match(workflow, /^concurrency:$/m);
  assert.match(workflow, /cancel-in-progress: true/);
});

test("GitHub Flow workflow gates Node quality checks without duplicate regression runs", () => {
  assert.match(workflow, /^ {2}quality:$/m);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /run: pnpm check/);
  assert.match(workflow, /run: pnpm build/);
  assert.match(workflow, /run: pnpm lint/);
  assert.match(workflow, /run: pnpm compose:apps:test/);
  assert.match(workflow, /run: pnpm compose:config/);
  assert.match(
    workflow,
    /run: docker compose --env-file infra\/local\/\.env\.example -f infra\/local\/compose\.yaml --profile apps config/,
  );
  assert.doesNotMatch(workflow, /run: pnpm eval:regression/);
});

test("GitHub Flow gates production image builds and isolated API bundle startup", () => {
  assert.doesNotMatch(workflow, /rust-wasm/);
  assert.doesNotMatch(workflow, /rustup/);
  assert.doesNotMatch(workflow, /cargo/);
  assert.doesNotMatch(workflow, /wasm/i);
  assert.match(workflow, /^ {2}docker-image:$/m);
  assert.match(workflow, /needs: \[quality\]/);
  assert.match(workflow, /run: pnpm docker:api:build/);
  assert.match(workflow, /run: pnpm docker:admin:build/);
  assert.match(workflow, /name: Smoke isolated API bundle/);
  assert.match(workflow, /run: pnpm docker:api:bundle-smoke/);
  assert.doesNotMatch(workflow, /run: pnpm docker:api:http-smoke/);
  assert.match(workflow, /run: pnpm docker:admin:http-smoke/);
  assert.equal(packageJson.scripts["docker:api:smoke"], undefined);
  assert.deepEqual(
    Object.keys(packageJson.scripts).filter((name) => /(cargo|rust|wasm)/i.test(name)),
    [],
  );
  assert.equal(
    packageJson.scripts["docker:admin:build"],
    "docker build -f apps/admin/Dockerfile -t knowledge-fs-admin:local .",
  );
  assert.equal(
    packageJson.scripts["docker:admin:http-smoke"],
    "node scripts/admin-image-http-smoke.mjs",
  );
  assert.match(packageJson.scripts["docker:apps:smoke"], /pnpm docker:api:build/);
  assert.match(packageJson.scripts["docker:apps:smoke"], /pnpm docker:admin:build/);
  assert.match(packageJson.scripts["docker:apps:smoke"], /pnpm docker:api:bundle-smoke/);
  assert.doesNotMatch(packageJson.scripts["docker:apps:smoke"], /docker:api:http-smoke/);
  assert.match(packageJson.scripts["docker:apps:smoke"], /pnpm docker:admin:http-smoke/);
  assert.equal(
    packageJson.scripts["docker:api:bundle-smoke"],
    "node scripts/api-image-bundle-smoke.mjs",
  );
  assert.equal(packageJson.scripts["docker:api:http-smoke"], "pnpm docker:api:bundle-smoke");
  assert.match(packageJson.scripts.check, /docker:api:bundle-smoke:test/);
  assert.doesNotMatch(packageJson.scripts.check, /docker:api:http-smoke:test/);
  assert.doesNotMatch(packageJson.scripts.check, /wasm/i);
  assert.match(packageJson.scripts.check, /docker:admin:http-smoke:test/);
  assert.match(packageJson.scripts.check, /docker:apps:smoke:test/);
  assert.match(packageJson.scripts.check, /docker:context:test/);
  assert.match(packageJson.scripts.check, /compose:apps:test/);
});
