import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ComputeRuntime } from "@knowledge/compute";
import { type KnowledgeNode, KnowledgeNodeSchema, KnowledgePathSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createInMemoryKnowledgeNodeRepository,
  createInMemoryKnowledgePathRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";
import { createInitializedTestDocumentAssets } from "./test-candidate-content";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const readToken = "read-token";
const otherTenantToken = "other-tenant-token";
const readSubject = {
  scopes: ["knowledge-spaces:read"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};
const otherTenantSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-2",
  tenantId: "tenant-2",
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestAuthVerifier() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [otherTenantToken]: otherTenantSubject,
      [readToken]: readSubject,
    },
  });
}

function createGatewayTestSpaceAccess(knowledgeSpaceId: string) {
  return createInitializedTestKnowledgeSpaceAccess([{ knowledgeSpaceId }]);
}

function knowledgeNode({
  id,
  pageNumber,
  sectionPath = ["Intro"],
  startOffset,
  text,
}: {
  readonly id: string;
  readonly pageNumber?: number;
  readonly sectionPath?: readonly string[];
  readonly startOffset: number;
  readonly text: string;
}): KnowledgeNode {
  return KnowledgeNodeSchema.parse({
    artifactHash: "d".repeat(64),
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    endOffset: startOffset + text.length,
    id,
    kind: "chunk",
    knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    metadata: { chunkIndex: startOffset === 0 ? 1 : 2 },
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    permissionScope: ["tenant:tenant-1"],
    sourceLocation: {
      endOffset: startOffset + text.length,
      ...(pageNumber ? { pageNumber } : {}),
      sectionPath: [...sectionPath],
      startOffset,
    },
    startOffset,
    text,
  });
}

