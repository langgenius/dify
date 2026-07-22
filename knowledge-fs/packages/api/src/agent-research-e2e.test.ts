import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { EvidenceBundleSchema, type JobPayload, ResourceMountSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type PublishedKnowledgeSpaceRuntimeSnapshot,
  createBudgetedResearchWorkflow,
  createConflictDetectionService,
  createFreshnessCheckingService,
  createInMemoryAgentWorkspaceSnapshotRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createKnowledgeGateway,
  createKnowledgeMcpServer,
  createKnowledgeSpaceAccessService,
  createKnowledgeSpaceAuthorizationGuard,
  createResearchTaskDryRunPlanner,
  createResearchTaskJobStateMachine,
  createSourceComparisonService,
  createStaticAuthVerifier,
  researchTaskRuntimeSnapshotFromMetadata,
} from "./index";

describe("agent research e2e", () => {
  it("plans, creates, snapshots, reads partial evidence, and receives a cited report", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    const knowledgeSpaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => knowledgeSpaceId,
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-12T19:30:00.000Z",
    });
    const researchTasks = createResearchTaskJobStateMachine({
      generateId: () => "research-task-e2e-1",
      jobs: adapter.jobs,
      now: () => 10_000,
      repository: createInMemoryResearchTaskJobRepository({ maxJobs: 10 }),
    });
    const partials = createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 10,
      maxResults: 10,
    });
    const snapshots = createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 10,
      maxEvidenceBundles: 10,
      maxMounts: 10,
      maxSnapshots: 10,
      maxSourceVersions: 10,
      now: () => "2026-05-12T19:35:00.000Z",
    });
    const planner = createE2EResearchPlanner();
    const evidence = e2eEvidenceBundle();
    const workflow = createBudgetedResearchWorkflow({
      conflictDetection: createConflictDetectionService({
        detector: {
          detect: async () => ({
            conflicts: [],
            summary: "No conflicts found.",
          }),
        },
      }),
      freshnessChecking: createFreshnessCheckingService({
        now: () => "2026-05-12T19:36:00.000Z",
        staleAfterSeconds: 86_400,
      }),
      now: () => "2026-05-12T19:37:00.000Z",
      planner,
      retriever: { retrieve: async () => evidence },
      sourceComparison: createSourceComparisonService({
        judge: {
          compare: async (input) => ({
            findings: [
              {
                evidenceNodeIds: input.sources.map((source) => source.nodeId),
                kind: "agreement",
                summary: "Both sources support the renewal answer.",
              },
            ],
            summary: "Sources agree.",
          }),
        },
      }),
    });
    const app = createKnowledgeGateway({
      adapter,
      agentWorkspaceSnapshots: snapshots,
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          "read-token": readSubject,
          "write-token": writeSubject,
        },
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaces,
      researchTaskPartials: partials,
      researchTasks,
    });
    const mcp = createKnowledgeMcpServer({
      ...minimalAgentMcpHandlers(evidence),
      authorization: {
        access,
        guard: createKnowledgeSpaceAuthorizationGuard({ access }),
        subject: writeSubject,
      },
      research: {
        cancel: (input) => researchTasks.cancel(input.id),
        create: async (input) => {
          const permissionSnapshot = requiredDurableMcpPermission(input.durablePermission);
          const job = await researchTasks.start({
            budgetUsd: input.budgetUsd,
            knowledgeSpaceId: input.knowledgeSpaceId,
            limits: input.limits,
            ...(input.metadata ? { metadata: jsonPayloadRecord(input.metadata) } : {}),
            permissionSnapshot: {
              accessChannel: permissionSnapshot.accessChannel,
              id: permissionSnapshot.id,
              revision: permissionSnapshot.revision,
            },
            query: input.query,
            subjectId: permissionSnapshot.subjectId,
            tenantId: permissionSnapshot.tenantId,
          });
          await researchTasks.advance(job.id, "planning");
          const retrieving = await researchTasks.advance(job.id, "retrieving");
          await partials.append({
            evidenceBundle: evidence,
            knowledgeSpaceId: input.knowledgeSpaceId,
            researchTaskJobId: job.id,
            tenantId: writeSubject.tenantId,
          });

          return retrieving;
        },
        get: (input) => researchTasks.get(input.id),
        plan: (input) => planner.plan(input),
      },
      runtimeSnapshotResolver: {
        assertReady: async () => undefined,
        resolve: async () => agentPublishedRuntimeSnapshot(),
      },
      workspaceSnapshots: {
        create: (input) => {
          const permissionSnapshot = requiredDurableMcpPermission(input.durablePermission);
          return snapshots.create({
            commandLog: input.commandLog,
            evidenceBundles: input.evidenceBundles,
            id: "workspace-snapshot-e2e-1",
            indexProjection: input.indexProjection,
            knowledgeSpaceId: input.knowledgeSpaceId,
            metadata: input.metadata,
            mounts: input.mounts,
            permissionSnapshot: {
              accessChannel: permissionSnapshot.accessChannel,
              id: permissionSnapshot.id,
              revision: permissionSnapshot.revision,
              scopes: [...(input.permissionScope ?? [])],
              subjectId: permissionSnapshot.subjectId,
              tenantId: permissionSnapshot.tenantId,
            },
            researchTaskJobId: input.researchTaskJobId,
            sourceVersions: input.sourceVersions,
            tenantId: permissionSnapshot.tenantId,
            traceIds: input.traceIds,
          });
        },
        get: (input) => snapshots.get({ id: input.id, tenantId: writeSubject.tenantId }),
      },
    });

    const createSpaceResponse = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Agent Research", slug: "agent-research" }),
      headers: { authorization: "Bearer write-token", "content-type": "application/json" },
      method: "POST",
    });
    expect(createSpaceResponse.status).toBe(201);
    await access.setMemberRole({
      actorSubjectId: writeSubject.subjectId,
      expectedRevision: 0,
      knowledgeSpaceId,
      role: "viewer",
      subjectId: readSubject.subjectId,
      tenantId: writeSubject.tenantId,
    });
    await access.updatePolicy({
      actorSubjectId: writeSubject.subjectId,
      expectedRevision: 1,
      knowledgeSpaceId,
      partialMemberSubjectIds: [],
      tenantId: writeSubject.tenantId,
      visibility: "all_members",
    });
    await access.updateApiAccess({
      actorSubjectId: writeSubject.subjectId,
      enabled: true,
      expectedRevision: 1,
      knowledgeSpaceId,
      tenantId: writeSubject.tenantId,
    });

    await expect(
      mcp.callTool("knowledge.research.plan", {
        budgetUsd: 1,
        knowledgeSpaceId,
        mode: "research",
        query: "Explain renewal notice changes",
        topK: 2,
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        budget: { exceedsBudget: false },
        knowledgeSpaceId,
        strategyVersion: "research-dry-run-planner-v1",
      },
    });

    const createdResearch = await mcp.callTool("knowledge.research.create", {
      budgetUsd: 1,
      knowledgeSpaceId,
      limits: { maxRetrievalSteps: 10, maxScannedResources: 50, maxToolCalls: 20 },
      metadata: { purpose: "e2e" },
      mode: "research",
      query: "Explain renewal notice changes",
      topK: 2,
    });
    expect(createdResearch).toMatchObject({
      structuredContent: {
        id: "research-task-e2e-1",
        stage: "retrieving",
      },
    });
    expect(JSON.stringify(createdResearch)).not.toContain("__knowledgeFs");
    const durableResearch = await researchTasks.get("research-task-e2e-1");
    expect(researchTaskRuntimeSnapshotFromMetadata(durableResearch?.metadata ?? {})).toEqual(
      agentPublishedRuntimeSnapshot(),
    );

    await expect(
      mcp.callTool("knowledge.workspace_snapshot.create", {
        commandLog: [
          {
            command: "ls /knowledge/docs --limit 2",
            input: { path: "/knowledge/docs" },
            outputSummary: "2 docs",
            startedAt: "2026-05-12T19:34:00.000Z",
          },
        ],
        evidenceBundles: [evidence],
        indexProjection: { fingerprint: "projection-e2e", projectionIds: ["projection-1"] },
        knowledgeSpaceId,
        metadata: { purpose: "agent-research-e2e" },
        mounts: [
          ResourceMountSchema.parse({
            cachePolicy: { strategy: "none" },
            capabilities: ["ls"],
            createdAt: "2026-05-12T19:33:00.000Z",
            freshnessPolicy: { strategy: "manual" },
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7f11",
            knowledgeSpaceId,
            metadata: {},
            mode: "read",
            mountPath: "/sources/uploads",
            permissionScope: ["tenant:tenant-1"],
            permissionSnapshotVersion: 1,
            provider: "object-storage",
            resourceType: "source",
            sourcePointer: "s3://knowledge-fs/tenant-1/uploads",
            tenantId: "tenant-1",
          }),
        ],
        researchTaskJobId: "research-task-e2e-1",
        sourceVersions: [
          {
            provider: "object-storage",
            providerResourceKey: "tenant-1/uploads/renewal.md",
            version: "sha256:e2e",
          },
        ],
        traceIds: ["trace-e2e-1"],
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        evidenceBundles: [{ id: evidence.id }],
        id: "workspace-snapshot-e2e-1",
        researchTaskJobId: "research-task-e2e-1",
      },
    });

    const partialResponse = await app.request(
      "/research-tasks/research-task-e2e-1/partials?limit=2",
      { headers: { authorization: "Bearer read-token" } },
    );
    expect(partialResponse.status).toBe(403);

    const ownerPartialResponse = await app.request(
      "/research-tasks/research-task-e2e-1/partials?limit=2",
      { headers: { authorization: "Bearer write-token" } },
    );
    expect(ownerPartialResponse.status).toBe(403);
    await expect(
      partials.list({
        limit: 2,
        researchTaskJobId: "research-task-e2e-1",
        tenantId: writeSubject.tenantId,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          evidenceBundle: {
            id: evidence.id,
            items: expect.arrayContaining([
              expect.objectContaining({
                text: "Renewal notice moved from 30 to 45 days.",
              }),
            ]),
          },
          sequence: 1,
        },
      ],
    });

    const report = await workflow.run({
      budgetUsd: 1,
      knowledgeSpaceId,
      mode: "research",
      query: "Explain renewal notice changes",
      topK: 2,
      traceId: "trace-e2e-1",
    });

    expect(report).toMatchObject({
      citations: [
        { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d11" },
        { documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d12" },
      ],
      evidenceBundleId: evidence.id,
      status: "completed",
      summary: "Sources agree. No conflicts found. No stale evidence items found.",
      traceId: "trace-e2e-1",
    });
  });
});

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const readSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "reader-1",
  tenantId: "tenant-1",
};
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "agent-1",
  tenantId: "tenant-1",
};

