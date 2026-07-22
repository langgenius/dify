import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ComputeRuntime } from "@knowledge/compute";
import {
  DocumentOutlineSchema,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
  ParseArtifactSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createStaticAuthVerifier } from "./auth";
import {
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
  CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
  candidatePermissionScopeAllows,
  currentCandidateGrants,
} from "./candidate-content-authorization";
import { createInMemoryDocumentAssetRepository } from "./document-asset-repository";
import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";
import { createKnowledgeGateway } from "./index";
import { createInMemoryKnowledgeNodeRepository } from "./knowledge-node-repository";
import { createInMemoryKnowledgePathRepository } from "./knowledge-path-repository";
import { createInMemoryKnowledgeSpaceRepository } from "./knowledge-space-repository";
import { createInMemoryParseArtifactRepository } from "./parse-artifact-repository";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const RESTRICTED_ASSET_ID = "20000000-0000-4000-8000-000000000001";
const LEGACY_ASSET_ID = "20000000-0000-4000-8000-000000000002";
const RESTRICTED_ARTIFACT_ID = "30000000-0000-4000-8000-000000000001";
const LEGACY_ARTIFACT_ID = "30000000-0000-4000-8000-000000000002";
const RESTRICTED_NODE_ID = "40000000-0000-4000-8000-000000000001";
const LEGACY_NODE_ID = "40000000-0000-4000-8000-000000000002";
const OWNER_ROLE_GRANT = `knowledge-space:${SPACE_ID}:role:owner`;
const owner = { scopes: ["knowledge-spaces:*"], subjectId: "owner-1", tenantId: "tenant-1" };
const editor = { scopes: ["knowledge-spaces:*"], subjectId: "editor-1", tenantId: "tenant-1" };
const viewer = { scopes: ["knowledge-spaces:*"], subjectId: "viewer-1", tenantId: "tenant-1" };
const foreignTenant = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "owner-1",
  tenantId: "tenant-2",
};

