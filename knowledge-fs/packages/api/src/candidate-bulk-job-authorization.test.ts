import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import { createInMemoryBulkOperationRepository } from "./bulk-operation";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import {
  createDocumentCompilationJobStateMachine,
  createInMemoryDocumentCompilationJobRepository,
} from "./document-compilation-job";
import { DurableDeletionServiceError } from "./durable-deletion-service";
import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";

const SPACE_ID = "81000000-0000-4000-8000-000000000001";
const OWNER_ASSET_ID = "82000000-0000-4000-8000-000000000001";
const EDITOR_ASSET_ID = "82000000-0000-4000-8000-000000000002";
const OPEN_ASSET_ID = "82000000-0000-4000-8000-000000000003";
const DELETE_ASSET_ID = "82000000-0000-4000-8000-000000000004";
const REVOKED_ASSET_ID = "82000000-0000-4000-8000-000000000005";
const OWNER_GRANT = `knowledge-space:${SPACE_ID}:role:owner`;
const EDITOR_GRANT = `knowledge-space:${SPACE_ID}:role:editor`;

const owner = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const editorA = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "editor-a",
  tenantId: "tenant-1",
};
const editorB = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "editor-b",
  tenantId: "tenant-1",
};
const viewer = { scopes: ["knowledge-spaces:*"], subjectId: "viewer-1", tenantId: "tenant-1" };

