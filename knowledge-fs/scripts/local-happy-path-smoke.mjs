#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const textDecoder = new TextDecoder();

const apiBase = normalizeBaseUrl(process.env.LOCAL_SMOKE_API_BASE ?? "http://127.0.0.1:8788");
const adminBase = normalizeBaseUrl(process.env.LOCAL_SMOKE_ADMIN_BASE ?? "http://127.0.0.1:3000");
const token = process.env.LOCAL_SMOKE_AUTH_TOKEN?.trim() || "dev-token";
const workspaceSlug = process.env.LOCAL_SMOKE_WORKSPACE_SLUG?.trim() || "workspace";
const workspaceName = process.env.LOCAL_SMOKE_WORKSPACE_NAME?.trim() || "Workspace";
const maxJsonBytes = Number.parseInt(process.env.LOCAL_SMOKE_MAX_JSON_BYTES ?? "1048576", 10);
const maxSseBytes = Number.parseInt(process.env.LOCAL_SMOKE_MAX_SSE_BYTES ?? "1048576", 10);
const expectDurable = process.env.LOCAL_SMOKE_EXPECT_DURABLE === "1";
const useAdminBff = process.env.LOCAL_SMOKE_SKIP_ADMIN_BFF !== "1";

if (!Number.isInteger(maxJsonBytes) || maxJsonBytes < 1) {
  throw new Error("LOCAL_SMOKE_MAX_JSON_BYTES must be a positive integer");
}

if (!Number.isInteger(maxSseBytes) || maxSseBytes < 1) {
  throw new Error("LOCAL_SMOKE_MAX_SSE_BYTES must be a positive integer");
}

await main();