describe("KnowledgeFS diff gateway integration", () => {
  it("serves authenticated KnowledgeFS diff and citation-ready open_node", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      maxListLimit: 10,
      maxSpaces: 1,
    });
    const nodes = createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 2,
      maxListLimit: 10,
      maxNodes: 2,
    });
    const paths = createInMemoryKnowledgePathRepository({
      maxListLimit: 10,
      maxPaths: 2,
    });
    const space = await spaces.create({
      name: "Engineering",
      slug: "engineering",
      tenantId: "tenant-1",
    });
    const oldNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7401",
      startOffset: 0,
      text: "alpha\nbeta",
    });
    const newNode = knowledgeNode({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7402",
      pageNumber: 3,
      sectionPath: ["Release notes"],
      startOffset: 20,
      text: "alpha\ngamma\nbeta",
    });
    await nodes.createMany([oldNode, newNode]);
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7501",
        knowledgeSpaceId: space.id,
        metadata: { version: 1 },
        resourceType: "node",
        targetId: oldNode.id,
        version: 1,
        viewName: "nodes",
        viewType: "physical",
        virtualPath: "/knowledge/nodes/policy-v1.md",
      }),
    );
    await paths.create(
      KnowledgePathSchema.parse({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7502",
        knowledgeSpaceId: space.id,
        metadata: { version: 2 },
        resourceType: "node",
        targetId: newNode.id,
        version: 2,
        viewName: "nodes",
        viewType: "physical",
        virtualPath: "/knowledge/nodes/policy-v2.md",
      }),
    );
    let diffInput: unknown;
    const semanticDiffCalls: unknown[] = [];
    const compute: ComputeRuntime = {
      chunkParseArtifact: () => [],
      countApproxTokens: () => 1,
      countTokens: () => 1,
      diffText(input) {
        diffInput = input;
        return {
          operations: [
            {
              kind: "equal",
              newEnd: 1,
              newStart: 1,
              oldEnd: 1,
              oldStart: 1,
              text: "alpha",
            },
            {
              kind: "insert",
              newEnd: 2,
              newStart: 2,
              text: "gamma",
            },
          ],
          stats: { delete: 0, equal: 1, insert: 1 },
        };
      },
      packEvidence: () => ({
        context: "",
        items: [],
        omitted: [],
        tokenBudget: 1,
        usedTokens: 0,
      }),
      rrfFuse: () => [],
    };
    const documentAssets = await createInitializedTestDocumentAssets(space.id, [
      oldNode.documentAssetId,
    ]);
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      compute,
      documentAssets,
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      semanticDiffProvider: {
        summarize: async (input: unknown) => {
          semanticDiffCalls.push(JSON.parse(JSON.stringify(input)));

          return {
            changes: [
              {
                category: "addition",
                evidence: ["gamma"],
                summary: "Added gamma release note.",
              },
            ],
            metadata: { provider: "fake-semantic-diff" },
            model: "semantic-diff-test",
            summary: "The new version adds gamma while preserving alpha.",
          };
        },
      },
    });

    const diffResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md&mode=line`,
      { headers: bearer(readToken) },
    );
    expect(diffResponse.status).toBe(200);
    await expect(diffResponse.json()).resolves.toEqual({
      mode: "line",
      newPath: "/knowledge/nodes/policy-v2.md",
      oldPath: "/knowledge/nodes/policy-v1.md",
      operations: [
        {
          kind: "equal",
          newEnd: 1,
          newStart: 1,
          oldEnd: 1,
          oldStart: 1,
          text: "alpha",
        },
        {
          kind: "insert",
          newEnd: 2,
          newStart: 2,
          text: "gamma",
        },
      ],
      stats: { delete: 0, equal: 1, insert: 1 },
    });
    expect(diffInput).toMatchObject({
      config: { mode: "line" },
      newText: "alpha\ngamma\nbeta",
      oldText: "alpha\nbeta",
    });

    const semanticDiffResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md&mode=word&semantic=true`,
      { headers: bearer(readToken) },
    );
    expect(semanticDiffResponse.status).toBe(200);
    await expect(semanticDiffResponse.json()).resolves.toEqual({
      mode: "word",
      newPath: "/knowledge/nodes/policy-v2.md",
      oldPath: "/knowledge/nodes/policy-v1.md",
      operations: [
        {
          kind: "equal",
          newEnd: 1,
          newStart: 1,
          oldEnd: 1,
          oldStart: 1,
          text: "alpha",
        },
        {
          kind: "insert",
          newEnd: 2,
          newStart: 2,
          text: "gamma",
        },
      ],
      semantic: {
        changes: [
          {
            category: "addition",
            evidence: ["gamma"],
            summary: "Added gamma release note.",
          },
        ],
        metadata: { provider: "fake-semantic-diff" },
        model: "semantic-diff-test",
        summary: "The new version adds gamma while preserving alpha.",
      },
      stats: { delete: 0, equal: 1, insert: 1 },
    });
    expect(semanticDiffCalls).toEqual([
      {
        mode: "word",
        newPath: "/knowledge/nodes/policy-v2.md",
        newText: "alpha\ngamma\nbeta",
        oldPath: "/knowledge/nodes/policy-v1.md",
        oldText: "alpha\nbeta",
        operations: [
          {
            kind: "equal",
            newEnd: 1,
            newStart: 1,
            oldEnd: 1,
            oldStart: 1,
            text: "alpha",
          },
          {
            kind: "insert",
            newEnd: 2,
            newStart: 2,
            text: "gamma",
          },
        ],
        stats: { delete: 0, equal: 1, insert: 1 },
      },
    ]);

    const openResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/open_node?nodeId=${newNode.id}`,
      { headers: bearer(readToken) },
    );
    expect(openResponse.status).toBe(200);
    await expect(openResponse.json()).resolves.toMatchObject({
      citation: {
        artifactHash: newNode.artifactHash,
        documentAssetId: newNode.documentAssetId,
        endOffset: newNode.endOffset,
        pageNumber: 3,
        parseArtifactId: newNode.parseArtifactId,
        sectionPath: ["Release notes"],
        startOffset: 20,
      },
      node: {
        id: newNode.id,
        knowledgeSpaceId: space.id,
        text: "alpha\ngamma\nbeta",
      },
    });

    const otherTenantResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/open_node?nodeId=${newNode.id}`,
      { headers: bearer(otherTenantToken) },
    );
    expect(otherTenantResponse.status).toBe(404);

    const missingNodeResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/open_node?nodeId=018f0d60-7a49-7cc2-9c1b-5b36f18f7499`,
      { headers: bearer(readToken) },
    );
    expect(missingNodeResponse.status).toBe(404);

    const appWithDefaultCompute = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      documentAssets,
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });
    const defaultDiffResponse = await appWithDefaultCompute.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md`,
      { headers: bearer(readToken) },
    );
    expect(defaultDiffResponse.status).toBe(200);
    await expect(defaultDiffResponse.json()).resolves.toMatchObject({
      mode: "line",
      stats: { delete: 0, equal: 2, insert: 1 },
    });
    const appWithoutSemanticDiff = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      compute,
      documentAssets,
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
    });
    const unavailableSemanticProviderResponse = await appWithoutSemanticDiff.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md&semantic=true`,
      { headers: bearer(readToken) },
    );
    expect(unavailableSemanticProviderResponse.status).toBe(503);
    await expect(unavailableSemanticProviderResponse.json()).resolves.toEqual({
      error: "KnowledgeFS semantic diff provider is not configured",
    });
    const defaultSemanticDiffResponse = await appWithDefaultCompute.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md&semantic=true`,
      { headers: bearer(readToken) },
    );
    expect(defaultSemanticDiffResponse.status).toBe(503);
    await expect(defaultSemanticDiffResponse.json()).resolves.toEqual({
      error: "KnowledgeFS semantic diff provider is not configured",
    });
    const appWithOversizedSemanticDiff = createKnowledgeGateway({
      adapter: createNodePlatformAdapter(),
      auth: createTestAuthVerifier(),
      compute,
      documentAssets,
      knowledgeNodes: nodes,
      knowledgePaths: paths,
      knowledgeSpaceAccess: await createGatewayTestSpaceAccess(space.id),
      knowledgeSpaces: spaces,
      semanticDiffProvider: {
        summarize: async () => ({
          changes: Array.from({ length: 101 }, (_, index) => ({
            category: "addition",
            evidence: [`evidence-${index}`],
            summary: `change-${index}`,
          })),
          metadata: { provider: "oversized" },
          summary: "too many changes",
        }),
      },
    });
    const oversizedSemanticDiffResponse = await appWithOversizedSemanticDiff.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/policy-v1.md&newPath=/knowledge/nodes/policy-v2.md&semantic=true`,
      { headers: bearer(readToken) },
    );
    expect(oversizedSemanticDiffResponse.status).toBe(503);
    await expect(oversizedSemanticDiffResponse.json()).resolves.toEqual({
      error: "KnowledgeFS semantic diff provider returned invalid output",
    });

    const missingDiffPathResponse = await app.request(
      `/knowledge-spaces/${space.id}/fs/diff?oldPath=/knowledge/nodes/missing.md&newPath=/knowledge/nodes/policy-v2.md`,
      { headers: bearer(readToken) },
    );
    expect(missingDiffPathResponse.status).toBe(404);
  });
});