describe("candidate authorization for bulk operations and compilation jobs", () => {
  it("hides inaccessible items, binds jobs to their initiator, and revalidates deleted assets", async () => {
    const fixture = await createFixture();

    const ownerReindex = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      "owner",
      "POST",
      { documentIds: [OWNER_ASSET_ID] },
    );
    expect(ownerReindex.response.status).toBe(202);
    const ownerJobId = queuedJobId(ownerReindex.body);
    for (const [method, suffix] of [
      ["GET", ""],
      ["DELETE", ""],
      ["POST", "/retry"],
    ] as const) {
      const denied = await fixture.app.request(`/jobs/${ownerJobId}${suffix}`, {
        headers: bearer("editorA"),
        method,
      });
      expect(denied.status, `${method} ${suffix}`).toBe(404);
    }
    await expect(fixture.compilationJobs.get(ownerJobId)).resolves.toMatchObject({
      stage: "queued",
    });

    const editorReindex = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      "editorA",
      "POST",
      { documentIds: [EDITOR_ASSET_ID] },
    );
    expect(editorReindex.response.status).toBe(202);
    const editorJobId = queuedJobId(editorReindex.body);
    for (const [method, suffix] of [
      ["GET", ""],
      ["DELETE", ""],
      ["POST", "/retry"],
    ] as const) {
      const denied = await fixture.app.request(`/jobs/${editorJobId}${suffix}`, {
        headers: bearer("editorB"),
        method,
      });
      expect(denied.status, `${method} ${suffix}`).toBe(404);
    }
    await expect(fixture.compilationJobs.get(editorJobId)).resolves.toMatchObject({
      requestedBySubjectId: editorA.subjectId,
      stage: "queued",
    });
    const ownJob = await fixture.app.request(`/jobs/${editorJobId}`, {
      headers: bearer("editorA"),
    });
    expect(ownJob.status).toBe(200);
    const ownJobText = await ownJob.text();
    expect(ownJobText).not.toContain("requestedBySubjectId");
    expect(ownJobText).not.toContain("permissionSnapshot");

    const hiddenSingle = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      "editorA",
      "POST",
      { documentIds: [OWNER_ASSET_ID] },
    );
    expect(hiddenSingle.response.status).toBe(202);
    expect(hiddenSingle.body.items).toEqual([{ documentId: OWNER_ASSET_ID, status: "not_found" }]);

    const mixed = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      "editorA",
      "POST",
      { documentIds: [OWNER_ASSET_ID, OPEN_ASSET_ID] },
    );
    expect(mixed.response.status).toBe(202);
    expect(mixed.body.items[0]).toEqual({ documentId: OWNER_ASSET_ID, status: "not_found" });
    expect(mixed.body.items[1]).toMatchObject({ asset: { id: OPEN_ASSET_ID }, status: "queued" });
    expect(JSON.stringify(mixed.body.items[0])).not.toContain("asset");
    expect(
      (
        await fixture.app.request(`/bulk-jobs/${mixed.body.bulkJobId}`, {
          headers: bearer("editorB"),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fixture.app.request(`/bulk-jobs/${mixed.body.bulkJobId}`, {
          headers: bearer("editorA"),
        })
      ).status,
    ).toBe(200);

    const all = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      "editorA",
      "POST",
      { all: true },
    );
    expect(all.response.status).toBe(202);
    expect(JSON.stringify(all.body)).not.toContain(OWNER_ASSET_ID);
    expect(new Set(all.body.items.flatMap((item) => (item.asset ? [item.asset.id] : [])))).toEqual(
      new Set([EDITOR_ASSET_ID, OPEN_ASSET_ID, DELETE_ASSET_ID, REVOKED_ASSET_ID]),
    );

    const mixedDelete = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk`,
      "editorA",
      "DELETE",
      {
        documents: [
          { documentId: OWNER_ASSET_ID, expectedRevision: 1 },
          { documentId: DELETE_ASSET_ID, expectedRevision: 1 },
        ],
      },
    );
    expect(mixedDelete.response.status).toBe(404);
    await expect(
      fixture.assets.get({ id: OWNER_ASSET_ID, knowledgeSpaceId: SPACE_ID }),
    ).resolves.not.toBeNull();
    await expect(
      fixture.assets.get({ id: DELETE_ASSET_ID, knowledgeSpaceId: SPACE_ID }),
    ).resolves.not.toBeNull();

    const allowedDelete = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk`,
      "editorA",
      "DELETE",
      { documents: [{ documentId: DELETE_ASSET_ID, expectedRevision: 1 }] },
    );
    expect(allowedDelete.response.status).toBe(202);
    expect(allowedDelete.body.items).toEqual([
      expect.objectContaining({
        documentId: DELETE_ASSET_ID,
        job: expect.objectContaining({ targetId: DELETE_ASSET_ID, targetType: "document" }),
      }),
    ]);
    await expect(
      fixture.assets.get({ id: DELETE_ASSET_ID, knowledgeSpaceId: SPACE_ID }),
    ).resolves.not.toBeNull();

    const revokedDelete = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk`,
      "editorA",
      "DELETE",
      { documents: [{ documentId: REVOKED_ASSET_ID, expectedRevision: 1 }] },
    );
    expect(revokedDelete.response.status).toBe(202);

    const downgrade = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/members/${editorA.subjectId}`,
      "owner",
      "PATCH",
      { expectedRevision: 1, role: "viewer" },
    );
    expect(downgrade.response.status).toBe(200);
    fixture.revokeEditorADeletion();
    const revokedRetry = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk`,
      "editorA",
      "DELETE",
      { documents: [{ documentId: REVOKED_ASSET_ID, expectedRevision: 1 }] },
    );
    expect(revokedRetry.response.status).toBe(403);
  });

  it("binds public operations and jobs to the exact API key and access channel", async () => {
    const fixture = await createFixture();
    const firstKey = await issueApiKey(fixture.app, "editor key one");
    const secondKey = await issueApiKey(fixture.app, "editor key two");

    const reindex = await requestJson(
      fixture.app,
      `/knowledge-spaces/${SPACE_ID}/documents/bulk/reindex`,
      firstKey.token,
      "POST",
      { documentIds: [EDITOR_ASSET_ID] },
    );
    expect(reindex.response.status).toBe(202);
    const jobId = queuedJobId(reindex.body);

    const ownJob = await fixture.app.request(`/jobs/${jobId}`, {
      headers: bearer(firstKey.token),
    });
    expect(ownJob.status).toBe(200);
    const ownOperation = await fixture.app.request(`/bulk-jobs/${reindex.body.bulkJobId}`, {
      headers: bearer(firstKey.token),
    });
    expect(ownOperation.status).toBe(200);
    const operationText = await ownOperation.text();
    expect(operationText).not.toContain("permissionSnapshot");
    expect(operationText).not.toContain("requestedBySubjectId");
    expect(operationText).not.toContain("requiredPermissionScope");

    for (const headers of [bearer("editorA"), bearer(secondKey.token)]) {
      expect((await fixture.app.request(`/jobs/${jobId}`, { headers })).status).toBe(404);
      expect(
        (await fixture.app.request(`/bulk-jobs/${reindex.body.bulkJobId}`, { headers })).status,
      ).toBe(404);
    }
    for (const [method, suffix] of [
      ["DELETE", ""],
      ["POST", "/retry"],
    ] as const) {
      const denied = await fixture.app.request(`/jobs/${jobId}${suffix}`, {
        headers: bearer(secondKey.token),
        method,
      });
      expect(denied.status, `${method} ${suffix}`).toBe(404);
    }
    await expect(fixture.compilationJobs.get(jobId)).resolves.toMatchObject({ stage: "queued" });

    const revoked = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/api-keys/${firstKey.apiKey.id}?expectedRevision=${firstKey.apiKey.revision}`,
      { headers: bearer("owner"), method: "DELETE" },
    );
    expect(revoked.status).toBe(200);
    expect(
      (
        await fixture.app.request(`/jobs/${jobId}`, {
          headers: bearer(firstKey.token),
        })
      ).status,
    ).toBe(401);
  });
});

