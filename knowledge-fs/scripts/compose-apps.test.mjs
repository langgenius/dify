import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function materializedDifyKnowledgeFsEnvironment(rootOverrides = {}) {
  const dockerRoot = new URL("../../docker/", import.meta.url);
  const env = { ...process.env };
  for (const name of [
    "KNOWLEDGE_PDF_RASTERIZER",
    "KNOWLEDGE_PDF_RASTERIZER_DPI",
    "KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS",
    "KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY",
    "KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI",
    "KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS",
  ]) {
    delete env[name];
  }
  Object.assign(env, rootOverrides);

  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      dockerRoot.pathname,
      "--env-file",
      new URL(".env.example", dockerRoot).pathname,
      "-f",
      new URL("docker-compose.yaml", dockerRoot).pathname,
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8", env },
  );

  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).services.knowledge_fs.environment;
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
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_API_URL: \$\{UNSTRUCTURED_API_URL:-http:\/\/unstructured:8000\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_MAX_CONCURRENCY: \$\{UNSTRUCTURED_MAX_CONCURRENCY:-2\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_REQUEST_TIMEOUT_MS: \$\{UNSTRUCTURED_REQUEST_TIMEOUT_MS:-120000\}$/m,
  );
  assert.match(
    compose,
    /^ {6}DIFY_INNER_API_URL: \$\{DIFY_INNER_API_URL:-http:\/\/host\.docker\.internal:5001\}$/m,
  );
  assert.match(compose, /^ {6}DIFY_INNER_API_KEY: \$\{DIFY_INNER_API_KEY:-\}$/m);
  assert.doesNotMatch(compose, /^ {6}(?:MINIO|R2|OPENAI|ANTHROPIC|COHERE|GEMINI|VOYAGE)_/m);
});

test("app compose profile enables the bundled PDF rasterizer with bounded defaults", () => {
  assert.match(compose, /^ {6}KNOWLEDGE_PDF_RASTERIZER: \$\{KNOWLEDGE_PDF_RASTERIZER:-poppler\}$/m);
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_PDF_RASTERIZER_DPI: \$\{KNOWLEDGE_PDF_RASTERIZER_DPI:-144\}$/m,
  );
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: \$\{KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI:-48\}$/m,
  );
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS: \$\{KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS:-30000\}$/m,
  );
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS: \$\{KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS:-500\}$/m,
  );
  assert.match(
    compose,
    /^ {6}KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: \$\{KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY:-2\}$/m,
  );
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
    assert.match(knowledgeFs, /^ {6}- path: \.\/envs\/core-services\/knowledge-fs\.env$/m);
    assert.match(knowledgeFs, /whitelisted proxies/);
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
    assert.doesNotMatch(knowledgeFs, /^ {6}KNOWLEDGE_PDF_RASTERIZER:/m);
    assert.doesNotMatch(
      knowledgeFs,
      /^ {6}KNOWLEDGE_PDF_RASTERIZER_(?:DPI|MAX_ASSETS|MAX_CONCURRENCY|TIMEOUT_MS|THUMBNAIL_DPI):/m,
    );
    for (const suffix of [
      "",
      "_DPI",
      "_MAX_ASSETS",
      "_MAX_CONCURRENCY",
      "_THUMBNAIL_DPI",
      "_TIMEOUT_MS",
    ]) {
      const canonicalName = `KNOWLEDGE_PDF_RASTERIZER${suffix}`;
      assert.ok(
        knowledgeFs.includes(
          `      DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER${suffix}_OVERRIDE: \${${canonicalName}-}`,
        ),
      );
    }
  }
  assert.match(difyApiEnv, /^KNOWLEDGE_FS_ENABLED=\$\{KNOWLEDGE_FS_ENABLED:-false\}$/m);
});

test("Dify Compose whitelists root PDF overrides without shadowing service values when unset", () => {
  const withoutRootOverrides = materializedDifyKnowledgeFsEnvironment({
    ROOT_ONLY_TEST_SECRET: "must-not-enter-container",
  });
  assert.equal(withoutRootOverrides.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE, "");
  assert.equal(
    withoutRootOverrides.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE,
    "",
  );
  assert.equal(withoutRootOverrides.ROOT_ONLY_TEST_SECRET, undefined);

  const withRootOverrides = materializedDifyKnowledgeFsEnvironment({
    KNOWLEDGE_PDF_RASTERIZER: "off",
    KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: "6",
  });
  assert.equal(withRootOverrides.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_OVERRIDE, "off");
  assert.equal(withRootOverrides.DIFY_ROOT_KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY_OVERRIDE, "6");
});

test("KnowledgeFS deployment env contains only operator-owned runtime inputs", () => {
  assert.deepEqual(envVariableNames(difyKnowledgeFsEnv), [
    "DATABASE_URL",
    "KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME",
    "KNOWLEDGE_PDF_RASTERIZER",
    "KNOWLEDGE_PDF_RASTERIZER_DPI",
    "KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI",
    "KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS",
    "KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS",
    "KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY",
    "KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY",
    "KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE",
    "KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS",
    "KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY",
    "KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE",
    "KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY",
    "KNOWLEDGE_EMBEDDING_REQUEST_CONCURRENCY",
    "KNOWLEDGE_FS_CAPABILITY_V2_ENABLED",
    "KNOWLEDGE_FS_CAPABILITY_V2_PUBLIC_JWKS",
    "KNOWLEDGE_DIRECT_UPLOAD_ENABLED",
    "KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES",
    "KNOWLEDGE_DIRECT_STREAM_ENABLED",
    "KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED",
    "KNOWLEDGE_QUERY_IMAGE_EXPANSION_TIMEOUT_MS",
    "UNSTRUCTURED_API_URL",
    "UNSTRUCTURED_API_KEY",
    "UNSTRUCTURED_MAX_CONCURRENCY",
    "UNSTRUCTURED_REQUEST_TIMEOUT_MS",
    "UNSTRUCTURED_MAX_RESPONSE_BYTES",
    "DIFY_OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
  ]);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER=poppler$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER_DPI=144$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI=48$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS=30000$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS=500$/m);
  assert.match(difyKnowledgeFsEnv, /^KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY=2$/m);
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
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_DIRECT_STREAM_ENABLED: "off"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER: poppler$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER_DPI: "144"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER_THUMBNAIL_DPI: "48"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER_TIMEOUT_MS: "30000"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER_MAX_ASSETS: "500"$/m);
  assert.match(kubernetesBaseline, /^ {2}KNOWLEDGE_PDF_RASTERIZER_MAX_CONCURRENCY: "2"$/m);
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
