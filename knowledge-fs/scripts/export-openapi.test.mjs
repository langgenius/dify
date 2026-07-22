import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("OpenAPI export is hermetic when invoked from a production environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "knowledge-fs-openapi-export-"));
  const output = join(directory, "knowledge-fs.openapi.json");

  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/export-openapi.mjs", "--output", output],
      {
        cwd: repositoryRoot,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: "pipe",
      },
    );

    const document = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(document.security, [{ bearerAuth: [] }]);
    assert.equal(document.paths["/knowledge-spaces"].get.operationId, "listKnowledgeSpaces");
    assert.equal(
      document.paths["/internal/dify-integration/activate"].post.operationId,
      "activateDifyWorkspaceIntegration",
    );
    assert.equal(
      document.paths["/internal/dify-integration/freeze"].post.operationId,
      "freezeDifyWorkspaceIntegration",
    );
    assert.equal(
      document.paths["/knowledge-spaces/{id}/upload-sessions"].post.operationId,
      "createUploadSession",
    );
    assert.equal(
      document.paths["/upload-sessions/{id}/parts/{partNumber}/presign"].post.operationId,
      "presignUploadSessionPart",
    );
    assert.equal(
      document.paths["/upload-sessions/{id}/small-file"].post.operationId,
      "uploadSmallFile",
    );
    assert.equal(
      document.paths["/upload-sessions/{id}/complete"].post.operationId,
      "completeUploadSession",
    );
    assert.equal(
      document.paths["/upload-sessions/{id}/abort"].post.operationId,
      "abortUploadSession",
    );
    for (const legacyPath of [
      "/knowledge-spaces/{id}/access-policy",
      "/knowledge-spaces/{id}/members",
      "/knowledge-spaces/{id}/members/{subjectId}",
      "/knowledge-spaces/{id}/api-access",
      "/knowledge-spaces/{id}/api-keys",
      "/knowledge-spaces/{id}/api-keys/{keyId}",
    ]) {
      assert.equal(document.paths[legacyPath], undefined);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
