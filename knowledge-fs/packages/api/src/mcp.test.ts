import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";

import {
  AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY,
  type AgentWorkspaceReplay,
  type AgentWorkspaceSnapshot,
  type AgentWorkspaceSnapshotCommand,
  type KnowledgeSpacePermissionSnapshot,
  type PublishedKnowledgeSpaceRuntimeSnapshot,
  type ResearchTaskJob,
  createKnowledgeMcpServer,
  createKnowledgeSpaceAuthorizationGuard,
  researchTaskRuntimeSnapshotFromMetadata,
} from "./index";

describe("createKnowledgeMcpServer", () => {
  it("registers Phase 1 KnowledgeFS and search tools with bounded schemas", async () => {
    const calls: string[] = [];
    const mcp = createKnowledgeMcpServer({
      authorization: testMcpAuthorization(),
      fs: {
        cat: async (input) => {
          calls.push(`cat:${input.path}`);
          return { contentType: "text/markdown", path: input.path, text: "body", truncated: false };
        },
        ls: async (input) => {
          calls.push(`ls:${input.path}:${input.limit}`);
          return { items: [], path: input.path, truncated: false };
        },
        diff: async (input) => {
          calls.push(`diff:${input.oldPath}:${input.newPath}:${input.mode ?? "line"}`);
          return {
            mode: input.mode ?? "line",
            newPath: input.newPath,
            oldPath: input.oldPath,
            operations: [],
            stats: { delete: 0, equal: 0, insert: 0 },
          };
        },
        find: async (input) => {
          calls.push(`find:${input.path}:${input.limit}:${input.nameContains ?? ""}`);
          return { items: [], path: input.path, truncated: false };
        },
        grep: async (input) => {
          calls.push(`grep:${input.path}:${input.limit}:${input.q}`);
          return { matches: [], path: input.path, truncated: false };
        },
        openNode: async (input) => {
          calls.push(`open_node:${input.nodeId}`);
          return {
            citation: {
              artifactHash: "hash",
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              endOffset: 4,
              parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
              sectionPath: ["Intro"],
              startOffset: 0,
            },
            node: {
              artifactHash: "hash",
              createdAt: "2026-05-11T00:00:00.000Z",
              documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
              endOffset: 4,
              id: input.nodeId,
              kind: "chunk",
              knowledgeSpaceId: input.knowledgeSpaceId,
              metadata: {},
              parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
              permissionScope: [],
              sourceLocation: {
                sectionPath: ["Intro"],
                startOffset: 0,
                endOffset: 4,
              },
              startOffset: 0,
              text: "node",
            },
          };
        },
        stat: async (input) => {
          calls.push(`stat:${input.path}`);
          return {
            metadata: {},
            path: input.path,
            resourceType: "document",
            targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          };
        },
        tree: async (input) => {
          calls.push(`tree:${input.path}:${input.limit}:${input.depth ?? 1}`);
          return {
            path: input.path,
            root: { kind: "directory", metadata: {}, name: "docs", path: input.path },
            truncated: false,
          };
        },
      },
      fetchEvidence: async (input) => {
        calls.push(`fetch_evidence:${input.query}:${input.topK}`);
        return {
          createdAt: "2026-05-11T00:00:00.000Z",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          items: [],
          knowledgeSpaceId: input.knowledgeSpaceId,
          missingEvidence: [],
          query: input.query,
          state: "not-enough-evidence",
        };
      },
      search: async (input) => {
        calls.push(`search:${input.query}:${input.topK}`);
        return { items: [] };
      },
      shell: {
        execute: async (input) => {
          calls.push(`shell.execute:${input.command}`);
          return {
            output: "shell-output",
            plan: { command: input.command, steps: [] },
            truncated: false,
          };
        },
        plan: async (input) => {
          calls.push(`shell.plan:${input.command}`);
          return { command: input.command, steps: [] };
        },
      },
    });

    expect(mcp.listTools().map((tool) => tool.name)).toEqual([
      "knowledge.fs.ls",
      "knowledge.fs.tree",
      "knowledge.fs.cat",
      "knowledge.fs.grep",
      "knowledge.fs.find",
      "knowledge.fs.stat",
      "knowledge.fs.diff",
      "knowledge.fs.open_node",
      "knowledge.search",
      "knowledge.fetch_evidence",
      "knowledge.shell.plan",
      "knowledge.shell.execute",
    ]);
    expect(mcp.server).toBeTruthy();
    await expect(
      mcp.callTool("knowledge.fs.ls", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      content: [{ type: "text" }],
      structuredContent: { items: [], path: "/knowledge/docs", truncated: false },
    });
    await expect(
      mcp.callTool("knowledge.fs.tree", {
        depth: 2,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        path: "/knowledge/docs",
        root: { kind: "directory", path: "/knowledge/docs" },
      },
    });
    await expect(
      mcp.callTool("knowledge.fs.cat", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        path: "/knowledge/docs/readme.md",
      }),
    ).resolves.toMatchObject({
      structuredContent: { path: "/knowledge/docs/readme.md", text: "body" },
    });
    await expect(
      mcp.callTool("knowledge.fs.grep", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 3,
        path: "/knowledge/docs",
        q: "roadmap",
      }),
    ).resolves.toMatchObject({
      structuredContent: { matches: [], path: "/knowledge/docs" },
    });
    await expect(
      mcp.callTool("knowledge.fs.find", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 3,
        nameContains: "readme",
        path: "/knowledge/docs",
      }),
    ).resolves.toMatchObject({
      structuredContent: { items: [], path: "/knowledge/docs" },
    });
    await expect(
      mcp.callTool("knowledge.fs.stat", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        path: "/knowledge/docs/readme.md",
      }),
    ).resolves.toMatchObject({
      structuredContent: { path: "/knowledge/docs/readme.md", resourceType: "document" },
    });
    await expect(
      mcp.callTool("knowledge.fs.diff", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mode: "word",
        newPath: "/knowledge/docs/v2.md",
        oldPath: "/knowledge/docs/v1.md",
      }),
    ).resolves.toMatchObject({
      structuredContent: { mode: "word", newPath: "/knowledge/docs/v2.md" },
    });
    await expect(
      mcp.callTool("knowledge.fs.open_node", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        citation: { sectionPath: ["Intro"] },
        node: { text: "node" },
      },
    });
    await expect(
      mcp.callTool("knowledge.search", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "roadmap",
        topK: 3,
      }),
    ).resolves.toMatchObject({
      structuredContent: { items: [] },
    });
    await expect(
      mcp.callTool("knowledge.fetch_evidence", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "roadmap",
        topK: 4,
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        items: [],
        query: "roadmap",
        state: "not-enough-evidence",
      },
    });
    await expect(
      mcp.callTool("knowledge.shell.plan", {
        command: "ls /knowledge/docs --limit 2",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        command: "ls /knowledge/docs --limit 2",
        steps: [],
      },
    });
    await expect(
      mcp.callTool("knowledge.shell.execute", {
        command: "cat /knowledge/docs/readme.md",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        output: "shell-output",
        truncated: false,
      },
    });
    expect(calls).toEqual([
      "ls:/knowledge/docs:10",
      "tree:/knowledge/docs:10:2",
      "cat:/knowledge/docs/readme.md",
      "grep:/knowledge/docs:3:roadmap",
      "find:/knowledge/docs:3:readme",
      "stat:/knowledge/docs/readme.md",
      "diff:/knowledge/docs/v1.md:/knowledge/docs/v2.md:word",
      "open_node:018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      "search:roadmap:3",
      "fetch_evidence:roadmap:4",
      "shell.plan:ls /knowledge/docs --limit 2",
      "shell.execute:cat /knowledge/docs/readme.md",
    ]);
  });

  it("registers an optional document outline MCP tool", async () => {
    const mcp = createKnowledgeMcpServer({
      authorization: testMcpAuthorization(),
      documents: {
        getOutline: async (input) => ({
          artifactHash: "b".repeat(64),
          createdAt: "2026-05-12T12:00:00.000Z",
          documentAssetId: input.documentId,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d80",
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: { builder: "deterministic-parse-artifact" },
          nodes: [
            {
              childNodeIds: [],
              children: [],
              id: "outline-intro",
              level: 1,
              metadata: {},
              sectionPath: ["Intro"],
              sourceElementIds: ["element-1"],
              sourceNodeIds: [],
              startOffset: 0,
              startPage: 1,
              summary: "Intro summary.",
              title: "Intro",
              titleLocation: {
                confidence: 1,
                pageNumber: 1,
                source: "parser-heading",
                startOffset: 0,
              },
              tocSource: "parser-heading",
            },
          ],
          outlineVersion: "document-outline-v1",
          parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          version: 1,
        }),
      },
      fs: minimalMcpFsHandlers(),
      fetchEvidence: async (input) => ({
        createdAt: "2026-05-11T00:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        items: [],
        knowledgeSpaceId: input.knowledgeSpaceId,
        missingEvidence: [],
        query: input.query,
        state: "not-enough-evidence",
      }),
      search: async () => ({ items: [] }),
      shell: minimalMcpShellHandlers(),
    });

    expect(mcp.listTools().map((tool) => tool.name)).toContain("knowledge.get_document_outline");
    await expect(
      mcp.callTool("knowledge.get_document_outline", {
        documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        nodes: [
          expect.objectContaining({
            sectionPath: ["Intro"],
            summary: "Intro summary.",
            title: "Intro",
          }),
        ],
      },
    });

    const mcpWithoutDocuments = createKnowledgeMcpServer({
      authorization: testMcpAuthorization(),
      fs: minimalMcpFsHandlers(),
      fetchEvidence: async (input) => ({
        createdAt: "2026-05-11T00:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        items: [],
        knowledgeSpaceId: input.knowledgeSpaceId,
        missingEvidence: [],
        query: input.query,
        state: "not-enough-evidence",
      }),
      search: async () => ({ items: [] }),
      shell: minimalMcpShellHandlers(),
    });
    await expect(
      mcpWithoutDocuments.callTool("knowledge.get_document_outline", {
        documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow("MCP tool knowledge.get_document_outline is not registered");
  });

  it("registers bounded research task MCP tools when research handlers are provided", async () => {
    const calls: string[] = [];
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      research: {
        cancel: async (input) => {
          calls.push(`research.cancel:${input.id}`);
          return researchJob({ id: input.id, stage: "canceled" });
        },
        create: async (input) => {
          calls.push(
            `research.create:${input.knowledgeSpaceId}:${input.query}:${input.topK ?? "default"}`,
          );
          return researchJob({ id: "research-task-job-1", query: input.query });
        },
        get: async (input) => {
          calls.push(`research.get:${input.id}`);
          return researchJob({ id: input.id, stage: "retrieving" });
        },
        plan: async (input) => {
          calls.push(
            `research.plan:${input.knowledgeSpaceId}:${input.query}:${input.topK ?? "default"}`,
          );
          return {
            budget: { budgetUsd: input.budgetUsd, exceedsBudget: false },
            estimates: {
              cacheHitProbability: 0.25,
              costUsd: { currency: "USD", estimated: 0.01, max: 0.02, min: 0.01 },
              inputTokens: 100,
              latencyMs: { p50: 1000, p95: 1800 },
              outputTokens: 200,
              retrievalSteps: 3,
              scannedResources: 20,
              toolCalls: 6,
              totalTokens: 300,
            },
            knowledgeSpaceId: input.knowledgeSpaceId,
            query: input.query,
            retrievalPlan: {
              denseTopK: 10,
              ftsTopK: 10,
              fusionLimit: 10,
              queryLanguage: "latin",
              requestedMode: input.mode ?? "research",
              rerankCandidateLimit: 10,
              resolvedMode: "research",
              strategyVersion: "hybrid-v1",
              topK: input.topK ?? 10,
            },
            steps: [],
            strategyVersion: "research-dry-run-planner-v1",
          };
        },
      },
    });

    expect(mcp.listTools().map((tool) => tool.name)).toContain("knowledge.research.plan");
    await expect(
      mcp.callTool("knowledge.research.plan", {
        budgetUsd: 0.25,
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        mode: "research",
        query: "Plan semantic retrieval regression research",
        topK: 5,
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        budget: { budgetUsd: 0.25, exceedsBudget: false },
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        strategyVersion: "research-dry-run-planner-v1",
      },
    });
    const createdResearch = await mcp.callTool("knowledge.research.create", {
      budgetUsd: 0.5,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limits: {
        maxRetrievalSteps: 10,
        maxScannedResources: 100,
        maxToolCalls: 20,
        timeoutMs: 30_000,
      },
      metadata: { purpose: "comparison" },
      mode: "research",
      query: "Plan semantic retrieval regression research",
      topK: 5,
    });
    expect(createdResearch).toMatchObject({
      structuredContent: {
        id: "research-task-job-1",
        query: "Plan semantic retrieval regression research",
        stage: "queued",
      },
    });
    expectNoMcpDerivedInternals(createdResearch);
    const fetchedResearch = await mcp.callTool("knowledge.research.get", {
      id: "research-task-job-1",
    });
    expect(fetchedResearch).toMatchObject({
      structuredContent: { id: "research-task-job-1", stage: "retrieving" },
    });
    expectNoMcpDerivedInternals(fetchedResearch);
    const canceledResearch = await mcp.callTool("knowledge.research.cancel", {
      id: "research-task-job-1",
    });
    expect(canceledResearch).toMatchObject({
      structuredContent: { id: "research-task-job-1", stage: "canceled" },
    });
    expectNoMcpDerivedInternals(canceledResearch);
    expect(calls).toEqual([
      "research.plan:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:Plan semantic retrieval regression research:5",
      "research.create:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:Plan semantic retrieval regression research:5",
      "research.get:research-task-job-1",
      "research.get:research-task-job-1",
      "research.cancel:research-task-job-1",
    ]);
  });

  it("freezes the Research runtime tuple before MCP create and never exposes it", async () => {
    const snapshot = mcpPublishedRuntimeSnapshot();
    const resolve = vi.fn(async () => structuredClone(snapshot));
    const assertReady = vi.fn(async () => undefined);
    let stored: ResearchTaskJob | null = null;
    let createCalls = 0;
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      research: {
        cancel: async ({ id }) => (stored?.id === id ? stored : null),
        create: async (input) => {
          createCalls += 1;
          stored = {
            ...researchJob({ id: "research-task-frozen-mcp", query: input.query }),
            metadata: (input.metadata ?? {}) as ResearchTaskJob["metadata"],
            mode: input.mode,
            topK: input.topK,
          };
          return stored;
        },
        get: async ({ id }) => (stored?.id === id ? stored : null),
        plan: async (input) => ({
          budget: { budgetUsd: input.budgetUsd, exceedsBudget: false },
          estimates: {
            cacheHitProbability: 0.25,
            costUsd: { currency: "USD", estimated: 0.01, max: 0.02, min: 0.01 },
            inputTokens: 100,
            latencyMs: { p50: 1_000, p95: 1_800 },
            outputTokens: 200,
            retrievalSteps: 3,
            scannedResources: 20,
            toolCalls: 6,
            totalTokens: 300,
          },
          knowledgeSpaceId: input.knowledgeSpaceId,
          query: input.query,
          retrievalPlan: {
            denseTopK: 10,
            ftsTopK: 10,
            fusionLimit: 10,
            queryLanguage: "latin",
            requestedMode: input.mode ?? "research",
            rerankCandidateLimit: input.mode === "research" ? 0 : 10,
            resolvedMode: input.mode === "deep" ? "deep" : "research",
            strategyVersion: "hybrid-v1",
            topK: input.topK ?? 10,
          },
          steps: [],
          strategyVersion: "research-dry-run-planner-v1",
        }),
      },
      runtimeSnapshotResolver: { assertReady, resolve },
    });

    const created = await mcp.callTool("knowledge.research.create", {
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      metadata: {
        __knowledgeFsCallerSpoof: "discarded",
        purpose: "frozen-mcp-contract",
      },
      mode: "research",
      query: "Use the frozen PageIndex publication",
      topK: 4,
    });

    expect(resolve).toHaveBeenCalledWith({
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      tenantId: snapshot.projectionSnapshot.tenantId,
    });
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      resolvedMode: "research",
      tenantId: snapshot.projectionSnapshot.tenantId,
    });
    const persisted = stored as ResearchTaskJob | null;
    expect(persisted?.metadata.purpose).toBe("frozen-mcp-contract");
    expect(persisted?.metadata).not.toHaveProperty("__knowledgeFsCallerSpoof");
    expect(researchTaskRuntimeSnapshotFromMetadata(persisted?.metadata ?? {})).toEqual(snapshot);
    expect(JSON.stringify(created)).not.toContain("__knowledgeFs");

    const fetched = await mcp.callTool("knowledge.research.get", {
      id: "research-task-frozen-mcp",
    });
    expect(JSON.stringify(fetched)).not.toContain("__knowledgeFs");

    resolve.mockResolvedValueOnce({
      projectionSnapshot: snapshot.projectionSnapshot,
      retrievalCapabilitySnapshot: snapshot.retrievalCapabilitySnapshot,
      retrievalProfile: snapshot.retrievalProfile,
    });
    await expect(
      mcp.callTool("knowledge.research.create", {
        knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
        mode: "deep",
        query: "Deep requires a frozen embedding profile",
      }),
    ).rejects.toThrow("Published projection snapshot is unavailable");
    expect(createCalls).toBe(1);
  });

  it("classifies MCP Research Auto once against the same frozen tuple used by the job", async () => {
    const snapshot = mcpPublishedRuntimeSnapshot();
    const resolveSnapshot = vi.fn(async () => structuredClone(snapshot));
    const assertReady = vi.fn(async () => undefined);
    const resolveMode = vi.fn(async () => ({
      generationModel: snapshot.retrievalProfile.reasoningModel.model,
      mode: "deep" as const,
      promptVersion: "auto-retrieval-mode-router-v1" as const,
      provider: "plugin-daemon",
      reasonCode: "relationship_exploration" as const,
    }));
    let plannedInput: unknown;
    let stored: ResearchTaskJob | null = null;
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      autoRetrievalModeResolver: { resolve: resolveMode },
      research: {
        cancel: async () => stored,
        create: async (input) => {
          stored = {
            ...researchJob({ id: "research-task-auto-mcp", query: input.query }),
            metadata: (input.metadata ?? {}) as ResearchTaskJob["metadata"],
            mode: input.mode,
            topK: input.topK,
          };
          return stored;
        },
        get: async () => stored,
        plan: async (input) => {
          plannedInput = input;
          return {
            budget: { budgetUsd: input.budgetUsd, exceedsBudget: false },
            estimates: {
              cacheHitProbability: 0.25,
              costUsd: { currency: "USD", estimated: 0.01, max: 0.02, min: 0.01 },
              inputTokens: 100,
              latencyMs: { p50: 1_000, p95: 1_800 },
              outputTokens: 200,
              retrievalSteps: 3,
              scannedResources: 20,
              toolCalls: 6,
              totalTokens: 300,
            },
            knowledgeSpaceId: input.knowledgeSpaceId,
            query: input.query,
            retrievalPlan: {
              denseTopK: input.topK ?? 10,
              ftsTopK: input.topK ?? 10,
              fusionLimit: input.topK ?? 10,
              queryLanguage: "latin" as const,
              requestedMode: input.mode ?? "research",
              rerankCandidateLimit: input.topK ?? 10,
              resolvedMode: input.resolvedMode ?? "research",
              strategyVersion: "hybrid-v1" as const,
              topK: input.topK ?? 10,
            },
            steps: [],
            strategyVersion: "research-dry-run-planner-v1" as const,
          };
        },
      },
      runtimeSnapshotResolver: { assertReady, resolve: resolveSnapshot },
    });

    const created = await mcp.callTool("knowledge.research.create", {
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      mode: "auto",
      query: "Trace the dependency chain across the selected documents",
    });

    expect(resolveSnapshot).toHaveBeenCalledOnce();
    expect(resolveMode).toHaveBeenCalledOnce();
    expect(resolveMode).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultMode: snapshot.retrievalProfile.defaultMode,
        reasoningModel: snapshot.retrievalProfile.reasoningModel,
      }),
    );
    expect(plannedInput).toMatchObject({
      mode: "auto",
      resolvedMode: "deep",
      runtimeSnapshot: snapshot,
      topK: snapshot.retrievalProfile.topK,
    });
    expect(assertReady).toHaveBeenCalledWith({
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      resolvedMode: "deep",
      tenantId: snapshot.projectionSnapshot.tenantId,
    });
    const persisted = stored as ResearchTaskJob | null;
    expect(persisted).toMatchObject({ mode: "deep", topK: snapshot.retrievalProfile.topK });
    expect(persisted?.metadata[AUTO_RETRIEVAL_MODE_DECISION_METADATA_KEY]).toMatchObject({
      publicationFingerprint: snapshot.projectionSnapshot.fingerprint,
      publicationId: snapshot.projectionSnapshot.publicationId,
      reasoningModel: snapshot.retrievalProfile.reasoningModel,
      requestedMode: "auto",
      resolvedMode: "deep",
      resolver: "llm",
      retrievalProfileRevision: snapshot.retrievalProfile.revision,
    });
    expect(researchTaskRuntimeSnapshotFromMetadata(persisted?.metadata ?? {})).toEqual(snapshot);
    expect(JSON.stringify(created)).not.toContain("__knowledgeFs");
  });

  it("resolves MCP search Auto only after schema validation and forwards the frozen tuple", async () => {
    const snapshot = mcpPublishedRuntimeSnapshot();
    const resolveSnapshot = vi.fn(async () => structuredClone(snapshot));
    const resolveMode = vi.fn(async () => ({
      generationModel: snapshot.retrievalProfile.reasoningModel.model,
      mode: "fast" as const,
      promptVersion: "auto-retrieval-mode-router-v1" as const,
      reasonCode: "direct_lookup" as const,
    }));
    const searchInputs: unknown[] = [];
    const fetchInputs: unknown[] = [];
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      autoRetrievalModeResolver: { resolve: resolveMode },
      fetchEvidence: async (input) => {
        fetchInputs.push(input);
        return {
          createdAt: "2026-05-11T00:00:00.000Z",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
          items: [],
          knowledgeSpaceId: input.knowledgeSpaceId,
          missingEvidence: [],
          query: input.query,
          state: "not-enough-evidence",
        };
      },
      runtimeSnapshotResolver: { assertReady: async () => undefined, resolve: resolveSnapshot },
      search: async (input) => {
        searchInputs.push(input);
        return { items: [] };
      },
    });
    const base = {
      knowledgeSpaceId: snapshot.projectionSnapshot.knowledgeSpaceId,
      mode: "auto",
      query: "camera sensor model",
      topK: 3,
    };

    await expect(mcp.callTool("knowledge.search", { ...base, query: "   " })).rejects.toThrow();
    await expect(
      mcp.callTool("knowledge.fetch_evidence", {
        ...base,
        query: "x".repeat(16_001),
      }),
    ).rejects.toThrow();
    expect(resolveSnapshot).not.toHaveBeenCalled();
    expect(resolveMode).not.toHaveBeenCalled();

    await mcp.callTool("knowledge.search", base);
    await mcp.callTool("knowledge.fetch_evidence", base);
    expect(resolveSnapshot).toHaveBeenCalledTimes(2);
    expect(resolveMode).toHaveBeenCalledTimes(2);
    expect(searchInputs).toEqual([
      expect.objectContaining({ mode: "fast", runtimeSnapshot: snapshot }),
    ]);
    expect(fetchInputs).toEqual([
      expect.objectContaining({ mode: "fast", runtimeSnapshot: snapshot }),
    ]);

    await mcp.callTool("knowledge.search", { ...base, mode: "deep" });
    await mcp.callTool("knowledge.fetch_evidence", {
      knowledgeSpaceId: base.knowledgeSpaceId,
      query: base.query,
      topK: base.topK,
    });
    expect(resolveSnapshot).toHaveBeenCalledTimes(4);
    expect(resolveMode).toHaveBeenCalledTimes(2);
    expect(searchInputs.at(-1)).toMatchObject({ mode: "deep", runtimeSnapshot: snapshot });
    expect(fetchInputs.at(-1)).toMatchObject({
      mode: snapshot.retrievalProfile.defaultMode,
      runtimeSnapshot: snapshot,
    });
  });

  it("rejects unknown tools and unbounded tool inputs", async () => {
    const mcp = createKnowledgeMcpServer({
      authorization: testMcpAuthorization(),
      fs: {
        cat: async () => ({
          contentType: "text/markdown",
          path: "/knowledge/docs/a.md",
          text: "",
          truncated: false,
        }),
        ls: async () => ({ items: [], path: "/knowledge/docs", truncated: false }),
        diff: async () => ({
          mode: "line",
          newPath: "/knowledge/docs/b.md",
          oldPath: "/knowledge/docs/a.md",
          operations: [],
          stats: { delete: 0, equal: 0, insert: 0 },
        }),
        find: async () => ({ items: [], path: "/knowledge/docs", truncated: false }),
        grep: async () => ({ matches: [], path: "/knowledge/docs", truncated: false }),
        openNode: async () => {
          throw new Error("not used");
        },
        stat: async () => ({
          metadata: {},
          path: "/knowledge/docs/a.md",
          resourceType: "document",
          targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        }),
        tree: async () => ({
          path: "/knowledge/docs",
          root: { kind: "directory", metadata: {}, name: "docs", path: "/knowledge/docs" },
          truncated: false,
        }),
      },
      maxFsListLimit: 10,
      maxSearchTopK: 5,
      fetchEvidence: async () => ({
        createdAt: "2026-05-11T00:00:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
        items: [],
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        missingEvidence: [],
        query: "roadmap",
        state: "not-enough-evidence",
      }),
      search: async () => ({ items: [] }),
      shell: {
        execute: async (input) => ({
          output: null,
          plan: { command: input.command, steps: [] },
          truncated: false,
        }),
        plan: async (input) => ({ command: input.command, steps: [] }),
      },
    });

    await expect(mcp.callTool("knowledge.fs.unknown", {})).rejects.toThrow(
      "MCP tool knowledge.fs.unknown is not registered",
    );
    await expect(
      mcp.callTool("knowledge.fs.ls", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 11,
        path: "/knowledge/docs",
      }),
    ).rejects.toThrow("MCP fs list limit exceeds maxFsListLimit=10");
    await expect(
      mcp.callTool("knowledge.fs.grep", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 11,
        path: "/knowledge/docs",
        q: "roadmap",
      }),
    ).rejects.toThrow("MCP fs list limit exceeds maxFsListLimit=10");
    await expect(
      mcp.callTool("knowledge.search", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "roadmap",
        topK: 6,
      }),
    ).rejects.toThrow("MCP search topK exceeds maxSearchTopK=5");
    await expect(
      mcp.callTool("knowledge.fetch_evidence", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "roadmap",
        topK: 6,
      }),
    ).rejects.toThrow("MCP fetch_evidence topK exceeds maxSearchTopK=5");
    await expect(
      mcp.callTool("knowledge.shell.plan", {
        command: "",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).rejects.toThrow();
  });

  it("rejects unbounded research MCP inputs and absent research tools", async () => {
    const noResearch = createKnowledgeMcpServer(minimalMcpHandlers());
    expect(noResearch.listTools().map((tool) => tool.name)).not.toContain(
      "knowledge.research.plan",
    );
    await expect(noResearch.callTool("knowledge.research.plan", {})).rejects.toThrow(
      "MCP tool knowledge.research.plan is not registered",
    );

    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      maxResearchTopK: 5,
      research: {
        cancel: async (input) => researchJob({ id: input.id, stage: "canceled" }),
        create: async (input) => researchJob({ id: "research-task-job-1", query: input.query }),
        get: async (input) => researchJob({ id: input.id }),
        plan: async (input) => ({
          budget: { exceedsBudget: false },
          estimates: {
            cacheHitProbability: 0,
            costUsd: { currency: "USD", estimated: 0, max: 0, min: 0 },
            inputTokens: 0,
            latencyMs: { p50: 0, p95: 0 },
            outputTokens: 0,
            retrievalSteps: 0,
            scannedResources: 0,
            toolCalls: 0,
            totalTokens: 0,
          },
          knowledgeSpaceId: input.knowledgeSpaceId,
          query: input.query,
          retrievalPlan: {
            denseTopK: 0,
            ftsTopK: 0,
            fusionLimit: 0,
            queryLanguage: "latin",
            requestedMode: "research",
            rerankCandidateLimit: 0,
            resolvedMode: "research",
            strategyVersion: "hybrid-v1",
            topK: 1,
          },
          steps: [],
          strategyVersion: "research-dry-run-planner-v1",
        }),
      },
    });

    await expect(
      mcp.callTool("knowledge.research.plan", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "too broad",
        topK: 6,
      }),
    ).rejects.toThrow("MCP research topK exceeds maxResearchTopK=5");
    await expect(
      mcp.callTool("knowledge.research.create", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        query: "bad tenant",
        tenantId: "tenant-from-client",
      }),
    ).rejects.toThrow();
    await expect(mcp.callTool("knowledge.research.get", { id: "" })).rejects.toThrow();
  });

  it("registers workspace snapshot MCP tools when snapshot handlers are provided", async () => {
    const calls: string[] = [];
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      workspaceSnapshots: {
        create: async (input) => {
          calls.push(`snapshot.create:${input.knowledgeSpaceId}:${input.commandLog.length}`);
          return workspaceSnapshot({
            commandLog: input.commandLog,
            id: "agent-workspace-snapshot-1",
            knowledgeSpaceId: input.knowledgeSpaceId,
          });
        },
        get: async (input) => {
          calls.push(`snapshot.get:${input.id}`);
          return workspaceSnapshot({ id: input.id });
        },
        replay: async (input) => {
          calls.push(
            `snapshot.replay:${input.id}:${input.traceId ?? "no-trace"}:${input.snapshotFingerprint ?? "no-fingerprint"}`,
          );
          return workspaceReplay({ snapshotId: input.id, traceId: input.traceId });
        },
      },
    });

    expect(mcp.listTools().map((tool) => tool.name)).toContain(
      "knowledge.workspace_snapshot.create",
    );
    const createdSnapshot = await mcp.callTool(
      "knowledge.workspace_snapshot.create",
      workspaceSnapshotToolInput(),
    );
    expect(createdSnapshot).toMatchObject({
      structuredContent: {
        id: "agent-workspace-snapshot-1",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      },
    });
    expectNoMcpDerivedInternals(createdSnapshot);
    const fetchedSnapshot = await mcp.callTool("knowledge.workspace_snapshot.get", {
      id: "agent-workspace-snapshot-1",
    });
    expect(fetchedSnapshot).toMatchObject({
      structuredContent: {
        id: "agent-workspace-snapshot-1",
      },
    });
    expectNoMcpDerivedInternals(fetchedSnapshot);
    expect(mcp.listTools().map((tool) => tool.name)).toContain(
      "knowledge.workspace_snapshot.replay",
    );
    const replayedSnapshot = await mcp.callTool("knowledge.workspace_snapshot.replay", {
      id: "agent-workspace-snapshot-1",
      snapshotFingerprint:
        "snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      traceId: "trace-1",
    });
    expect(replayedSnapshot).toMatchObject({
      structuredContent: {
        snapshotId: "agent-workspace-snapshot-1",
        summary: { matched: 1, total: 1 },
        traceId: "trace-1",
      },
    });
    expectNoMcpDerivedInternals(replayedSnapshot);
    expect(calls).toEqual([
      "snapshot.create:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:1",
      "snapshot.get:agent-workspace-snapshot-1",
      "snapshot.get:agent-workspace-snapshot-1",
      "snapshot.replay:agent-workspace-snapshot-1:trace-1:snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("rejects absent workspace snapshot MCP tools and caller-supplied tenant fields", async () => {
    const noSnapshots = createKnowledgeMcpServer(minimalMcpHandlers());
    await expect(
      noSnapshots.callTool("knowledge.workspace_snapshot.create", workspaceSnapshotToolInput()),
    ).rejects.toThrow("MCP tool knowledge.workspace_snapshot.create is not registered");

    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      workspaceSnapshots: {
        create: async (input) =>
          workspaceSnapshot({
            id: "agent-workspace-snapshot-1",
            knowledgeSpaceId: input.knowledgeSpaceId,
          }),
        get: async (input) => workspaceSnapshot({ id: input.id }),
      },
    });

    await expect(
      mcp.callTool("knowledge.workspace_snapshot.create", {
        ...workspaceSnapshotToolInput(),
        permissionSnapshot: { scopes: ["malicious"], subjectId: "evil", tenantId: "evil" },
        tenantId: "tenant-from-client",
      }),
    ).rejects.toThrow();
    await expect(mcp.callTool("knowledge.workspace_snapshot.get", { id: "" })).rejects.toThrow();
    await expect(
      mcp.callTool("knowledge.workspace_snapshot.replay", { id: "agent-workspace-snapshot-1" }),
    ).rejects.toThrow("MCP tool knowledge.workspace_snapshot.replay is not registered");
  });

  it("registers bounded read-only operator status and fsck tools when configured", async () => {
    const calls: string[] = [];
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      maxOperatorIssues: 1,
      operator: {
        fsck: async (input) => {
          calls.push(`fsck:${input.knowledgeSpaceId}:${input.check}`);
          return {
            issues: [
              fsckIssue("missing_raw_object", "error"),
              fsckIssue("checksum_mismatch", "critical"),
            ],
            knowledgeSpaceId: input.knowledgeSpaceId,
            scannedAt: "2026-05-27T11:05:00.000Z",
            summary: {
              critical: 1,
              error: 1,
              info: 0,
              repairable: 0,
              scanned: 2,
              warning: 0,
            },
            tenantId: "tenant-1",
          };
        },
        status: async (input) => {
          calls.push(`status:${input.knowledgeSpaceId}`);
          return {
            activeLeases: { count: 0, items: [], truncated: false },
            knowledgeSpaceId: input.knowledgeSpaceId,
          };
        },
      },
    });

    expect(mcp.listTools().map((tool) => tool.name)).toContain("knowledge.space.status");
    expect(mcp.listTools().map((tool) => tool.name)).toContain("knowledge.fsck");
    await expect(
      mcp.callTool("knowledge.space.status", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        activeLeases: { count: 0 },
      },
    });
    await expect(
      mcp.callTool("knowledge.fsck", {
        check: "raw-objects",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        issues: [{ code: "missing_raw_object" }],
        summary: { scanned: 2 },
        truncated: true,
      },
    });
    expect(calls).toEqual([
      "status:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      "fsck:018f0d60-7a49-7cc2-9c1b-5b36f18f2c42:raw-objects",
    ]);
  });

  it("passes snapshot fingerprints through MCP read commands for pinned consistency", async () => {
    const calls: string[] = [];
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      fs: {
        ...minimalMcpHandlers().fs,
        ls: async (input) => {
          calls.push(input.snapshotFingerprint ?? "no-fingerprint");
          return { items: [], path: input.path, truncated: false };
        },
      },
    });

    await expect(
      mcp.callTool("knowledge.fs.ls", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        path: "/knowledge/docs",
        snapshotFingerprint:
          "snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).resolves.toMatchObject({
      structuredContent: { path: "/knowledge/docs" },
    });
    await expect(
      mcp.callTool("knowledge.fs.ls", {
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        limit: 10,
        path: "/knowledge/docs",
        snapshotFingerprint: "bad-fingerprint",
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      "snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("uses a fixed MCP caller identity, enforces API Access, and injects server grants", async () => {
    const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
    const seen: string[][] = [];
    const accessContext = (enabled: boolean) => ({
      apiAccess: { enabled, id: "api-access-1", revision: 1 },
      member: { id: "member-1", revision: 1, role: "viewer" as const, subjectId: "user-1" },
      partialMemberSubjectIds: [],
      policy: {
        id: "policy-1",
        ownerSubjectId: "owner-1",
        revision: 1,
        visibility: "all_members" as const,
      },
    });
    let enabled = true;
    const mcp = createKnowledgeMcpServer({
      ...minimalMcpHandlers(),
      authorization: {
        guard: createKnowledgeSpaceAuthorizationGuard({
          access: { getAccessContext: async () => accessContext(enabled) },
        }),
        subject: { scopes: ["knowledge-spaces:*"], subjectId: "user-1", tenantId: "tenant-1" },
      },
      search: async (input) => {
        seen.push([...(input.permissionScope ?? [])]);
        return { items: [] };
      },
    });
    const input = { knowledgeSpaceId, query: "camera", topK: 3 };

    await expect(mcp.callTool("knowledge.search", input)).resolves.toBeDefined();
    expect(seen[0]).toContain(`knowledge-space:${knowledgeSpaceId}`);
    expect(seen[0]).not.toContain("knowledge-spaces:*");

    enabled = false;
    await expect(mcp.callTool("knowledge.search", input)).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_API_ACCESS_DISABLED",
    });
    expect(seen).toHaveLength(1);
  });
});

