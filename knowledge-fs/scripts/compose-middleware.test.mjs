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
  assert.match(compose, /^ {2}minio:$/m);
  assert.match(compose, /^ {2}minio-bootstrap:$/m);
  assert.match(compose, /^ {2}unstructured:$/m);
  assert.doesNotMatch(compose, /^ {2}api:$/m);
  assert.doesNotMatch(compose, /^ {2}admin:$/m);
});

test("middleware compose keeps bounded local storage volumes", () => {
  assert.match(compose, /^volumes:$/m);
  assert.match(compose, /^ {2}postgres-data:$/m);
  assert.match(compose, /^ {2}minio-data:$/m);
  assert.doesNotMatch(compose, /^ {2}pnpm-store:$/m);
});