function minimalAgentMcpHandlers(evidence: ReturnType<typeof e2eEvidenceBundle>) {
  return {
    fetchEvidence: async () => evidence,
    fs: {
      cat: async (input: { path: string }) => ({
        contentType: "text/markdown",
        path: input.path,
        text: "Renewal notice moved from 30 to 45 days.",
        truncated: false,
      }),
      diff: async (input: {
        mode?: "line" | "word" | undefined;
        newPath: string;
        oldPath: string;
      }) => ({
        mode: input.mode ?? "line",
        newPath: input.newPath,
        oldPath: input.oldPath,
        operations: [],
        stats: { delete: 0, equal: 0, insert: 0 },
      }),
      find: async (input: { path: string }) => ({ items: [], path: input.path, truncated: false }),
      grep: async (input: { path: string }) => ({
        matches: [],
        path: input.path,
        truncated: false,
      }),
      ls: async (input: { path: string }) => ({ items: [], path: input.path, truncated: false }),
      openNode: async () => ({
        citation: e2eCitation("018f0d60-7a49-7cc2-9c1b-5b36f18f7d11"),
        node: e2eKnowledgeNode(),
      }),
      stat: async (input: { path: string }) => ({
        metadata: {},
        path: input.path,
        resourceType: "document" as const,
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d11",
      }),
      tree: async (input: { path: string }) => ({
        path: input.path,
        root: { kind: "directory" as const, metadata: {}, name: "docs", path: input.path },
        truncated: false,
      }),
    },
    search: async () => ({ items: evidence.items }),
    shell: {
      execute: async (input: { command: string }) => ({
        output: { ok: true },
        plan: { command: input.command, steps: [] },
        truncated: false,
      }),
      plan: async (input: { command: string }) => ({ command: input.command, steps: [] }),
    },
  };
}