function minimalMcpHandlers(): Parameters<typeof createKnowledgeMcpServer>[0] {
  return {
    authorization: testMcpAuthorization(),
    fetchEvidence: async (input) => ({
      createdAt: "2026-05-11T00:00:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      items: [],
      knowledgeSpaceId: input.knowledgeSpaceId,
      missingEvidence: [],
      query: input.query,
      state: "not-enough-evidence",
    }),
    fs: {
      cat: async (input) => ({
        contentType: "text/markdown",
        path: input.path,
        text: "",
        truncated: false,
      }),
      diff: async (input) => ({
        mode: input.mode ?? "line",
        newPath: input.newPath,
        oldPath: input.oldPath,
        operations: [],
        stats: { delete: 0, equal: 0, insert: 0 },
      }),
      find: async (input) => ({ items: [], path: input.path, truncated: false }),
      grep: async (input) => ({ matches: [], path: input.path, truncated: false }),
      ls: async (input) => ({ items: [], path: input.path, truncated: false }),
      openNode: async (input) => ({
        citation: {
          artifactHash: "hash",
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          endOffset: 4,
          parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          sectionPath: [],
          startOffset: 0,
        },
        node: {
          artifactHash: "hash",
          createdAt: "2026-05-11T00:00:00.000Z",
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          endOffset: 4,
          id: input.nodeId,
          kind: "chunk",
          knowledgeSpaceId: input.knowledgeSpaceId,
          metadata: {},
          parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          permissionScope: [],
          sourceLocation: { endOffset: 4, sectionPath: [], startOffset: 0 },
          startOffset: 0,
          text: "node",
        },
      }),
      stat: async (input) => ({
        metadata: {},
        path: input.path,
        resourceType: "document",
        targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      }),
      tree: async (input) => ({
        path: input.path,
        root: { kind: "directory", metadata: {}, name: "docs", path: input.path },
        truncated: false,
      }),
    },
    search: async () => ({ items: [] }),
    shell: {
      execute: async (input) => ({
        output: "shell-output",
        plan: { command: input.command, steps: [] },
        truncated: false,
      }),
      plan: async (input) => ({ command: input.command, steps: [] }),
    },
  };
}