describe("candidate content authorization", () => {
  it("uses AND semantics, preserves missing legacy policy, and fails malformed policy closed", () => {
    expect(candidatePermissionScopeAllows(undefined, [])).toBe(true);
    expect(candidatePermissionScopeAllows([], [])).toBe(true);
    expect(candidatePermissionScopeAllows(["a", "b"], ["b", "a", "c"])).toBe(true);
    expect(candidatePermissionScopeAllows(["a", "b"], ["a"])).toBe(false);
    expect(candidatePermissionScopeAllows("a", ["a"])).toBe(false);
    expect(candidatePermissionScopeAllows([" a"], ["a"])).toBe(false);
    expect(candidatePermissionScopeAllows([1], ["1"])).toBe(false);
  });

  it("rejects authorization snapshots bound to another subject, tenant, or space", () => {
    const decision = {
      accessContext: {} as never,
      permissionSnapshot: {
        apiAccessRevision: 1,
        callerKind: "interactive" as const,
        candidateGrants: [OWNER_ROLE_GRANT],
        issuedAt: "2026-07-14T00:00:00.000Z",
        knowledgeSpaceId: SPACE_ID,
        memberRevision: 1,
        memberRole: "owner" as const,
        policyRevision: 1,
        subjectId: owner.subjectId,
        tenantId: owner.tenantId,
      },
    };

    expect(
      currentCandidateGrants({ decision, knowledgeSpaceId: SPACE_ID, subject: owner }),
    ).toEqual([OWNER_ROLE_GRANT]);
    expect(
      currentCandidateGrants({ decision, knowledgeSpaceId: SPACE_ID, subject: viewer }),
    ).toBeNull();
    expect(
      currentCandidateGrants({ decision, knowledgeSpaceId: SPACE_ID, subject: foreignTenant }),
    ).toBeNull();
    expect(
      currentCandidateGrants({
        decision,
        knowledgeSpaceId: "10000000-0000-4000-8000-000000000099",
        subject: owner,
      }),
    ).toBeNull();
  });

  it("filters lists and hides restricted document, artifact, outline, multimodal, node, and object reads", async () => {
    const fixture = await createFixture();

    const viewerList = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/documents?limit=1`,
      { headers: bearer("viewer") },
    );
    expect(viewerList.status).toBe(200);
    await expect(viewerList.json()).resolves.toMatchObject({
      items: [{ id: LEGACY_ASSET_ID }],
    });

    const ownerList = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/documents?limit=10`,
      {
        headers: bearer("owner"),
      },
    );
    expect(ownerList.status).toBe(200);
    await expect(ownerList.json()).resolves.toMatchObject({
      items: [{ id: RESTRICTED_ASSET_ID }, { id: LEGACY_ASSET_ID }],
    });

    const restrictedDocumentPaths = [
      `/knowledge-spaces/${SPACE_ID}/documents/${RESTRICTED_ASSET_ID}`,
      `/knowledge-spaces/${SPACE_ID}/documents/${RESTRICTED_ASSET_ID}/parse-artifacts/1`,
      `/knowledge-spaces/${SPACE_ID}/documents/${RESTRICTED_ASSET_ID}/outline`,
      `/knowledge-spaces/${SPACE_ID}/documents/${RESTRICTED_ASSET_ID}/multimodal`,
    ];
    for (const path of restrictedDocumentPaths) {
      expect((await fixture.app.request(path, { headers: bearer("viewer") })).status, path).toBe(
        404,
      );
      expect((await fixture.app.request(path, { headers: bearer("owner") })).status, path).toBe(
        200,
      );
    }

    const restrictedFsPaths = [
      `/knowledge-spaces/${SPACE_ID}/fs/open_node?nodeId=${RESTRICTED_NODE_ID}`,
      `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/docs/restricted.md")}`,
      `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/docs/restricted-node.md")}`,
      `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/by-topic/restricted.md")}`,
      `/knowledge-spaces/${SPACE_ID}/fs/stat?path=${encodeURIComponent("/knowledge/docs/restricted.md")}`,
      `/knowledge-spaces/${SPACE_ID}/fs/find?path=${encodeURIComponent("/knowledge/docs/restricted.md")}&limit=10`,
      `/knowledge-spaces/${SPACE_ID}/fs/grep?path=${encodeURIComponent("/knowledge/docs/restricted.md")}&limit=10&q=restricted`,
      `/knowledge-spaces/${SPACE_ID}/fs/diff?oldPath=${encodeURIComponent("/knowledge/docs/legacy.md")}&newPath=${encodeURIComponent("/knowledge/docs/restricted.md")}`,
    ];
    for (const path of restrictedFsPaths) {
      expect((await fixture.app.request(path, { headers: bearer("viewer") })).status, path).toBe(
        404,
      );
      expect((await fixture.app.request(path, { headers: bearer("owner") })).status, path).toBe(
        200,
      );
    }

    const viewerLs = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/fs/ls?path=${encodeURIComponent("/knowledge/docs")}&limit=10`,
      { headers: bearer("viewer") },
    );
    expect(viewerLs.status).toBe(200);
    expect(JSON.stringify(await viewerLs.json())).not.toContain("restricted");
    const viewerTree = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/fs/tree?path=${encodeURIComponent("/knowledge/docs")}&limit=10&depth=4`,
      { headers: bearer("viewer") },
    );
    expect(viewerTree.status).toBe(200);
    expect(JSON.stringify(await viewerTree.json())).not.toContain("restricted");

    for (const path of [
      `/knowledge-spaces/${SPACE_ID}/documents/${LEGACY_ASSET_ID}`,
      `/knowledge-spaces/${SPACE_ID}/fs/open_node?nodeId=${LEGACY_NODE_ID}`,
      `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/docs/legacy.md")}`,
    ]) {
      expect((await fixture.app.request(path, { headers: bearer("viewer") })).status, path).toBe(
        200,
      );
    }

    expect(
      (
        await fixture.app.request(
          `/knowledge-spaces/${SPACE_ID}/documents/${RESTRICTED_ASSET_ID}`,
          { headers: bearer("foreign") },
        )
      ).status,
    ).toBe(404);
  });

  it("rejects client attempts to inject candidate grants into public KnowledgeFS requests", async () => {
    const fixture = await createFixture();
    const forgedQuery = await fixture.app.request(
      `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/docs/restricted.md")}&candidatePermissionScope=${encodeURIComponent(OWNER_ROLE_GRANT)}`,
      { headers: bearer("viewer") },
    );
    expect(forgedQuery.status).toBe(400);

    const forgedBody = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/fs/append`, {
      body: JSON.stringify({
        candidatePermissionScope: [OWNER_ROLE_GRANT],
        path: "/knowledge/docs/restricted.md",
        text: "forged",
      }),
      headers: { ...bearer("editor"), "content-type": "application/json" },
      method: "POST",
    });
    expect(forgedBody.status).toBe(400);

    const deniedAppend = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/fs/append`, {
      body: JSON.stringify({ path: "/knowledge/docs/restricted.md", text: "denied" }),
      headers: { ...bearer("editor"), "content-type": "application/json" },
      method: "POST",
    });
    expect(deniedAppend.status).toBe(404);

    const deniedWrite = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/fs/write`, {
      body: JSON.stringify({ path: "/knowledge/docs/restricted.md", text: "denied" }),
      headers: { ...bearer("editor"), "content-type": "application/json" },
      method: "POST",
    });
    expect(deniedWrite.status).toBe(404);

    const ownerAppend = await fixture.app.request(`/knowledge-spaces/${SPACE_ID}/fs/append`, {
      body: JSON.stringify({ path: "/knowledge/docs/restricted.md", text: " owner append" }),
      headers: { ...bearer("owner"), "content-type": "application/json" },
      method: "POST",
    });
    expect(ownerAppend.status).toBe(200);
    expect(
      (
        await fixture.app.request(
          `/knowledge-spaces/${SPACE_ID}/fs/cat?path=${encodeURIComponent("/knowledge/docs/restricted.md")}`,
          { headers: bearer("viewer") },
        )
      ).status,
    ).toBe(404);
  });

  it("returns a stable 503 without hidden cursors when candidate scans exhaust their budget", async () => {
    const fixture = await createFixture();
    const hiddenAssetIds: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const suffix = String(index + 1).padStart(12, "0");
      const id = `10000000-0000-4000-8000-${suffix}`;
      hiddenAssetIds.push(id);
      await createAsset({
        adapter: fixture.adapter,
        assets: fixture.assets,
        body: "hidden",
        id,
        metadata: { permissionScope: [OWNER_ROLE_GRANT] },
        name: `${suffix}.md`,
      });
    }

    const hiddenPathIds: string[] = [];
    for (let index = 0; index <= 10; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const id = `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      hiddenPathIds.push(id);
      await fixture.paths.create(
        KnowledgePathSchema.parse({
          id,
          knowledgeSpaceId: SPACE_ID,
          metadata: index < 10 ? { permissionScope: [OWNER_ROLE_GRANT] } : {},
          resourceType: "source",
          targetId: `budget-source-${suffix}`,
          viewName: "docs",
          viewType: "physical",
          virtualPath: `/knowledge/docs/budget/${suffix}-${index < 10 ? "hidden" : "visible"}.md`,
        }),
      );
    }

    const requests = [
      `/knowledge-spaces/${SPACE_ID}/documents?limit=1`,
      `/knowledge-spaces/${SPACE_ID}/fs/ls?path=${encodeURIComponent("/knowledge/docs/budget")}&limit=1`,
      `/knowledge-spaces/${SPACE_ID}/fs/tree?path=${encodeURIComponent("/knowledge/docs/budget")}&limit=1&depth=2`,
      `/knowledge-spaces/${SPACE_ID}/fs/find?path=${encodeURIComponent("/knowledge/docs/budget")}&limit=1`,
      `/knowledge-spaces/${SPACE_ID}/fs/grep?path=${encodeURIComponent("/knowledge/docs/budget")}&limit=1&q=needle`,
    ];
    for (const path of requests) {
      const response = await fixture.app.request(path, { headers: bearer("viewer") });
      expect(response.status, path).toBe(503);
      const body = await response.json();
      expect(body).toEqual({
        code: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED,
        error: CANDIDATE_VISIBILITY_SCAN_BUDGET_EXCEEDED_MESSAGE,
      });
      const serialized = JSON.stringify(body);
      for (const hiddenId of [...hiddenAssetIds, ...hiddenPathIds]) {
        expect(serialized).not.toContain(hiddenId);
      }
      expect(serialized).not.toContain("hidden.md");
      expect(serialized).not.toContain("cursor");
    }

    const openapi = (await (await fixture.app.request("/openapi.json")).json()) as {
      readonly paths: Record<
        string,
        { readonly get?: { readonly responses?: Record<string, unknown> } }
      >;
    };
    for (const path of [
      "/knowledge-spaces/{id}/documents",
      "/knowledge-spaces/{id}/fs/ls",
      "/knowledge-spaces/{id}/fs/tree",
      "/knowledge-spaces/{id}/fs/find",
      "/knowledge-spaces/{id}/fs/grep",
    ]) {
      expect(openapi.paths[path]?.get?.responses).toHaveProperty("503");
    }
  });
});