async function createFixture() {
  const adapter = createNodePlatformAdapter({ env: {} });
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 20 });
  const compilationJobs = createDocumentCompilationJobStateMachine({
    generateId: (() => {
      let next = 0;
      return () => `candidate-compilation-job-${++next}`;
    })(),
    jobs: adapter.jobs,
    repository: createInMemoryDocumentCompilationJobRepository({ maxJobs: 30 }),
  });
  const acceptingDeletions = createAcceptingDurableDeletionService();
  let editorADeletionAllowed = true;
  const durableDeletions = createAcceptingDurableDeletionService({
    requestBulkDocumentDeletion: async (input) => {
      if (input.subject.subjectId === editorA.subjectId && !editorADeletionAllowed) {
        throw new DurableDeletionServiceError(
          "DURABLE_DELETION_FORBIDDEN",
          "Deletion permission was revoked",
        );
      }
      for (const document of input.documents) {
        const asset = await assets.get({ id: document.documentId, knowledgeSpaceId: SPACE_ID });
        const scope = Array.isArray(asset?.metadata.permissionScope)
          ? asset.metadata.permissionScope
          : [];
        if (
          !asset ||
          (input.subject.subjectId !== owner.subjectId && scope.includes(OWNER_GRANT))
        ) {
          throw new DurableDeletionServiceError(
            "DURABLE_DELETION_NOT_FOUND",
            "Deletion target not found",
          );
        }
      }
      return acceptingDeletions.requestBulkDocumentDeletion(input);
    },
  });
  const app = createKnowledgeGateway({
    ...createAllowingDurableDeletionSafetyOptions(),
    adapter,
    auth: createStaticAuthVerifier({
      subjectsByToken: { editorA, editorB, owner, viewer },
    }),
    bulkOperations: createInMemoryBulkOperationRepository({ maxItems: 20, maxOperations: 20 }),
    documentAssets: assets,
    documentCompilationJobs: compilationJobs,
    durableDeletions,
    generateBulkUploadId: (() => {
      let next = 0;
      return () => `candidate-bulk-job-${++next}`;
    })(),
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 20,
      maxSpaces: 5,
    }),
  });

  expect(
    (
      await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: "Candidate jobs", slug: "candidate-jobs" }),
        headers: jsonBearer("owner"),
        method: "POST",
      })
    ).status,
  ).toBe(201);
  for (const [subjectId, role] of [
    [editorA.subjectId, "editor"],
    [editorB.subjectId, "editor"],
    [viewer.subjectId, "viewer"],
  ] as const) {
    expect(
      (
        await app.request(`/knowledge-spaces/${SPACE_ID}/members`, {
          body: JSON.stringify({ role, subjectId }),
          headers: jsonBearer("owner"),
          method: "POST",
        })
      ).status,
    ).toBe(201);
  }
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/access-policy`, {
        body: JSON.stringify({
          expectedRevision: 1,
          partialMemberSubjectIds: [],
          visibility: "all_members",
        }),
        headers: jsonBearer("owner"),
        method: "PATCH",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/api-access`, {
        body: JSON.stringify({ enabled: true, expectedRevision: 1 }),
        headers: jsonBearer("owner"),
        method: "PATCH",
      })
    ).status,
  ).toBe(200);

  await Promise.all([
    createAsset(adapter, assets, OWNER_ASSET_ID, [OWNER_GRANT]),
    createAsset(adapter, assets, EDITOR_ASSET_ID, [EDITOR_GRANT]),
    createAsset(adapter, assets, OPEN_ASSET_ID, []),
    createAsset(adapter, assets, DELETE_ASSET_ID, []),
    createAsset(adapter, assets, REVOKED_ASSET_ID, [EDITOR_GRANT]),
  ]);

  return {
    app,
    assets,
    compilationJobs,
    revokeEditorADeletion: () => {
      editorADeletionAllowed = false;
    },
  };
}