function testMcpAuthorization(): Parameters<typeof createKnowledgeMcpServer>[0]["authorization"] {
  const subject = { scopes: ["knowledge-spaces:*"], subjectId: "user-1", tenantId: "tenant-1" };
  const permissionSnapshot = mcpPermissionSnapshot();
  return {
    access: {
      createPermissionSnapshot: async (input) => ({
        ...permissionSnapshot,
        accessChannel: input.accessChannel,
        expiresAt: input.expiresAt,
        knowledgeSpaceId: input.knowledgeSpaceId,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
      }),
      revalidatePermissionSnapshot: async () => permissionSnapshot,
    },
    guard: createKnowledgeSpaceAuthorizationGuard({
      access: {
        getAccessContext: async () => ({
          apiAccess: { enabled: true, id: "api-access-1", revision: 1 },
          member: { id: "member-1", revision: 1, role: "owner", subjectId: subject.subjectId },
          partialMemberSubjectIds: [],
          policy: {
            id: "policy-1",
            ownerSubjectId: subject.subjectId,
            revision: 1,
            visibility: "only_me",
          },
        }),
      },
    }),
    subject,
  };
}

function mcpPermissionSnapshot(): KnowledgeSpacePermissionSnapshot {
  return {
    accessChannel: "mcp",
    accessPolicyRevision: 1,
    apiAccessRevision: 1,
    createdAt: "2026-05-11T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    memberRevision: 1,
    permissionScopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
    revision: 1,
    role: "owner",
    status: "active",
    subjectId: "user-1",
    tenantId: "tenant-1",
    updatedAt: "2026-05-11T00:00:00.000Z",
    visibility: "only_me",
  };
}

