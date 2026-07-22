import type { DatabaseRow } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type RetrievalCandidate,
  cloneRetrievalCandidate,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  mapRetrievalCandidateRow,
  normalizeRetrievalPermissionScope,
} from "./retrieval-candidates";

function candidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      documentVersion: 1,
      endOffset: 20,
      pageNumber: 2,
      sectionPath: ["Policy"],
      startOffset: 0,
    },
    metadata: {
      documentCreatedAt: "2026-05-12T12:00:00.000Z",
      documentType: "markdown",
      entities: ["contract"],
      freshnessStatus: "fresh",
      language: "en",
      nodeKind: "chunk",
      sourceId: "source-a",
      tags: ["legal"],
    },
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
    permissionScope: ["tenant:tenant-1"],
    projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    score: 0.9,
    source: "dense",
    ...overrides,
  };
}

describe("retrieval candidates", () => {
  it("maps database rows to retrieval candidates with citation and metadata", () => {
    const row: DatabaseRow = {
      artifact_hash: "b".repeat(64),
      document_asset_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      document_created_at: "2026-05-12T12:00:00.000Z",
      document_metadata: { owner: "team-a" },
      document_type: "pdf",
      document_version: 3,
      end_offset: 120,
      metadata: { ranker: "dense" },
      node_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      node_kind: "chunk",
      node_metadata: { heading: "Policy" },
      permission_scope: ["tenant:tenant-1"],
      projection_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      score: 0.82,
      source_id: "source-b",
      source_location: {
        pageNumber: 5,
        sectionPath: ["Policy", "Renewal"],
        startOffset: 100,
      },
      start_offset: 100,
    };

    expect(mapRetrievalCandidateRow(row, "fts")).toMatchObject({
      citation: {
        documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        documentVersion: 3,
        endOffset: 120,
        pageNumber: 5,
        sectionPath: ["Policy", "Renewal"],
        startOffset: 100,
      },
      metadata: {
        documentMetadata: { owner: "team-a" },
        documentType: "pdf",
        nodeKind: "chunk",
        nodeMetadata: { heading: "Policy" },
        ranker: "dense",
        sourceId: "source-b",
      },
      permissionScope: ["tenant:tenant-1"],
      score: 0.82,
      source: "fts",
    });
  });

  it("filters by metadata and permission while preserving clone isolation", () => {
    const open = candidate({ permissionScope: [] });
    const restricted = candidate({
      metadata: { ...candidate().metadata, entities: ["finance"], tags: ["internal"] },
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      permissionScope: ["tenant:tenant-2"],
    });

    const metadataFiltered = filterRetrievalCandidatesByMetadata([open, restricted], {
      documentTypes: ["markdown"],
      entities: ["contract"],
      tags: ["legal"],
    });
    expect(metadataFiltered).toHaveLength(1);
    metadataFiltered[0]?.citation.sectionPath.push("mutated");
    expect(open.citation.sectionPath).toEqual(["Policy"]);

    const allowed = normalizeRetrievalPermissionScope(["tenant:tenant-1"]);
    const permissionFiltered = filterRetrievalCandidatesByPermission([open, restricted], allowed);
    expect(permissionFiltered.map((item) => item.nodeId)).toEqual([open.nodeId]);

    const cloned = cloneRetrievalCandidate(open);
    (cloned.permissionScope as string[]).push("mutated");
    expect(open.permissionScope).toEqual([]);
    expect(() => normalizeRetrievalPermissionScope([" "])).toThrow(
      "Hybrid retrieval permissionScope entries must be non-empty strings",
    );
  });
});
