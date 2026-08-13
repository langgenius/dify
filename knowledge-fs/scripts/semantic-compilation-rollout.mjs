#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const textDecoder = new TextDecoder();
const mode = process.env.SEMANTIC_ROLLOUT_MODE?.trim() || "static";
const supportedModes = new Set(["backfill", "canary", "preflight", "rollback", "static"]);
const mutatingModes = new Set(["backfill", "canary", "rollback"]);
const apiBase = normalizeBaseUrl(process.env.SEMANTIC_ROLLOUT_API_BASE ?? "http://127.0.0.1:8788");
const token = process.env.SEMANTIC_ROLLOUT_AUTH_TOKEN?.trim() || "dev-token";
const maxJsonBytes = positiveInteger(
  process.env.SEMANTIC_ROLLOUT_MAX_JSON_BYTES ?? "1048576",
  "SEMANTIC_ROLLOUT_MAX_JSON_BYTES",
);
const maxPolls = positiveInteger(
  process.env.SEMANTIC_ROLLOUT_MAX_POLLS ?? "120",
  "SEMANTIC_ROLLOUT_MAX_POLLS",
);
const pollIntervalMs = nonnegativeInteger(
  process.env.SEMANTIC_ROLLOUT_POLL_INTERVAL_MS ?? "2000",
  "SEMANTIC_ROLLOUT_POLL_INTERVAL_MS",
);

if (!supportedModes.has(mode)) {
  throw new Error(`Unsupported SEMANTIC_ROLLOUT_MODE=${mode}`);
}

const staticEvidence = await verifyStaticEvidence();
if (mode === "static") {
  printResult({ mode, staticEvidence });
  process.exit(0);
}

const knowledgeSpaceId = requiredUuid(
  process.env.SEMANTIC_ROLLOUT_SPACE_ID,
  "SEMANTIC_ROLLOUT_SPACE_ID",
);
if (mutatingModes.has(mode)) {
  assertMutationConfirmation(mode, knowledgeSpaceId);
}

const preflight = await runPreflight(knowledgeSpaceId);
if (mode === "preflight") {
  printResult({ knowledgeSpaceId, mode, preflight, staticEvidence });
  process.exit(0);
}

if (mode === "canary") {
  const documentIds = requiredUuidList(
    process.env.SEMANTIC_ROLLOUT_DOCUMENT_IDS,
    "SEMANTIC_ROLLOUT_DOCUMENT_IDS",
  );
  const result = await reindexDocuments({ documentIds, knowledgeSpaceId });
  await verifyOutlines(knowledgeSpaceId, documentIds);
  const retrieval = await verifyRetrievalIfConfigured(knowledgeSpaceId);
  printResult({ knowledgeSpaceId, mode, preflight, result, retrieval, staticEvidence });
  process.exit(0);
}

if (mode === "backfill") {
  const result = await reindexDocuments({ all: true, knowledgeSpaceId });
  const documentIds = result.items
    .map((item) => item?.asset?.id)
    .filter((value) => typeof value === "string");
  await verifyOutlines(knowledgeSpaceId, documentIds);
  const retrieval = await verifyRetrievalIfConfigured(knowledgeSpaceId);
  printResult({ knowledgeSpaceId, mode, preflight, result, retrieval, staticEvidence });
  process.exit(0);
}

const rollback = await rollbackDocument(knowledgeSpaceId);
printResult({ knowledgeSpaceId, mode, preflight, rollback, staticEvidence });

async function verifyStaticEvidence() {
  const expectedMigrationId = "0043_semantic_generation_receipts";
  const paths = [
    `packages/database/migrations/${expectedMigrationId}.postgres.sql`,
    `packages/database/migrations/${expectedMigrationId}.tidb.sql`,
  ];
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    if (
      !source.includes(expectedMigrationId) ||
      !source.includes("knowledge_node_generation_receipts")
    ) {
      throw new Error(`Semantic receipt migration evidence is incomplete in ${path}`);
    }
  }
  const registry = await readFile(
    new URL("../packages/database/src/migration-artifacts.generated.ts", import.meta.url),
    "utf8",
  );
  if (!registry.includes(expectedMigrationId)) {
    throw new Error(
      "Generated migration registry does not contain semantic receipt migration 0043",
    );
  }
  return { migrationId: expectedMigrationId, registry: "present" };
}