function expectNoMcpDerivedInternals(result: CallToolResult): void {
  const serialized = JSON.stringify({
    content: result.content,
    structuredContent: result.structuredContent,
  });
  for (const key of [
    "leaseExpiresAt",
    "leaseToken",
    "permissionScope",
    "permissionSnapshot",
    "queueJobId",
    "rowVersion",
    "subjectId",
    "tenantId",
    "workerId",
  ]) {
    expect(serialized).not.toContain(`\"${key}\"`);
  }
}

function fsckIssue(code: string, severity: "critical" | "error") {
  return {
    code,
    message: code,
    repairability: "manual" as const,
    severity,
    target: {
      objectKey: `tenant-1/spaces/space/documents/${code}.md`,
      type: "raw-object" as const,
    },
    type:
      code === "missing_raw_object"
        ? ("missing-raw-object" as const)
        : ("checksum-mismatch" as const),
  };
}

function researchJob({
  id,
  query = "Research",
  stage = "queued",
}: {
  readonly id: string;
  readonly query?: string;
  readonly stage?: "canceled" | "queued" | "retrieving";
}) {
  return {
    cost: { entries: [], totalUsd: 0 },
    createdAt: 1_000,
    executionAttempts: 0,
    id,
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: {},
    maxExecutionAttempts: 5,
    permissionSnapshot: {
      accessChannel: "mcp" as const,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      revision: 1,
    },
    query,
    queueJobId: "queue-job-1",
    rowVersion: 1,
    stage,
    subjectId: "user-1",
    tenantId: "tenant-1",
    updatedAt: 1_000,
  };
}

