import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync(
  new URL("../infra/local/compose.middleware.yaml", import.meta.url),
  "utf8",
);

test("middleware compose file contains only local middleware services", () => {
  assert.match(compose, /^services:$/m);
  assert.match(compose, /^ {2}postgres:$/m);
  assert.match(compose, /^ {2}unstructured:$/m);
  assert.doesNotMatch(compose, /^ {2}minio(?:-bootstrap)?:$/m);
  assert.doesNotMatch(compose, /^ {2}api:$/m);
  assert.doesNotMatch(compose, /^ {2}admin:$/m);
});

test("middleware compose bounds Unstructured PDF page parallelism", () => {
  assert.match(
    compose,
    /^ {4}image: downloads\.unstructured\.io\/unstructured-io\/unstructured-api@sha256:0df934a22e4e893cf15e7aeaf35c463ecc75937758a83099aefdc13041619a1d$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_PARALLEL_MODE_ENABLED: \$\{UNSTRUCTURED_PARALLEL_MODE_ENABLED:-true\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_PARALLEL_MODE_URL: \$\{UNSTRUCTURED_PARALLEL_MODE_URL:-http:\/\/127\.0\.0\.1:8000\/general\/v0\/general\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_PARALLEL_MODE_SPLIT_SIZE: \$\{UNSTRUCTURED_PARALLEL_MODE_SPLIT_SIZE:-6\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_PARALLEL_MODE_THREADS: \$\{UNSTRUCTURED_PARALLEL_MODE_THREADS:-3\}$/m,
  );
  assert.match(
    compose,
    /^ {6}UNSTRUCTURED_PARALLEL_RETRY_ATTEMPTS: \$\{UNSTRUCTURED_PARALLEL_RETRY_ATTEMPTS:-0\}$/m,
  );
  assert.match(compose, /^ {10}cpus: "4\.0"$/m);
  assert.match(compose, /^ {10}memory: 6G$/m);
});

test("middleware compose keeps only the local database volume", () => {
  assert.match(compose, /^volumes:$/m);
  assert.match(compose, /^ {2}postgres-data:$/m);
  assert.doesNotMatch(compose, /^ {2}minio-data:$/m);
  assert.doesNotMatch(compose, /^ {2}pnpm-store:$/m);
});
