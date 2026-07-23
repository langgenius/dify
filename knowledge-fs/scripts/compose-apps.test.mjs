import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, parseAllDocuments } from "yaml";

import { materializeDifyComposeEnv } from "./dify-compose-config.mjs";

const compose = readFileSync(new URL("../infra/local/compose.yaml", import.meta.url), "utf8");
const difyComposeFiles = [
  readFileSync(new URL("../../docker/docker-compose-template.yaml", import.meta.url), "utf8"),
  readFileSync(new URL("../../docker/docker-compose.yaml", import.meta.url), "utf8"),
];
const difyApiEnv = readFileSync(
  new URL("../../docker/envs/core-services/api.env.example", import.meta.url),
  "utf8",
);
const difyKnowledgeFsEnv = readFileSync(
  new URL("../../docker/envs/core-services/knowledge-fs.env.example", import.meta.url),
  "utf8",
);
const kubernetesBaseline = readFileSync(
  new URL("../infra/kubernetes/dify-integration-baseline.yaml", import.meta.url),
  "utf8",
);

function serviceBlock(source, serviceName) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `missing ${serviceName} service`);
  const relativeEnd = lines
    .slice(start + 1)
    .findIndex((line) => /^ {2}[a-zA-Z0-9_-]+:$/.test(line));
  const end = relativeEnd === -1 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start, end).join("\n");
}

function envVariableNames(source) {
  return source
    .split("\n")
    .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")));
}

test("deployment Compose and Kubernetes artifacts are valid YAML", () => {
  for (const source of [compose, ...difyComposeFiles]) {
    const document = parse(source);
    assert.equal(typeof document?.services, "object");
  }

  const documents = parseAllDocuments(kubernetesBaseline);
  assert.equal(documents.length, 4);
  for (const document of documents) {
    assert.deepEqual(document.errors, []);
  }
  assert.deepEqual(
    documents.map((document) => document.toJS().kind),
    ["ConfigMap", "Deployment", "Service", "NetworkPolicy"],
  );
});