function mcpPublishedRuntimeSnapshot(): PublishedKnowledgeSpaceRuntimeSnapshot {
  return {
    embeddingCapabilitySnapshot: {
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      pluginUniqueIdentifier: "embedding-install-v3",
    },
    embeddingProfile: {
      dimension: 2_048,
      model: "embed-v3",
      pluginId: "plugin-embedding",
      provider: "provider-a",
      revision: 3,
      vectorSpaceId: `embedding-space-sha256:${"b".repeat(64)}`,
    },
    projectionSnapshot: {
      fingerprint: "sha256:publication-v8",
      headRevision: 8,
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      projectionVersion: 8,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: {
      reasoning: { pluginUniqueIdentifier: "reasoning-install-v5" },
    },
    retrievalProfile: {
      defaultMode: "research",
      reasoningModel: {
        model: "reason-v5",
        pluginId: "plugin-reasoning",
        provider: "provider-a",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-v2",
          pluginId: "plugin-rerank",
          provider: "provider-a",
        },
      },
      revision: 5,
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.42 },
      topK: 4,
    },
  };
}

function workspaceSnapshotToolInput() {
  return {
    commandLog: [
      {
        command: "ls /knowledge/docs --limit 2",
        input: { path: "/knowledge/docs" },
        outputSummary: "2 docs",
        startedAt: "2026-05-12T16:19:01.000Z",
      },
    ],
    evidenceBundles: [],
    indexProjection: {
      fingerprint: "projection-v1",
      projectionIds: ["projection-1"],
    },
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { reason: "agent-resume" },
    mounts: [],
    sourceVersions: [
      {
        provider: "object-storage",
        providerResourceKey: "tenant-1/uploads/a.md",
        version: "sha256:abc",
      },
    ],
    traceIds: ["018f0d60-7a49-7cc2-9c1b-5b36f18f6e11"],
  };
}