async function main() {
  if (expectDurable) {
    assertDurableEnvironment();
  }

  if (process.env.LOCAL_SMOKE_SKIP_COMPOSE_CONFIG !== "1") {
    await runCommand("pnpm", ["compose:middleware:config"]);
  }

  if (process.env.LOCAL_SMOKE_RUN_MIGRATIONS === "1") {
    await runCommand("pnpm", ["local:db:migrate"]);
  }

  if (process.env.LOCAL_SMOKE_SKIP_ADMIN_BUILD !== "1") {
    await runCommand("pnpm", ["--filter", "@knowledge/admin", "build"]);
  }

  const health = await requestJson("/health", { expectedStatus: 200, method: "GET" });
  if (expectDurable) {
    assertDurableHealth(health);
  }
  if (useAdminBff) {
    await requestAdminJson("/api/bff/health", { expectedStatus: 200, method: "GET" });
  }
  const space = await ensureWorkspace();
  const asset = useAdminBff
    ? await uploadSmokeDocumentThroughAdminBff(space.id)
    : await uploadSmokeDocumentThroughApi(space.id);
  const documentAsset = await requestJson(
    `/knowledge-spaces/${encodeURIComponent(space.id)}/documents/${encodeURIComponent(asset.id)}`,
    { expectedStatus: 200, method: "GET" },
  );
  const artifact = await requestJson(
    `/knowledge-spaces/${encodeURIComponent(space.id)}/documents/${encodeURIComponent(asset.id)}/parse-artifacts/${asset.version}`,
    { expectedStatus: 200, method: "GET" },
  );

  assertString(documentAsset.id, "document id");
  assertString(artifact.id, "parse artifact id");

  const queryEvidence = await requestSse("/queries", {
    body: JSON.stringify({
      knowledgeSpaceId: space.id,
      mode: "fast",
      query: "What does the local happy path validate?",
    }),
    expectedStatus: 200,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assertContains(queryEvidence, "local query evidence", "query evidence answer");
  assertContains(queryEvidence, "answer.done", "query completion event");
  assertContains(queryEvidence, "node:", "query node citation");

  console.log(
    JSON.stringify(
      {
        artifactId: artifact.id,
        componentHealth: health.components ?? {},
        documentId: documentAsset.id,
        parserStatus: documentAsset.parserStatus,
        queryEvidence: true,
        spaceId: space.id,
        spaceSlug: space.slug,
      },
      null,
      2,
    ),
  );
}

async function ensureWorkspace() {
  const listed = await requestJson("/knowledge-spaces?limit=100", {
    expectedStatus: 200,
    method: "GET",
  });
  const existing = Array.isArray(listed.items)
    ? listed.items.find((item) => item?.slug === workspaceSlug)
    : undefined;
  if (existing) {
    return parseKnowledgeSpace(existing);
  }

  const created = await requestJson("/knowledge-spaces", {
    body: JSON.stringify({ name: workspaceName, slug: workspaceSlug }),
    expectedStatus: [201, 409],
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!("error" in created)) {
    return parseKnowledgeSpace(created);
  }

  const relisted = await requestJson("/knowledge-spaces?limit=100", {
    expectedStatus: 200,
    method: "GET",
  });
  const raced = Array.isArray(relisted.items)
    ? relisted.items.find((item) => item?.slug === workspaceSlug)
    : undefined;
  if (!raced) {
    throw new Error(`KnowledgeSpace slug ${workspaceSlug} was not found after create conflict`);
  }
  return parseKnowledgeSpace(raced);
}

async function uploadSmokeDocumentThroughAdminBff(knowledgeSpaceId) {
  return uploadSmokeDocument(knowledgeSpaceId, "admin-bff");
}

async function uploadSmokeDocumentThroughApi(knowledgeSpaceId) {
  return uploadSmokeDocument(knowledgeSpaceId, "api");
}

async function uploadSmokeDocument(knowledgeSpaceId, target) {
  const formData = new FormData();
  formData.set("sourceId", "local-happy-path-smoke");
  formData.set(
    "file",
    new File(
      [
        [
          "# Local happy path",
          "",
          "This Markdown document validates workspace bootstrap, upload, parsing, artifact reads, node generation, and local query evidence.",
        ].join("\n"),
      ],
      "local-happy-path-smoke.md",
      { type: "text/markdown" },
    ),
  );

  const apiUploadPath = `/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/documents`;
  const adminBffUploadPath = `/api/bff/knowledge-spaces/${encodeURIComponent(knowledgeSpaceId)}/documents`;
  const request = {
    body: formData,
    expectedStatus: 201,
    method: "POST",
  };

  return target === "admin-bff"
    ? requestAdminJson(adminBffUploadPath, request)
    : requestJson(apiUploadPath, request);
}

async function requestSse(path, options) {
  const response = await fetch(new URL(path, apiBase), {
    body: options.body,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
    method: options.method,
  });
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus];
  const payload = await readBoundedText(response, maxSseBytes, "LOCAL_SMOKE_MAX_SSE_BYTES");

  if (!expected.includes(response.status)) {
    throw new Error(`${options.method} ${path} returned ${response.status}: ${payload}`);
  }

  return payload;
}

async function requestJson(path, options) {
  return requestJsonFromBase(apiBase, path, options);
}

async function requestAdminJson(path, options) {
  return requestJsonFromBase(adminBase, path, options);
}

async function requestJsonFromBase(baseUrl, path, options) {
  const response = await fetch(new URL(path, baseUrl), {
    body: options.body,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
    method: options.method,
  });
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus];
  const payload = await readBoundedJson(response);

  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

async function readBoundedJson(response) {
  const text = await readBoundedText(response, maxJsonBytes, "LOCAL_SMOKE_MAX_JSON_BYTES");
  return text ? JSON.parse(text) : {};
}

async function readBoundedText(response, maxBytes, label) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`Smoke response exceeded ${label}=${maxBytes}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return textDecoder.decode(bytes);
}

function parseKnowledgeSpace(value) {
  if (!value || typeof value !== "object") {
    throw new Error("KnowledgeSpace response is invalid");
  }
  const id = value.id;
  const slug = value.slug;
  if (typeof id !== "string" || typeof slug !== "string") {
    throw new Error("KnowledgeSpace response is invalid");
  }
  return { id, slug };
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Expected ${label}`);
  }
}

function assertContains(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Expected ${label} to contain ${expected}`);
  }
}

function assertDurableEnvironment() {
  for (const name of ["DATABASE_URL", "DIFY_INNER_API_KEY", "DIFY_INNER_API_URL"]) {
    if (!process.env[name]?.trim()) {
      throw new Error(`LOCAL_SMOKE_EXPECT_DURABLE requires ${name}`);
    }
  }
}

function assertDurableHealth(health) {
  if (!health || typeof health !== "object") {
    throw new Error("Durable smoke health response is invalid");
  }

  const components = health.components;
  if (!components || typeof components !== "object") {
    throw new Error("Durable smoke health response is missing components");
  }

  for (const component of ["database", "objectStorage"]) {
    if (components[component] !== true) {
      throw new Error(`Durable smoke expected healthy ${component}`);
    }
  }
}

async function runCommand(command, args) {
  const { stderr, stdout } = await execFileAsync(command, args, {
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout.trim()) {
    console.log(stdout.trim());
  }
  if (stderr.trim()) {
    console.error(stderr.trim());
  }
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("LOCAL_SMOKE_API_BASE must not be empty");
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}
