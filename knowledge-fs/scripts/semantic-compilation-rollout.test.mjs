import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";

const rootPackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scriptUrl = new URL("./semantic-compilation-rollout.mjs", import.meta.url);
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";

test("static rollout evidence is safe and includes migration 0043", async () => {
  const result = await runScript({ SEMANTIC_ROLLOUT_MODE: "static" });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "static");
  assert.equal(payload.staticEvidence.migrationId, "0043_semantic_generation_receipts");
});

test("mutating rollout modes require an exact space-scoped confirmation", async () => {
  const result = await runScript({
    SEMANTIC_ROLLOUT_DOCUMENT_IDS: documentId,
    SEMANTIC_ROLLOUT_MODE: "canary",
    SEMANTIC_ROLLOUT_SPACE_ID: spaceId,
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SEMANTIC_ROLLOUT_APPLY=1 is required/u);
});

test("preflight is read-only, bounded, and reports durable state", async (context) => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/health") {
      response.end(JSON.stringify({ components: { database: true, objectStorage: true } }));
      return;
    }
    if (request.url?.endsWith("/settings")) {
      response.end(JSON.stringify({ configurationState: "active" }));
      return;
    }
    if (request.url?.includes("/documents?")) {
      response.end(JSON.stringify({ items: [{ id: documentId }] }));
      return;
    }
    if (request.url?.includes("/background-tasks?")) {
      response.end(JSON.stringify({ items: [] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert(address && typeof address === "object");

  const result = await runScript({
    SEMANTIC_ROLLOUT_API_BASE: `http://127.0.0.1:${address.port}`,
    SEMANTIC_ROLLOUT_MODE: "preflight",
    SEMANTIC_ROLLOUT_SPACE_ID: spaceId,
  });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.preflight.configurationState, "active");
  assert.equal(payload.preflight.documentCount, 1);
  assert.deepEqual(
    requests.map((request) => request.method),
    ["GET", "GET", "GET", "GET"],
  );
});

test("canary reindexes only explicit documents and verifies the published outline", async (context) => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ body, method: request.method, url: request.url });
    response.setHeader("content-type", "application/json");
    if (request.url === "/health") {
      response.end(JSON.stringify({ components: { database: true, objectStorage: true } }));
      return;
    }
    if (request.url?.endsWith("/settings")) {
      response.end(JSON.stringify({ configurationState: "active" }));
      return;
    }
    if (request.url?.includes("/documents?")) {
      response.end(JSON.stringify({ items: [{ id: documentId }] }));
      return;
    }
    if (request.url?.includes("/background-tasks?")) {
      response.end(JSON.stringify({ items: [] }));
      return;
    }
    if (request.method === "POST" && request.url?.endsWith("/documents/bulk/reindex")) {
      response.statusCode = 202;
      response.end(
        JSON.stringify({
          bulkJobId: "bulk-canary",
          items: [
            {
              asset: { id: documentId },
              status: "queued",
              statusUrl: "/jobs/canary",
            },
          ],
        }),
      );
      return;
    }
    if (request.url === "/jobs/canary") {
      response.end(JSON.stringify({ stage: "published" }));
      return;
    }
    if (request.url?.endsWith(`/documents/${documentId}/outline`)) {
      response.end(
        JSON.stringify({
          nodes: [{ sectionPath: ["Canary"], sourceNodeIds: ["node-1"] }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert(address && typeof address === "object");

  const result = await runScript({
    SEMANTIC_ROLLOUT_API_BASE: `http://127.0.0.1:${address.port}`,
    SEMANTIC_ROLLOUT_APPLY: "1",
    SEMANTIC_ROLLOUT_CONFIRM: `semantic:canary:${spaceId}`,
    SEMANTIC_ROLLOUT_DOCUMENT_IDS: documentId,
    SEMANTIC_ROLLOUT_MAX_POLLS: "1",
    SEMANTIC_ROLLOUT_MODE: "canary",
    SEMANTIC_ROLLOUT_SPACE_ID: spaceId,
  });
  assert.equal(result.code, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.documentsQueued, 1);
  const mutation = requests.find((request) => request.method === "POST");
  assert.deepEqual(JSON.parse(mutation?.body ?? "{}"), { documentIds: [documentId] });
});

test("package scripts expose explicit rollout phases and keep their tests in check", () => {
  assert.equal(
    rootPackage.scripts["semantic:rollout:static"],
    "node scripts/semantic-compilation-rollout.mjs",
  );
  assert.match(
    rootPackage.scripts["semantic:rollout:preflight"],
    /SEMANTIC_ROLLOUT_MODE=preflight/u,
  );
  assert.match(rootPackage.scripts["semantic:rollout:canary"], /SEMANTIC_ROLLOUT_MODE=canary/u);
  assert.match(rootPackage.scripts["semantic:rollout:backfill"], /SEMANTIC_ROLLOUT_MODE=backfill/u);
  assert.match(rootPackage.scripts["semantic:rollout:rollback"], /SEMANTIC_ROLLOUT_MODE=rollback/u);
  assert.equal(
    rootPackage.scripts["semantic:rollout:test"],
    "node --test scripts/semantic-compilation-rollout.test.mjs",
  );
  assert.match(rootPackage.scripts.check, /semantic:rollout:test/u);
});

function runScript(extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptUrl.pathname], {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}
