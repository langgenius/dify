import { KnowledgeNodeSchema } from "@knowledge/core";

import {
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeNodeRepository,
} from "./index";

export function testGoldenQuestionPermission() {
  return {
    accessChannel: "interactive" as const,
    candidateGrants: ["subject:editor-1", "tenant:tenant-1"],
    permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f3afe",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-1",
    tenantId: "tenant-1",
  };
}

export function testGoldenQuestionPermissionRow(knowledgeSpaceId: string) {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-05-11T00:00:00.000Z",
    expires_at: "2099-01-01T00:00:00.000Z",
    id: testGoldenQuestionPermission().permissionSnapshotId,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: [...testGoldenQuestionPermission().candidateGrants],
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-1",
    tenant_id: "tenant-1",
    updated_at: "2026-05-11T00:00:00.000Z",
    visibility: "all_members",
  };
}

export async function createGoldenEvidenceFixtures(
  knowledgeSpaceId: string,
  nodeIds: readonly string[],
  permissionScope: readonly string[] = [],
) {
  const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18ff001";
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
  const nodes = createInMemoryKnowledgeNodeRepository({
    maxBatchSize: 20,
    maxListLimit: 20,
    maxNodes: 20,
  });
  await assets.create({
    filename: "golden-evidence.md",
    id: documentAssetId,
    knowledgeSpaceId,
    metadata: { permissionScope: [...permissionScope] },
    mimeType: "text/markdown",
    objectKey: `tenant-1/${knowledgeSpaceId}/golden-evidence.md`,
    sha256: "e".repeat(64),
    sizeBytes: 256,
  });
  await nodes.createMany(
    nodeIds.map((id, index) =>
      KnowledgeNodeSchema.parse({
        artifactHash: "f".repeat(64),
        documentAssetId,
        endOffset: index * 10 + 8,
        id,
        kind: "chunk",
        knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18ff002",
        permissionScope: [...permissionScope],
        sourceLocation: {
          endOffset: index * 10 + 8,
          sectionPath: ["Golden evidence"],
          startOffset: index * 10,
        },
        startOffset: index * 10,
        text: `Evidence ${index + 1}`,
      }),
    ),
  );
  return { assets, nodes };
}