async function createFixture() {
  const adapter = createNodePlatformAdapter({ env: {} });
  const assets = createInMemoryDocumentAssetRepository({ maxAssets: 30 });
  const outlines = createInMemoryDocumentOutlineRepository({ maxOutlines: 10 });
  const artifacts = createInMemoryParseArtifactRepository({ maxArtifacts: 10 });
  const nodes = createInMemoryKnowledgeNodeRepository({
    maxBatchSize: 10,
    maxListLimit: 10,
    maxNodes: 10,
  });
  const paths = createInMemoryKnowledgePathRepository({ maxListLimit: 10, maxPaths: 20 });
  const app = createKnowledgeGateway({
    adapter,
    auth: createStaticAuthVerifier({
      subjectsByToken: { editor, foreign: foreignTenant, owner, viewer },
    }),
    compute: {
      diffText: ({ newText, oldText }: { readonly newText: string; readonly oldText: string }) => ({
        operations: [
          { kind: "delete" as const, text: oldText },
          { kind: "insert" as const, text: newText },
        ],
        stats: { delete: 1, equal: 0, insert: 1 },
      }),
    } as ComputeRuntime,
    documentAssets: assets,
    documentOutlines: outlines,
    knowledgeNodes: nodes,
    knowledgePaths: paths,
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    parseArtifacts: artifacts,
  });

  expect(
    (
      await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: "Candidate ACL", slug: "candidate-acl" }),
        headers: { ...bearer("owner"), "content-type": "application/json" },
        method: "POST",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/members`, {
        body: JSON.stringify({ role: "editor", subjectId: editor.subjectId }),
        headers: { ...bearer("owner"), "content-type": "application/json" },
        method: "POST",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/members`, {
        body: JSON.stringify({ role: "viewer", subjectId: viewer.subjectId }),
        headers: { ...bearer("owner"), "content-type": "application/json" },
        method: "POST",
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await app.request(`/knowledge-spaces/${SPACE_ID}/access-policy`, {
        body: JSON.stringify({
          expectedRevision: 1,
          partialMemberSubjectIds: [],
          visibility: "all_members",
        }),
        headers: { ...bearer("owner"), "content-type": "application/json" },
        method: "PATCH",
      })
    ).status,
  ).toBe(200);

  await Promise.all([
    createAsset({
      adapter,
      assets,
      body: "restricted body",
      id: RESTRICTED_ASSET_ID,
      metadata: { permissionScope: [OWNER_ROLE_GRANT] },
      name: "restricted.md",
    }),
    createAsset({
      adapter,
      assets,
      body: "legacy body",
      id: LEGACY_ASSET_ID,
      metadata: {},
      name: "legacy.md",
    }),
  ]);
  await artifacts.create(parseArtifact(RESTRICTED_ARTIFACT_ID, RESTRICTED_ASSET_ID, "restricted"));
  await artifacts.create(parseArtifact(LEGACY_ARTIFACT_ID, LEGACY_ASSET_ID, "legacy"));
  await outlines.create(
    DocumentOutlineSchema.parse({
      artifactHash: "a".repeat(64),
      createdAt: "2026-07-14T00:00:00.000Z",
      documentAssetId: RESTRICTED_ASSET_ID,
      id: "50000000-0000-4000-8000-000000000001",
      knowledgeSpaceId: SPACE_ID,
      metadata: {},
      nodes: [
        { id: "outline-1", level: 1, metadata: {}, title: "Restricted", tocSource: "native-toc" },
      ],
      outlineVersion: "v1",
      parseArtifactId: RESTRICTED_ARTIFACT_ID,
      version: 1,
    }),
  );
  await nodes.createMany([
    knowledgeNode(RESTRICTED_NODE_ID, RESTRICTED_ASSET_ID, RESTRICTED_ARTIFACT_ID, [
      OWNER_ROLE_GRANT,
    ]),
    knowledgeNode(LEGACY_NODE_ID, LEGACY_ASSET_ID, LEGACY_ARTIFACT_ID, []),
  ]);
  await paths.upsertMany([
    knowledgePath(
      "60000000-0000-4000-8000-000000000001",
      "/knowledge/docs/restricted.md",
      "document",
      RESTRICTED_ASSET_ID,
    ),
    knowledgePath(
      "60000000-0000-4000-8000-000000000002",
      "/knowledge/docs/legacy.md",
      "document",
      LEGACY_ASSET_ID,
    ),
    knowledgePath(
      "60000000-0000-4000-8000-000000000003",
      "/knowledge/docs/restricted-node.md",
      "node",
      RESTRICTED_NODE_ID,
    ),
    knowledgePath(
      "60000000-0000-4000-8000-000000000004",
      "/knowledge/docs/legacy-node.md",
      "node",
      LEGACY_NODE_ID,
    ),
    knowledgePath(
      "60000000-0000-4000-8000-000000000005",
      "/knowledge/by-topic/restricted.md",
      "artifact",
      RESTRICTED_ARTIFACT_ID,
      "by-topic",
      "semantic",
    ),
  ]);

  return { adapter, app, assets, paths };
}