async function runPreflight(spaceId) {
  const encoded = encodeURIComponent(spaceId);
  const [health, settings, documents, tasks] = await Promise.all([
    requestJson("/health", { expectedStatus: 200, method: "GET" }),
    requestJson(`/knowledge-spaces/${encoded}/settings`, {
      expectedStatus: 200,
      method: "GET",
    }),
    requestJson(`/knowledge-spaces/${encoded}/documents?limit=100`, {
      expectedStatus: 200,
      method: "GET",
    }),
    requestJson(`/knowledge-spaces/${encoded}/background-tasks?limit=50`, {
      expectedStatus: 200,
      method: "GET",
    }),
  ]);
  if (!health || typeof health !== "object") throw new Error("KnowledgeFS health is invalid");
  if (health.components?.database === false || health.components?.objectStorage === false) {
    throw new Error("KnowledgeFS durable dependencies are unhealthy");
  }
  if (!settings || typeof settings !== "object")
    throw new Error("KnowledgeFS settings are invalid");
  if (!Array.isArray(documents.items)) throw new Error("KnowledgeFS document list is invalid");
  if (!Array.isArray(tasks.items)) throw new Error("KnowledgeFS background-task list is invalid");
  const activeFailures = tasks.items.filter(
    (task) => task?.state === "failed" && task?.operation === "document_reindex",
  );
  return {
    activeReindexFailures: activeFailures.length,
    configurationState: settings.configurationState ?? settings.configuration_state ?? "unknown",
    documentCount: documents.items.length,
    healthComponents: health.components ?? {},
  };
}

