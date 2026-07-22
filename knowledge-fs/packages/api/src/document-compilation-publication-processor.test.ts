import { createInlineJobQueueAdapter } from "@knowledge/adapters";
import {
  DocumentAssetSchema,
  DocumentOutlineSchema,
  IndexProjectionSchema,
  type JobQueueAdapter,
  KnowledgeNodeSchema,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { createInMemoryDocumentCompilationAttemptRepository } from "./document-compilation-attempt-repository";
import { createDocumentCompilationPublicationCoordinator } from "./document-compilation-publication-coordinator";
import { createDocumentCompilationPublicationProcessor } from "./document-compilation-publication-processor";
import { createDocumentCompilationRuntime } from "./document-compilation-runtime";
import { createInMemoryProjectionSetPublicationMemberRepository } from "./projection-publication-member-repository";
import { createInMemoryProjectionSetPublicationRepository } from "./projection-publication-repository";
import { createInMemoryPublishedPageIndexRepository } from "./published-page-index-repository";

const tenantId = "tenant-1";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa201";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa202";
const attemptId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa203";
const outboxId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa204";
const generationId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa205";
const candidateId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa206";
const projectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa207";
const outlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa210";
const nodeId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa211";
const parseArtifactId = "018f0d60-7a49-7cc2-9c1b-5b36f18fa212";
const dispatcherToken = "018f0d60-7a49-7cc2-9c1b-5b36f18fa208";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18fa209";
const timestamp = Date.parse("2026-07-14T12:00:00.000Z");

describe("document compilation publication processor", () => {
  it("publishes the candidate before the runtime completes and acknowledges the attempt/job", async () => {
    const fixture = await createFixture();

    await expect(fixture.runtime.tick()).resolves.toMatchObject({
      failed: 0,
      succeeded: 1,
    });
    await expect(fixture.attempts.get(attemptId)).resolves.toMatchObject({
      checkpoint: "published",
      runState: "succeeded",
    });
    await expect(fixture.queue.status("job-1")).resolves.toMatchObject({ status: "completed" });
    await expect(
      fixture.publications.getPublished({ knowledgeSpaceId, tenantId }),
    ).resolves.toMatchObject({
      headRevision: 1,
      id: candidateId,
      status: "published",
    });
    expect(fixture.evaluate).toHaveBeenCalledOnce();
    expect(fixture.asset().parserStatus).toBe("parsed");

    const published = await fixture.publications.getPublished({ knowledgeSpaceId, tenantId });
    if (!published) {
      throw new Error("candidate publication was not published");
    }
    const page = await fixture.pageIndex.listOutlines({
      fingerprint: published.fingerprint,
      knowledgeSpaceId,
      limit: 10,
      permissionScope: ["team:camera"],
      publicationId: published.id,
      tenantId,
    });
    expect(page.items.map((item) => item.outline.id)).toEqual([outlineId]);
    await expect(
      fixture.pageIndex.openLeafEvidence({
        documentAssetId,
        fingerprint: published.fingerprint,
        generationId,
        knowledgeSpaceId,
        limit: 10,
        outlineId,
        outlineNodeId: "section-1",
        permissionScope: ["team:camera"],
        publicationId: published.id,
        tenantId,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ node: expect.objectContaining({ id: nodeId }) })],
    });
  });

  it("terminally fails a rejected candidate, keeps no head, and still acknowledges the job", async () => {
    const fixture = await createFixture({
      evaluation: { decision: "failed", reason: "candidate recall below threshold" },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({
      failed: 1,
      succeeded: 0,
    });
    const attempt = await fixture.attempts.get(attemptId);
    expect(attempt).toMatchObject({
      checkpoint: "projection_built",
      lastErrorMessage: expect.stringContaining("candidate recall below threshold"),
      runState: "failed",
    });
    await expect(fixture.queue.status("job-1")).resolves.toMatchObject({ status: "completed" });
    await expect(
      fixture.publications.getPublished({ knowledgeSpaceId, tenantId }),
    ).resolves.toBeNull();
    expect(fixture.asset().parserStatus).toBe("pending");
    const candidateFingerprint = attempt?.candidateFingerprint ?? "missing";
    await expect(
      fixture.publications.getByFingerprint({
        fingerprint: candidateFingerprint,
        knowledgeSpaceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ status: "inactive" });
  });
});

async function createFixture(
  options: {
    readonly evaluation?:
      | { readonly decision: "passed" }
      | { readonly decision: "failed"; readonly reason: string };
  } = {},
) {
  const attempts = createInMemoryDocumentCompilationAttemptRepository();
  const queue = createInlineJobQueueAdapter({
    maxBatchSize: 10,
    maxLeaseMs: 60_000,
    maxQueuedJobs: 10,
    now: () => timestamp,
  });
  await attempts.start({
    baseHeadRevision: 0,
    createdAt: new Date(timestamp).toISOString(),
    documentAssetId,
    documentVersion: 1,
    id: attemptId,
    knowledgeSpaceId,
    maxExecutionAttempts: 1,
    outboxId,
    publicationGenerationId: generationId,
    tenantId,
  });
  await dispatch(attempts, queue);

  const publications = createInMemoryProjectionSetPublicationRepository({ maxPublications: 10 });
  const members = createInMemoryProjectionSetPublicationMemberRepository({
    attempts,
    maxListLimit: 10,
    maxMembers: 10,
    now: () => timestamp,
    publications,
  });
  const coordinator = createDocumentCompilationPublicationCoordinator({
    maxComponents: 10,
    members,
    publications,
    validator: { validate: async () => undefined },
  });
  const evaluate = vi.fn(async () => options.evaluation ?? { decision: "passed" as const });
  let asset = DocumentAssetSchema.parse({
    createdAt: new Date(timestamp).toISOString(),
    filename: "camera.md",
    id: documentAssetId,
    knowledgeSpaceId,
    metadata: {},
    mimeType: "text/markdown",
    objectKey: "documents/camera.md",
    parserStatus: "pending",
    sha256: "a".repeat(64),
    sizeBytes: 100,
    version: 1,
  });
  const assets = {
    get: vi.fn(async ({ id, knowledgeSpaceId: requestedSpaceId }) =>
      id === asset.id && requestedSpaceId === asset.knowledgeSpaceId ? asset : null,
    ),
    updateParserStatus: vi.fn(async ({ id, knowledgeSpaceId: requestedSpaceId, parserStatus }) => {
      if (id !== asset.id || requestedSpaceId !== asset.knowledgeSpaceId) {
        return null;
      }
      asset = DocumentAssetSchema.parse({ ...asset, parserStatus });
      return asset;
    }),
  };
  const node = KnowledgeNodeSchema.parse({
    artifactHash: "b".repeat(64),
    documentAssetId,
    endOffset: 20,
    id: nodeId,
    kind: "chunk",
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId,
    permissionScope: ["team:camera"],
    publicationGenerationId: generationId,
    sourceLocation: { endOffset: 20, sectionPath: ["Camera"], startOffset: 0 },
    startOffset: 0,
    text: "camera evidence",
  });
  const projection = IndexProjectionSchema.parse({
    id: projectionId,
    knowledgeSpaceId,
    metadata: { documentAssetId },
    model: "database-fts@1",
    nodeId,
    projectionVersion: 1,
    publicationGenerationId: generationId,
    status: "ready",
    type: "fts",
  });
  const outline = DocumentOutlineSchema.parse({
    artifactHash: node.artifactHash,
    createdAt: new Date(timestamp).toISOString(),
    documentAssetId,
    id: outlineId,
    knowledgeSpaceId,
    metadata: {},
    nodes: [
      {
        childNodeIds: [],
        children: [],
        endOffset: 20,
        id: "section-1",
        level: 1,
        metadata: {},
        sectionPath: ["Camera"],
        sourceElementIds: [],
        sourceNodeIds: [nodeId],
        startOffset: 0,
        summary: "Camera summary",
        title: "Camera",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "document-outline-v1",
    parseArtifactId,
    publicationGenerationId: generationId,
    version: 1,
  });
  const pageIndex = createInMemoryPublishedPageIndexRepository({
    documentAssets: assets,
    indexProjections: {
      getMany: async ({ ids }) => (ids.includes(projection.id) ? [projection] : []),
    },
    maxLeafLimit: 10,
    maxOutlinePageSize: 10,
    maxProjectionMembers: 10,
    members,
    nodes: {
      get: async ({ id, knowledgeSpaceId: requestedSpaceId, publicationGenerationId }) =>
        id === node.id &&
        requestedSpaceId === node.knowledgeSpaceId &&
        publicationGenerationId === node.publicationGenerationId
          ? node
          : null,
    },
    outlines: { getById: async ({ id }) => (id === outline.id ? outline : null) },
    publications,
  });
  const processor = createDocumentCompilationPublicationProcessor({
    assets,
    compileCandidate: async (execution) => {
      await execution.advance({ checkpoint: "parsed" });
      await execution.advance({ checkpoint: "outline_built" });
      await execution.advance({ checkpoint: "nodes_generated" });
      await coordinator.composeCandidate({
        candidateId,
        componentReceipt: {
          documentOutlines: [{ componentKey: outlineId, generationId }],
          graphEntities: [],
          graphRelations: [],
          indexProjections: [{ componentKey: projectionId, generationId }],
          knowledgePaths: [],
          multimodalManifests: [],
          schemaVersion: 1,
        },
        createdAt: new Date(timestamp).toISOString(),
        execution,
        fingerprintMaterial: {
          chunkerVersion: "chunker-v1",
          indexVersion: "index-v1",
          knowledgeSpaceId,
          nodeSchemaVersion: 1,
          parserPolicyVersion: "parser-v1",
          projectionSetVersion: "projection-set-v1",
          projections: [
            {
              indexVersion: "dense-v1",
              model: "plugin-daemon/user-selected-vector-space",
              projectionVersion: 1,
              strategy: "dense",
              type: "dense-vector",
            },
          ],
          sourceSnapshots: [
            {
              documentAssetId,
              sha256: "a".repeat(64),
              version: 1,
            },
          ],
        },
        projectionVersion: 1,
      });
    },
    coordinator,
    evaluator: { evaluate },
    now: () => new Date(timestamp).toISOString(),
  });
  const runtime = createDocumentCompilationRuntime({
    attempts,
    generateLeaseToken: () => leaseToken,
    heartbeatIntervalMs: 5_000,
    intervalMs: 60_000,
    jobs: queue,
    leaseMs: 10_000,
    maxBatchSize: 1,
    now: () => timestamp,
    processor,
    workerId: "publication-runtime-1",
  });

  return { asset: () => asset, attempts, evaluate, pageIndex, publications, queue, runtime };
}

async function dispatch(
  attempts: ReturnType<typeof createInMemoryDocumentCompilationAttemptRepository>,
  queue: JobQueueAdapter,
): Promise<void> {
  const [event] = await attempts.claimOutbox({
    limit: 1,
    lockedUntil: new Date(timestamp + 5_000).toISOString(),
    lockToken: dispatcherToken,
    now: new Date(timestamp).toISOString(),
    workerId: "dispatcher-1",
  });
  if (!event) {
    throw new Error("Document compilation outbox event was not created");
  }
  const job = await queue.enqueue({
    idempotencyKey: event.idempotencyKey,
    payload: { attemptId },
    type: "document.compile",
  });
  const marked = await attempts.markOutboxDispatched({
    availableAt: new Date(timestamp + 10_000).toISOString(),
    deliveredAt: new Date(timestamp).toISOString(),
    lockToken: dispatcherToken,
    now: new Date(timestamp).toISOString(),
    outboxId,
    queueJobId: job.id,
  });
  if (!marked) {
    throw new Error("Document compilation outbox event could not be dispatched");
  }
}