async function issueApiKey(
  app: Awaited<ReturnType<typeof createFixture>>["app"],
  name: string,
): Promise<{
  readonly apiKey: { readonly id: string; readonly revision: number };
  readonly token: string;
}> {
  const response = await app.request(`/knowledge-spaces/${SPACE_ID}/api-keys`, {
    body: JSON.stringify({ name, principalSubjectId: editorA.subjectId }),
    headers: jsonBearer("owner"),
    method: "POST",
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    readonly apiKey: { readonly id: string; readonly revision: number };
    readonly token: string;
  };
}

async function createAsset(
  adapter: ReturnType<typeof createNodePlatformAdapter>,
  assets: ReturnType<typeof createInMemoryDocumentAssetRepository>,
  id: string,
  permissionScope: readonly string[],
) {
  const objectKey = `tenant-1/spaces/${SPACE_ID}/documents/${id}/document.md`;
  await adapter.objectStorage.putObject({
    body: new TextEncoder().encode(id),
    key: objectKey,
    metadata: {},
  });
  return assets.create({
    filename: `${id}.md`,
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: { permissionScope },
    mimeType: "text/markdown",
    objectKey,
    sha256: "a".repeat(64),
    sizeBytes: id.length,
    tenantId: owner.tenantId,
  });
}

async function requestJson(
  app: Awaited<ReturnType<typeof createFixture>>["app"],
  path: string,
  token: string,
  method: "DELETE" | "PATCH" | "POST",
  body: unknown,
): Promise<{ response: Response; body: BulkTestResponse }> {
  const response = await app.request(path, {
    body: JSON.stringify(body),
    headers:
      method === "DELETE" && path.endsWith("/documents/bulk")
        ? { ...jsonBearer(token), "idempotency-key": nextDeletionIdempotencyKey() }
        : jsonBearer(token),
    method,
  });
  return { body: (await response.json()) as BulkTestResponse, response };
}

interface BulkTestResponse {
  readonly bulkJobId: string;
  readonly items: Array<{
    readonly asset?: { readonly id: string } | undefined;
    readonly compilationJob?: { readonly id: string } | undefined;
    readonly documentId?: string | undefined;
    readonly job?: { readonly targetId: string; readonly targetType: string } | undefined;
    readonly status?: string | undefined;
  }>;
}

let deletionRequestSequence = 0;
function nextDeletionIdempotencyKey(): string {
  deletionRequestSequence += 1;
  return `candidate-delete-${deletionRequestSequence}`;
}

function queuedJobId(body: BulkTestResponse): string {
  const id = body.items?.[0]?.compilationJob?.id;
  expect(id).toEqual(expect.any(String));
  if (!id) {
    throw new Error("Expected queued compilation job id");
  }
  return id;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonBearer(token: string): Record<string, string> {
  return { ...bearer(token), "content-type": "application/json" };
}
