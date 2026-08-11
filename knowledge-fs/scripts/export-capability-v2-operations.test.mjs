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
    assert.equal(new Set(document.operations.map((operation) => operation.operationId)).size, 113);
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "createSourceCrawlImportWorkflow",
      ),
      {
        action: "source_workflows.crawl_import.create",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "POST",
        operationId: "createSourceCrawlImportWorkflow",
        parentResourceBinding: { pathParameter: "id" },
        path: "/knowledge-spaces/{id}/sources/{sourceId}/crawl-import",
        resourceBinding: { pathParameter: "sourceId" },
        resourceType: "source",
      },
    );
    assert.deepEqual(
      document.operations
        .filter((operation) => operation.operationId.endsWith("KnowledgeFs"))
        .map(({ action, method, operationId, path }) => ({ action, method, operationId, path })),
      [
        {
          action: "knowledge_fs.cat",
          method: "GET",
          operationId: "catKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/cat",
        },
        {
          action: "knowledge_fs.diff",
          method: "GET",
          operationId: "diffKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/diff",
        },
        {
          action: "knowledge_fs.find",
          method: "GET",
          operationId: "findKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/find",
        },
        {
          action: "knowledge_fs.grep",
          method: "GET",
          operationId: "grepKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/grep",
        },
        {
          action: "knowledge_fs.ls",
          method: "GET",
          operationId: "listKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/ls",
        },
        {
          action: "knowledge_fs.stat",
          method: "GET",
          operationId: "statKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/stat",
        },
        {
          action: "knowledge_fs.tree",
          method: "GET",
          operationId: "treeKnowledgeFs",
          path: "/knowledge-spaces/{id}/fs/tree",
        },
      ],
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "getKnowledgeSpaceProfileMigration",
      ),
      {
        action: "knowledge_spaces.settings.read",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "GET",
        operationId: "getKnowledgeSpaceProfileMigration",
        parentResourceBinding: null,
        path: "/knowledge-spaces/{id}/profile-migrations/{migrationId}",
        resourceBinding: { pathParameter: "id" },
        resourceType: "knowledge_space",
      },
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "updateKnowledgeSpaceEmbeddingProfile",
      ),
      {
        action: "knowledge_spaces.settings.update",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "PUT",
        operationId: "updateKnowledgeSpaceEmbeddingProfile",
        parentResourceBinding: null,
        path: "/knowledge-spaces/{id}/embedding-profile",
        resourceBinding: { pathParameter: "id" },
        resourceType: "knowledge_space",
      },
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "updateKnowledgeSpaceRetrievalProfile",
      ),
      {
        action: "knowledge_spaces.settings.update",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "PUT",
        operationId: "updateKnowledgeSpaceRetrievalProfile",
        parentResourceBinding: null,
        path: "/knowledge-spaces/{id}/retrieval-profile",
        resourceBinding: { pathParameter: "id" },
        resourceType: "knowledge_space",
      },
    );
    assert.deepEqual(
      document.operations.find(
        (operation) => operation.operationId === "createSourceImportWorkflow",
      ),
      {
        action: "source_workflows.import.create",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "POST",
        operationId: "createSourceImportWorkflow",
        parentResourceBinding: { pathParameter: "id" },
        path: "/knowledge-spaces/{id}/sources/{sourceId}/workflow-imports",
        resourceBinding: { pathParameter: "sourceId" },
        resourceType: "source",
      },
    );
    assert.deepEqual(
      document.operations.find((operation) => operation.operationId === "createSourceSyncWorkflow"),
      {
        action: "source_workflows.sync.create",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "POST",
        operationId: "createSourceSyncWorkflow",
        parentResourceBinding: { pathParameter: "id" },
        path: "/knowledge-spaces/{id}/sources/{sourceId}/sync",
        resourceBinding: { pathParameter: "sourceId" },
        resourceType: "source",
      },
    );
    assert.deepEqual(
      document.operations.find((operation) => operation.operationId === "listSourceProviders"),
      {
        action: "source_providers.list",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "GET",
        operationId: "listSourceProviders",
        parentResourceBinding: null,
        path: "/source-providers",
        resourceBinding: { namespace: true },
        resourceType: "namespace",
      },
    );
    assert.deepEqual(
      document.operations.find((operation) => operation.operationId === "getSourceWorkflow"),
      {
        action: "source_workflows.read",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "GET",
        operationId: "getSourceWorkflow",
        parentResourceBinding: { pathParameter: "id" },
        path: "/knowledge-spaces/{id}/source-workflows/{runId}",
        resourceBinding: { pathParameter: "runId" },
        resourceType: "job",
      },
    );
    assert.deepEqual(
      document.operations.find((operation) => operation.operationId === "cancelBackgroundTask"),
      {
        action: "background_tasks.cancel",
        allowedCallerKinds: ["interactive", "service", "agent", "workflow"],
        method: "POST",
        operationId: "cancelBackgroundTask",
        parentResourceBinding: { pathParameter: "id" },
        path: "/knowledge-spaces/{id}/background-tasks/{taskKind}/{taskId}/cancel",
        resourceBinding: { pathParameter: "taskId" },
        resourceType: "job",
      },
    );
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
