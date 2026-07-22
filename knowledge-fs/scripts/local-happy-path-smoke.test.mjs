import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const smokeScript = readFileSync(new URL("./local-happy-path-smoke.mjs", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const localReadme = readFileSync(new URL("../infra/local/README.md", import.meta.url), "utf8");

test("root package exposes a local happy-path smoke command", () => {
  assert.equal(packageJson.scripts["local:happy-path"], "node scripts/local-happy-path-smoke.mjs");
  assert.equal(
    packageJson.scripts["local:happy-path:api"],
    "LOCAL_SMOKE_SKIP_ADMIN_BFF=1 LOCAL_SMOKE_SKIP_ADMIN_BUILD=1 node scripts/local-happy-path-smoke.mjs",
  );
  assert.equal(
    packageJson.scripts["local:happy-path:durable"],
    "LOCAL_SMOKE_RUN_MIGRATIONS=1 LOCAL_SMOKE_EXPECT_DURABLE=1 node scripts/local-happy-path-smoke.mjs",
  );
  assert.equal(
    packageJson.scripts["local:db:migrate"],
    "node --env-file-if-exists=infra/local/.env --import tsx apps/api/src/migrate.ts",
  );
  assert.match(packageJson.scripts.check, /local:happy-path:test/);
});

test("local happy-path smoke covers the core API endpoints without manual DB edits", () => {
  assert.match(smokeScript, /\/health/);
  assert.match(smokeScript, /LOCAL_SMOKE_RUN_MIGRATIONS/);
  assert.match(smokeScript, /LOCAL_SMOKE_EXPECT_DURABLE/);
  assert.match(smokeScript, /DATABASE_URL/);
  assert.match(smokeScript, /MINIO_ENDPOINT/);
  assert.match(smokeScript, /MINIO_BUCKET/);
  assert.match(smokeScript, /local:db:migrate/);
  assert.match(smokeScript, /\/knowledge-spaces\?limit=100/);
  assert.match(smokeScript, /\/knowledge-spaces/);
  assert.match(smokeScript, /\/documents/);
  assert.match(smokeScript, /\/parse-artifacts\/\$\{asset\.version\}/);
  assert.match(smokeScript, /\/queries/);
  assert.match(smokeScript, /local query evidence/);
  assert.match(smokeScript, /sourceId/);
  assert.match(smokeScript, /local-happy-path-smoke/);
});

test("local happy-path smoke exercises the Admin BFF upload route", () => {
  assert.match(smokeScript, /LOCAL_SMOKE_ADMIN_BASE/);
  assert.match(smokeScript, /LOCAL_SMOKE_SKIP_ADMIN_BFF/);
  assert.match(smokeScript, /\/api\/bff\/health/);
  assert.match(
    smokeScript,
    /\/api\/bff\/knowledge-spaces\/\$\{encodeURIComponent\(knowledgeSpaceId\)\}\/documents/,
  );
  assert.match(smokeScript, /uploadSmokeDocumentThroughAdminBff/);
});

test("local happy-path smoke reads API responses with an explicit byte bound", () => {
  assert.doesNotMatch(smokeScript, /response\.text\(\)/);
  assert.match(smokeScript, /getReader\(\)/);
  assert.match(smokeScript, /LOCAL_SMOKE_MAX_JSON_BYTES/);
  assert.match(smokeScript, /LOCAL_SMOKE_MAX_SSE_BYTES/);
});

test("README documents the source-run local happy path", () => {
  for (const doc of [readme, localReadme]) {
    assert.match(doc, /pnpm dev:infra/);
    assert.match(doc, /pnpm dev:api/);
    assert.match(doc, /LOCAL_SMOKE_RUN_MIGRATIONS=1 pnpm local:happy-path/);
    assert.match(doc, /pnpm local:happy-path:durable/);
    assert.match(doc, /LOCAL_SMOKE_ADMIN_BASE/);
    assert.match(doc, /pnpm local:happy-path:api/);
    assert.match(doc, /pnpm --filter @knowledge\/admin dev/);
    assert.match(doc, /pnpm local:happy-path/);
    assert.match(doc, /query evidence/);
  }
});