test("Dify Compose config materializes a missing ignored env without replacing user config", () => {
  const directory = mkdtempSync(join(tmpdir(), "dify-compose-config-"));
  const envPath = join(directory, ".env");
  const examplePath = join(directory, ".env.example");

  try {
    writeFileSync(examplePath, "BASELINE=true\n");
    const removeMaterializedEnv = materializeDifyComposeEnv({ envPath, examplePath });
    assert.equal(readFileSync(envPath, "utf8"), "BASELINE=true\n");
    removeMaterializedEnv();
    assert.equal(existsSync(envPath), false);

    writeFileSync(envPath, "USER_CONFIG=true\n");
    const preserveUserEnv = materializeDifyComposeEnv({ envPath, examplePath });
    preserveUserEnv();
    assert.equal(readFileSync(envPath, "utf8"), "USER_CONFIG=true\n");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("app compose profile builds the API image with development-only static auth", () => {
  assert.match(compose, /^ {2}api:$/m);
  assert.match(compose, /^ {4}build:$/m);
  assert.match(compose, /^ {6}context: \.\.\/\.\.$/m);
  assert.match(compose, /^ {6}dockerfile: apps\/api\/Dockerfile$/m);
  assert.match(compose, /^ {4}image: knowledge-fs-api:local$/m);
  assert.match(compose, /^ {4}profiles: \["apps"\]$/m);
  assert.match(compose, /^ {6}NODE_ENV: development$/m);
  assert.match(compose, /^ {6}PORT: 8787$/m);
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_DEV_AUTH_TOKEN: \$\{KNOWLEDGE_DEV_AUTH_TOKEN:-dev-token\}$/m,
  );
  assert.doesNotMatch(compose, /^ {6}KNOWLEDGE_(?:EMBEDDING|RERANK|ANSWER)_/m);
});

test("app compose profile waits for local database and parser readiness before API startup", () => {
  assert.match(compose, /^ {4}depends_on:$/m);
  assert.match(compose, /^ {6}postgres:$/m);
  assert.match(compose, /^ {8}condition: service_healthy$/m);
  assert.match(compose, /^ {6}unstructured:$/m);
  assert.match(compose, /^ {8}condition: service_started$/m);
  assert.doesNotMatch(compose, /^ {2}minio(?:-bootstrap)?:$/m);
});

test("app compose profile uses local middleware and the required Dify dependency", () => {
  assert.match(
    compose,
    /^ {6}DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER:-knowledge_fs\}:\$\{POSTGRES_PASSWORD:-knowledge_fs\}@postgres:5432\/\$\{POSTGRES_DB:-knowledge_fs\}$/m,
  );
  assert.match(compose, /^ {6}UNSTRUCTURED_API_URL: http:\/\/unstructured:8000$/m);
  assert.match(
    compose,
    /^ {6}DIFY_INNER_API_URL: \$\{DIFY_INNER_API_URL:-http:\/\/host\.docker\.internal:5001\}$/m,
  );
  assert.match(compose, /^ {6}DIFY_INNER_API_KEY: \$\{DIFY_INNER_API_KEY:-\}$/m);
  assert.doesNotMatch(compose, /^ {6}(?:MINIO|R2|OPENAI|ANTHROPIC|COHERE|GEMINI|VOYAGE)_/m);
});

test("app compose profile builds Admin as a production image after API readiness", () => {
  assert.match(compose, /^ {2}admin:$/m);
  assert.match(compose, /^ {6}dockerfile: apps\/admin\/Dockerfile$/m);
  assert.match(compose, /^ {4}image: knowledge-fs-admin:local$/m);
  assert.match(compose, /^ {4}profiles: \["apps"\]$/m);
  assert.match(compose, /^ {6}api:$/m);
  assert.match(compose, /^ {8}condition: service_healthy$/m);
  assert.match(compose, /^ {6}HOSTNAME: 0\.0\.0\.0$/m);
  assert.match(compose, /^ {6}KNOWLEDGE_API_BASE_URL: http:\/\/api:8787$/m);
  assert.match(compose, /^ {6}NEXT_PUBLIC_API_BASE_URL: http:\/\/localhost:\$\{API_PORT:-8788\}$/m);
  assert.match(compose, /^ {6}NODE_ENV: production$/m);
  assert.match(compose, /^ {6}PORT: 3000$/m);
  assert.doesNotMatch(compose, /pnpm --filter @knowledge\/admin dev/);
  assert.doesNotMatch(compose, /^ {6}- \.:\/workspace$/m);
  assert.doesNotMatch(compose, /^ {2}pnpm-store:$/m);
});

test("Dify compose starts the integrated KnowledgeFS API by default and keeps it internal", () => {
  for (const difyCompose of difyComposeFiles) {
    const knowledgeFs = serviceBlock(difyCompose, "knowledge_fs");
    assert.doesNotMatch(knowledgeFs, /^ {4}profiles:/m);
    assert.match(
      knowledgeFs,
      /^ {4}image: \$\{KNOWLEDGE_FS_API_IMAGE:-langgenius\/dify-knowledge-fs-api:deploy-konwledge\}$/m,
    );
    assert.match(knowledgeFs, /^ {6}context: \.\.\/knowledge-fs$/m);
    assert.match(knowledgeFs, /^ {6}dockerfile: apps\/api\/Dockerfile$/m);
    assert.match(knowledgeFs, /^ {4}expose:$/m);
    assert.match(knowledgeFs, /^ {6}- "8787"$/m);
    assert.doesNotMatch(knowledgeFs, /^ {4}ports:$/m);
    assert.match(
      knowledgeFs,
      /^ {6}KNOWLEDGE_INTEGRATED_MODE_ENABLED: \$\{KNOWLEDGE_INTEGRATED_MODE_ENABLED:-true\}$/m,
    );
    assert.match(
      knowledgeFs,
      /^ {6}DIFY_INNER_API_URL: \$\{PLUGIN_DIFY_INNER_API_URL:-http:\/\/api:5001\}$/m,
    );
    assert.match(knowledgeFs, /^ {6}DIFY_INNER_API_KEY: \$\{PLUGIN_DIFY_INNER_API_KEY:-.+\}$/m);
    assert.doesNotMatch(knowledgeFs, /^ {6}PLUGIN_DAEMON_(?:URL|KEY):/m);
    assert.doesNotMatch(knowledgeFs, /^ {6}plugin_daemon:$/m);
    assert.match(knowledgeFs, /http:\/\/127\.0\.0\.1:8787\/ready/);
    assert.match(knowledgeFs, /^ {6}- default$/m);
  }
  assert.match(difyApiEnv, /^KNOWLEDGE_FS_ENABLED=\$\{KNOWLEDGE_FS_ENABLED:-false\}$/m);
});

test("KnowledgeFS deployment env contains only operator-owned runtime inputs", () => {
  assert.deepEqual(envVariableNames(difyKnowledgeFsEnv), [
    "DATABASE_URL",
    "KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME",
    "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED",
    "KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS",
    "UNSTRUCTURED_API_URL",
    "UNSTRUCTURED_API_KEY",
  ]);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=false$/m);
  assert.doesNotMatch(difyKnowledgeFsEnv, /^MINIO_/m);
});

test("deployment examples keep Dify KnowledgeFS rollout capabilities disabled", () => {
  for (const variable of [
    "KNOWLEDGE_FS_LIFECYCLE_WORKER_ENABLED",
    "KNOWLEDGE_FS_INTEGRATED_PROVISION_READY",
    "KNOWLEDGE_FS_LEGACY_ACL_FREEZE_READY",
  ]) {
    assert.match(difyApiEnv, new RegExp(`^${variable}=false$`, "m"));
  }
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_INTEGRATED_MODE_ENABLED: "false"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_LEGACY_AUTHORIZATION_REMOVED: "false"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "off"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: ""$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_DIRECT_STREAM_ENABLED: "off"$/m);
});

test("Kubernetes baseline starts at zero replicas with internal-only service and fail-closed probes", () => {
  assert.match(kubernetesBaseline, /^kind: Deployment$/m);
  assert.match(kubernetesBaseline, /^ {2}replicas: 0$/m);
  assert.match(kubernetesBaseline, /^ {14}path: \/health$/m);
  assert.match(kubernetesBaseline, /^ {14}path: \/ready$/m);
  assert.match(kubernetesBaseline, /^kind: Service$/m);
  assert.match(kubernetesBaseline, /^ {2}type: ClusterIP$/m);
  assert.match(kubernetesBaseline, /^kind: NetworkPolicy$/m);
  assert.match(kubernetesBaseline, /^ {2}policyTypes:$/m);
  assert.match(kubernetesBaseline, /^ {4}- Ingress$/m);
  assert.doesNotMatch(kubernetesBaseline, /^kind: Ingress$/m);
  assert.doesNotMatch(kubernetesBaseline, /\b(?:LoadBalancer|NodePort)\b/);
});