async function reindexDocuments(input) {
  const body = input.all ? { all: true } : { documentIds: input.documentIds };
  const result = await requestJson(
    `/knowledge-spaces/${encodeURIComponent(input.knowledgeSpaceId)}/documents/bulk/reindex`,
    {
      body: JSON.stringify(body),
      expectedStatus: 202,
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!Array.isArray(result.items) || typeof result.bulkJobId !== "string") {
    throw new Error("Bulk reindex response is invalid");
  }
  const rejected = result.items.filter((item) => item?.status !== "queued");
  if (rejected.length > 0) {
    throw new Error(`Bulk reindex rejected ${rejected.length} document(s)`);
  }
  for (const item of result.items) {
    const statusUrl = requiredString(item.statusUrl, "bulk reindex statusUrl");
    await pollTask(statusUrl);
  }
  return {
    bulkJobId: result.bulkJobId,
    documentsQueued: result.items.length,
    items: result.items,
  };
}

async function rollbackDocument(spaceId) {
  const documentId = requiredUuid(
    process.env.SEMANTIC_ROLLOUT_ROLLBACK_DOCUMENT_ID,
    "SEMANTIC_ROLLOUT_ROLLBACK_DOCUMENT_ID",
  );
  const targetRevision = positiveInteger(
    process.env.SEMANTIC_ROLLOUT_ROLLBACK_REVISION,
    "SEMANTIC_ROLLOUT_ROLLBACK_REVISION",
  );
  const encodedSpace = encodeURIComponent(spaceId);
  const encodedDocument = encodeURIComponent(documentId);
  const current = await requestJson(
    `/knowledge-spaces/${encodedSpace}/logical-documents/${encodedDocument}`,
    { expectedStatus: 200, method: "GET" },
  );
  const expectedActiveRevision = positiveInteger(
    current.activeRevision,
    "logical document activeRevision",
  );
  const expectedRowVersion = nonnegativeInteger(current.rowVersion, "logical document rowVersion");
  const task = await requestJson(
    `/knowledge-spaces/${encodedSpace}/documents/${encodedDocument}/revisions/${targetRevision}/rollback`,
    {
      body: JSON.stringify({ expectedActiveRevision, expectedRowVersion }),
      expectedStatus: 202,
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const taskId = requiredUuid(task.id, "rollback task id");
  await pollTask(
    `/knowledge-spaces/${encodedSpace}/documents/${encodedDocument}/processing-tasks/${encodeURIComponent(taskId)}`,
  );
  const restored = await requestJson(
    `/knowledge-spaces/${encodedSpace}/logical-documents/${encodedDocument}`,
    { expectedStatus: 200, method: "GET" },
  );
  if (restored.activeRevision !== targetRevision) {
    throw new Error(
      `Rollback completed without activating revision ${targetRevision}; observed ${String(restored.activeRevision)}`,
    );
  }
  return { documentId, fromRevision: expectedActiveRevision, taskId, toRevision: targetRevision };
}

async function verifyOutlines(spaceId, documentIds) {
  for (const documentId of documentIds) {
    const outline = await requestJson(
      `/knowledge-spaces/${encodeURIComponent(spaceId)}/documents/${encodeURIComponent(documentId)}/outline`,
      { expectedStatus: 200, method: "GET" },
    );
    if (!Array.isArray(outline.nodes) || outline.nodes.length === 0) {
      throw new Error(`Semantic outline is empty for document ${documentId}`);
    }
    if (
      outline.nodes.some(
        (node) => !Array.isArray(node?.sectionPath) || !Array.isArray(node?.sourceNodeIds),
      )
    ) {
      throw new Error(`Semantic outline provenance is incomplete for document ${documentId}`);
    }
  }
}

async function verifyRetrievalIfConfigured(spaceId) {
  const query = process.env.SEMANTIC_ROLLOUT_QUERY?.trim();
  if (!query) return { checked: false };
  const result = await requestJson(
    `/knowledge-spaces/${encodeURIComponent(spaceId)}/retrieval-tests`,
    {
      body: JSON.stringify({ includeText: true, mode: "research", query }),
      expectedStatus: 200,
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  if (!Array.isArray(result.items)) throw new Error("Retrieval verification response is invalid");
  const minimumItems = nonnegativeInteger(
    process.env.SEMANTIC_ROLLOUT_MIN_RETRIEVAL_ITEMS ?? "1",
    "SEMANTIC_ROLLOUT_MIN_RETRIEVAL_ITEMS",
  );
  if (result.items.length < minimumItems) {
    throw new Error(
      `Retrieval verification returned ${result.items.length} item(s); expected at least ${minimumItems}`,
    );
  }
  return { checked: true, itemCount: result.items.length, mode: result.mode ?? "research" };
}

async function pollTask(path) {
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const task = await requestJson(path, { expectedStatus: 200, method: "GET" });
    const terminalState = task.state ?? task.stage;
    if (["completed", "published", "ready", "smoke_eval_passed"].includes(terminalState)) {
      return task;
    }
    if (["canceled", "failed"].includes(terminalState)) {
      throw new Error(`Rollout task ${path} ended in ${terminalState}: ${task.errorMessage ?? ""}`);
    }
    if (poll < maxPolls) await delay(pollIntervalMs);
  }
  throw new Error(`Rollout task ${path} exceeded SEMANTIC_ROLLOUT_MAX_POLLS=${maxPolls}`);
}

async function requestJson(path, options) {
  const response = await fetch(new URL(path, apiBase), {
    body: options.body,
    headers: { authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    method: options.method,
  });
  const payload = await readBoundedJson(response);
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus];
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function readBoundedJson(response) {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxJsonBytes) {
        throw new Error(
          `Rollout response exceeded SEMANTIC_ROLLOUT_MAX_JSON_BYTES=${maxJsonBytes}`,
        );
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
  const text = textDecoder.decode(bytes);
  return text ? JSON.parse(text) : {};
}

function assertMutationConfirmation(selectedMode, spaceId) {
  if (process.env.SEMANTIC_ROLLOUT_APPLY !== "1") {
    throw new Error(`SEMANTIC_ROLLOUT_APPLY=1 is required for ${selectedMode}`);
  }
  const expected = `semantic:${selectedMode}:${spaceId}`;
  if (process.env.SEMANTIC_ROLLOUT_CONFIRM !== expected) {
    throw new Error(`SEMANTIC_ROLLOUT_CONFIRM must equal ${expected}`);
  }
}

function requiredUuid(value, name) {
  const normalized = requiredString(value, name);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(normalized)
  ) {
    throw new Error(`${name} must be a UUID`);
  }
  return normalized;
}

function requiredUuidList(value, name) {
  const items = requiredString(value, name)
    .split(",")
    .map((item) => requiredUuid(item.trim(), name));
  return [...new Set(items)];
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function positiveInteger(value, name) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be at least 1`);
  return parsed;
}

function nonnegativeInteger(value, name) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  const normalized = requiredString(value, "SEMANTIC_ROLLOUT_API_BASE");
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function printResult(value) {
  console.log(JSON.stringify(value, null, 2));
}
