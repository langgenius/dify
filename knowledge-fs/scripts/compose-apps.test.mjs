import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(new URL("../infra/local/compose.yaml", import.meta.url), "utf8");

test("app compose profile builds the production API image from the checked-in Dockerfile", () => {
  assert.match(compose, /^ {2}api:$/m);
  assert.match(compose, /^ {4}build:$/m);
  assert.match(compose, /^ {6}context: \.\.\/\.\.$/m);
  assert.match(compose, /^ {6}dockerfile: apps\/api\/Dockerfile$/m);
  assert.match(compose, /^ {4}image: knowledge-fs-api:local$/m);
  assert.match(compose, /^ {4}profiles: \["apps"\]$/m);
  assert.match(compose, /^ {6}NODE_ENV: production$/m);
  assert.match(compose, /^ {6}PORT: 8787$/m);
  assert.match(compose, /^ {6}KNOWLEDGE_DEV_AUTH_TOKEN: \$\{KNOWLEDGE_DEV_AUTH_TOKEN:-dev-token\}$/m);
  assert.match(compose, /^ {6}KNOWLEDGE_EMBEDDING_PROVIDER: \$\{KNOWLEDGE_EMBEDDING_PROVIDER:-\}$/m);
  assert.match(compose, /^ {6}KNOWLEDGE_EMBEDDING_MODEL: \$\{KNOWLEDGE_EMBEDDING_MODEL:-\}$/m);
  assert.match(compose, /^ {6}OPENAI_EMBEDDING_BASE_URL: \$\{OPENAI_EMBEDDING_BASE_URL:-\}$/m);
});

test("app compose profile waits for durable middleware readiness before API startup", () => {
  assert.match(compose, /^ {4}depends_on:$/m);
  assert.match(compose, /^ {6}postgres:$/m);
  assert.match(compose, /^ {8}condition: service_healthy$/m);
  assert.match(compose, /^ {6}minio-bootstrap:$/m);
  assert.match(compose, /^ {8}condition: service_completed_successfully$/m);
  assert.match(compose, /^ {6}unstructured:$/m);
  assert.match(compose, /^ {8}condition: service_started$/m);
});

test("app compose profile uses service-local middleware URLs inside the API container", () => {
  assert.match(
    compose,
    /^ {6}DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER:-knowledge_fs\}:\$\{POSTGRES_PASSWORD:-knowledge_fs\}@postgres:5432\/\$\{POSTGRES_DB:-knowledge_fs\}$/m,
  );
  assert.match(compose, /^ {6}MINIO_ENDPOINT: http:\/\/minio:9000$/m);
  assert.match(compose, /^ {6}UNSTRUCTURED_API_URL: http:\/\/unstructured:8000$/m);
});

test("app compose profile builds Admin as a production image against the local API port", () => {
  assert.match(compose, /^ {2}admin:$/m);
  assert.match(compose, /^ {6}dockerfile: apps\/admin\/Dockerfile$/m);
  assert.match(compose, /^ {4}image: knowledge-fs-admin:local$/m);
  assert.match(compose, /^ {4}profiles: \["apps"\]$/m);
  assert.match(compose, /^ {6}api:$/m);
  assert.match(compose, /^ {8}condition: service_started$/m);
  assert.match(compose, /^ {6}HOSTNAME: 0\.0\.0\.0$/m);
  assert.match(compose, /^ {6}KNOWLEDGE_API_BASE_URL: http:\/\/api:8787$/m);
  assert.match(compose, /^ {6}NEXT_PUBLIC_API_BASE_URL: http:\/\/localhost:\$\{API_PORT:-8788\}$/m);
  assert.match(compose, /^ {6}NODE_ENV: production$/m);
  assert.match(compose, /^ {6}PORT: 3000$/m);
  assert.doesNotMatch(compose, /pnpm --filter @knowledge\/admin dev/);
  assert.doesNotMatch(compose, /^ {6}- \.:\/workspace$/m);
  assert.doesNotMatch(compose, /^ {2}pnpm-store:$/m);
});