function workspaceSnapshot({
  commandLog = [],
  id,
  knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
}: {
  readonly commandLog?: readonly AgentWorkspaceSnapshotCommand[];
  readonly id: string;
  readonly knowledgeSpaceId?: string;
}): AgentWorkspaceSnapshot {
  return {
    commandLog,
    createdAt: "2026-05-12T16:21:00.000Z",
    evidenceBundles: [],
    fingerprint: "snapshot-sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    id,
    indexProjection: { fingerprint: "projection-v1", projectionIds: ["projection-1"] },
    knowledgeSpaceId,
    manifestVersion: 1,
    metadata: {},
    mounts: [],
    pathVersions: [],
    permissionSnapshot: {
      accessChannel: "mcp",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      revision: 1,
      scopes: ["knowledge-spaces:read"],
      subjectId: "user-1",
      tenantId: "tenant-1",
    },
    sourceVersions: [],
    tenantId: "tenant-1",
    traceIds: [],
  };
}

function workspaceReplay({
  snapshotId,
  traceId,
}: {
  readonly snapshotId: string;
  readonly traceId?: string | undefined;
}): AgentWorkspaceReplay {
  return {
    commands: [
      {
        command: "ls /knowledge/docs --limit 2",
        commandIndex: 0,
        completedAt: "2026-05-12T16:22:01.000Z",
        input: { path: "/knowledge/docs" },
        originalOutputSummary: "2 docs",
        replayedOutputSummary: "2 docs",
        startedAt: "2026-05-12T16:22:00.000Z",
        status: "matched",
      },
    ],
    completedAt: "2026-05-12T16:22:02.000Z",
    id: "agent-workspace-replay-1",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    snapshotId,
    startedAt: "2026-05-12T16:22:00.000Z",
    summary: { changed: 0, failed: 0, matched: 1, total: 1 },
    tenantId: "tenant-1",
    ...(traceId ? { traceId } : {}),
  };
}