function createE2EResearchPlanner() {
  return createResearchTaskDryRunPlanner({
    retrievalPlanner: {
      plan: (input) => ({
        denseTopK: input.topK * 2,
        ftsTopK: input.topK * 2,
        fusionLimit: input.topK,
        queryLanguage: "latin",
        requestedMode: input.mode ?? "research",
        rerankCandidateLimit: input.topK,
        resolvedMode: "research",
        strategyVersion: "retrieval-planner-v1",
        topK: input.topK,
      }),
    },
  });
}

function agentPublishedRuntimeSnapshot(): PublishedKnowledgeSpaceRuntimeSnapshot {
  return {
    embeddingCapabilitySnapshot: {
      pluginUniqueIdentifier: "embedding-install-agent-v1",
    },
    embeddingProfile: {
      dimension: 1_024,
      model: "embed-agent-v1",
      pluginId: "plugin-embedding",
      provider: "provider-a",
      revision: 1,
      vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
    },
    projectionSnapshot: {
      fingerprint: "sha256:agent-publication-v1",
      headRevision: 1,
      knowledgeSpaceId,
      projectionVersion: 1,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7f21",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: { pluginUniqueIdentifier: "reasoning-install-agent-v1" },
    },
    retrievalProfile: {
      defaultMode: "research",
      reasoningModel: {
        model: "reason-agent-v1",
        pluginId: "plugin-reasoning",
        provider: "provider-a",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-agent-v1",
          pluginId: "plugin-rerank",
          provider: "provider-a",
        },
      },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 2,
    },
  };
}