async function createAsset(input: {
  readonly adapter: ReturnType<typeof createNodePlatformAdapter>;
  readonly assets: ReturnType<typeof createInMemoryDocumentAssetRepository>;
  readonly body: string;
  readonly id: string;
  readonly metadata: Record<string, unknown>;
  readonly name: string;
}) {
  const objectKey = `tenant-1/spaces/${SPACE_ID}/documents/${input.id}/${input.name}`;
  const body = new TextEncoder().encode(input.body);
  await input.adapter.objectStorage.putObject({ body, key: objectKey, metadata: {} });
  return input.assets.create({
    filename: input.name,
    id: input.id,
    knowledgeSpaceId: SPACE_ID,
    metadata: input.metadata,
    mimeType: "text/markdown",
    objectKey,
    sha256: "b".repeat(64),
    sizeBytes: body.byteLength,
  });
}

function parseArtifact(id: string, documentAssetId: string, text: string) {
  return ParseArtifactSchema.parse({
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-07-14T00:00:00.000Z",
    documentAssetId,
    elements: [{ id: `${text}-1`, metadata: {}, text, type: "paragraph" }],
    id,
    metadata: {},
    parser: "native-markdown",
    version: 1,
  });
}

function knowledgeNode(
  id: string,
  documentAssetId: string,
  parseArtifactId: string,
  permissionScope: readonly string[],
) {
  return KnowledgeNodeSchema.parse({
    artifactHash: "a".repeat(64),
    documentAssetId,
    endOffset: 10,
    id,
    kind: "chunk",
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    parseArtifactId,
    permissionScope,
    sourceLocation: {},
    startOffset: 0,
    text: id === RESTRICTED_NODE_ID ? "restricted node" : "legacy node",
  });
}

function knowledgePath(
  id: string,
  virtualPath: string,
  resourceType: "artifact" | "document" | "node",
  targetId: string,
  viewName = "docs",
  viewType: "physical" | "semantic" = "physical",
) {
  return KnowledgePathSchema.parse({
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    resourceType,
    targetId,
    version: 1,
    viewName,
    viewType,
    virtualPath,
  });
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}