function minimalMcpFsHandlers() {
  return {
    cat: async (input: { readonly path: string }) => ({
      contentType: "text/markdown",
      path: input.path,
      text: "body",
      truncated: false,
    }),
    diff: async (input: {
      readonly mode?: "line" | "word" | undefined;
      readonly newPath: string;
      readonly oldPath: string;
    }) => ({
      mode: input.mode ?? "line",
      newPath: input.newPath,
      oldPath: input.oldPath,
      operations: [],
      stats: { delete: 0, equal: 0, insert: 0 },
    }),
    find: async (input: { readonly path: string }) => ({
      items: [],
      path: input.path,
      truncated: false,
    }),
    grep: async (input: { readonly path: string }) => ({
      matches: [],
      path: input.path,
      truncated: false,
    }),
    ls: async (input: { readonly path: string }) => ({
      items: [],
      path: input.path,
      truncated: false,
    }),
    openNode: async (input: {
      readonly knowledgeSpaceId: string;
      readonly nodeId: string;
    }) => ({
      citation: {
        artifactHash: "hash",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 4,
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        sectionPath: ["Intro"],
        startOffset: 0,
      },
      node: {
        artifactHash: "hash",
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
        endOffset: 4,
        id: input.nodeId,
        kind: "chunk" as const,
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: {},
        parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        permissionScope: [],
        sourceLocation: { sectionPath: ["Intro"] },
        startOffset: 0,
        text: "node",
      },
    }),
    stat: async (input: { readonly path: string }) => ({
      metadata: {},
      path: input.path,
      resourceType: "document" as const,
      targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    }),
    tree: async (input: { readonly path: string }) => ({
      path: input.path,
      root: { kind: "directory" as const, metadata: {}, name: "docs", path: input.path },
      truncated: false,
    }),
  };
}

function minimalMcpShellHandlers() {
  return {
    execute: async (input: { readonly command: string }) => ({
      output: "shell-output",
      plan: { command: input.command, steps: [] },
      truncated: false,
    }),
    plan: async (input: { readonly command: string }) => ({
      command: input.command,
      steps: [],
    }),
  };
}
