import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("Capability v2 operation export is deterministic and includes internal lifecycle policy", () => {
  const directory = mkdtempSync(join(tmpdir(), "knowledge-fs-capability-export-"));
  const output = join(directory, "capability-v2-operations.json");

  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/export-capability-v2-operations.mjs", "--output", output],
      { cwd: repositoryRoot, stdio: "pipe" },
    );
    const document = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(document.schemaVersion, 1);
    assert.equal(new Set(document.operations.map((operation) => operation.operationId)).size, 56);
    assert.deepEqual(
      document.operations.find((operation) => operation.operationId === "uploadSmallFile"),
      {
        action: "upload_sessions.write",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "POST",
        operationId: "uploadSmallFile",
        parentResourceBinding: { queryParameter: "knowledgeSpaceId" },
        path: "/upload-sessions/{id}/small-file",
        resourceBinding: { pathParameter: "id" },
        resourceType: "upload_session",
      },
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "freezeDifyWorkspaceIntegration",
      ),
      {
        action: "dify_integration.freeze",
        allowedCallerKinds: ["internal_worker"],
        method: "POST",
        operationId: "freezeDifyWorkspaceIntegration",
        parentResourceBinding: null,
        path: "/internal/dify-integration/freeze",
        resourceBinding: { namespace: true },
        resourceType: "namespace",
      },
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "activateDifyWorkspaceIntegration",
      ),
      {
        action: "dify_integration.activate",
        allowedCallerKinds: ["internal_worker"],
        method: "POST",
        operationId: "activateDifyWorkspaceIntegration",
        parentResourceBinding: null,
        path: "/internal/dify-integration/activate",
        resourceBinding: { namespace: true },
        resourceType: "namespace",
      },
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