function jsonPayloadRecord(input: Readonly<Record<string, unknown>>): Record<string, JobPayload> {
  return JSON.parse(JSON.stringify(input)) as Record<string, JobPayload>;
}

function requiredDurableMcpPermission(
  permission:
    | {
        readonly accessChannel: "agent" | "interactive" | "mcp" | "service_api";
        readonly id: string;
        readonly revision: number;
        readonly subjectId: string;
        readonly tenantId: string;
      }
    | undefined,
) {
  if (!permission) {
    throw new Error("MCP durable permission is required");
  }
  return permission;
}

function e2eEvidenceBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-05-12T19:31:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b11",
    items: [
      {
        citations: [e2eCitation("018f0d60-7a49-7cc2-9c1b-5b36f18f7d11")],
        conflicts: [],
        freshness: {
          checkedAt: "2026-05-12T19:31:00.000Z",
          sourceUpdatedAt: "2026-05-12T19:30:00.000Z",
          status: "fresh",
        },
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c11",
        score: 0.92,
        scores: { final: 0.92, retrieval: 0.92 },
        text: "Renewal notice moved from 30 to 45 days.",
      },
      {
        citations: [e2eCitation("018f0d60-7a49-7cc2-9c1b-5b36f18f7d12")],
        conflicts: [],
        freshness: {
          checkedAt: "2026-05-12T19:31:00.000Z",
          sourceUpdatedAt: "2026-05-12T19:29:00.000Z",
          status: "fresh",
        },
        metadata: {},
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c12",
        score: 0.88,
        scores: { final: 0.88, retrieval: 0.88 },
        text: "The compliance memo confirms the 45 day notice.",
      },
    ],
    missingEvidence: [],
    query: "Explain renewal notice changes",
    state: "answerable",
  });
}

function e2eCitation(documentAssetId: string) {
  return {
    artifactHash: "a".repeat(64),
    documentAssetId,
    documentVersion: 1,
    endOffset: 45,
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e11",
    sectionPath: ["Renewals"],
    startOffset: 0,
  };
}

function e2eKnowledgeNode() {
  return {
    artifactHash: "a".repeat(64),
    createdAt: "2026-05-12T19:31:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7d11",
    endOffset: 45,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7c11",
    kind: "chunk" as const,
    knowledgeSpaceId,
    metadata: {},
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f7e11",
    permissionScope: [],
    sourceLocation: { endOffset: 45, sectionPath: ["Renewals"], startOffset: 0 },
    startOffset: 0,
    text: "Renewal notice moved from 30 to 45 days.",
  };
}
