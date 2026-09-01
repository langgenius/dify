import { EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { DocumentOutlineSchema } from "@knowledge/core";
import { createInitialPageIndexLayeredTreeCheckpoint } from "./page-index-layered-tree-search";
import {
  RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY,
  ResearchEvidenceRetrievalCheckpointVersion,
  ResearchRetrievalCheckpointVersion,
  parseResearchRetrievalSearchCheckpoint,
  researchRetrievalDurableCheckpointFromMetadata,
  retrievalResultFromResearchCheckpoint,
  toResearchRetrievalDurableCheckpointPayload,
  validateResearchRetrievalCheckpointScope,
  validateResearchRetrievalDurableCheckpoint,
  validateResearchRetrievalSearchCheckpointScope,
} from "./research-retrieval-checkpoint";
import type { ResearchRetrievalSearchCheckpoint } from "./research-retrieval-checkpoint";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "20000000-0000-4000-8000-000000000001";
const OUTLINE_ID = "30000000-0000-4000-8000-000000000001";
const TRACE_ID = "40000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "50000000-0000-4000-8000-000000000001";

describe("Research retrieval durable search checkpoint", () => {
  it("round-trips the Research V3 supplemental boundary without a tree frontier", () => {
    const durable = validateResearchRetrievalDurableCheckpoint({
      evidenceBundle: evidenceBundle(),
      searchState: {
        budget: {
          elapsedMs: 10,
          exhaustedReasons: [],
          modelCalls: 2,
          openedResources: 0,
          retrievalSteps: 2,
          rounds: 0,
          supplementalSearches: 0,
        },
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        judgement: {
          coverage: 0.5,
          coveredDimensions: ["retention"],
          missingDimensions: ["exception"],
          sufficient: false,
          supplementalQuery: "invoice retention exceptions",
        },
        knowledgeSpaceId: SPACE_ID,
        phase: "supplemental",
        publicationId: PUBLICATION_ID,
        query: "invoice retention",
        queryPlan: {
          evidenceDimensions: ["retention", "exception"],
          intent: "multi-hop",
          subqueries: ["invoice retention policy"],
          useGraph: false,
        },
        sequence: 1,
        tenantId: "tenant-1",
        traceId: TRACE_ID,
        version: ResearchEvidenceRetrievalCheckpointVersion,
      },
    });

    expect(durable.searchState).toMatchObject({
      phase: "supplemental",
      version: ResearchEvidenceRetrievalCheckpointVersion,
    });
    expect(
      researchRetrievalDurableCheckpointFromMetadata({
        [RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY]:
          toResearchRetrievalDurableCheckpointPayload(durable),
      }),
    ).toEqual(durable);
  });

  it("accepts a completed interactive V3 boundary when policy intentionally skipped judge", () => {
    const durable = validateResearchRetrievalDurableCheckpoint({
      evidenceBundle: evidenceBundle(),
      searchState: {
        budget: {
          elapsedMs: 10,
          exhaustedReasons: [],
          modelCalls: 0,
          openedResources: 0,
          retrievalSteps: 1,
          rounds: 1,
          supplementalSearches: 0,
        },
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        knowledgeSpaceId: SPACE_ID,
        phase: "complete",
        publicationId: PUBLICATION_ID,
        query: "invoice retention",
        queryPlan: {
          evidenceDimensions: [],
          intent: "direct",
          subqueries: [],
          useGraph: false,
        },
        sequence: 2,
        tenantId: "tenant-1",
        traceId: TRACE_ID,
        version: ResearchEvidenceRetrievalCheckpointVersion,
      },
    });

    expect(durable.searchState).toMatchObject({ phase: "complete" });
    expect(durable.searchState).not.toHaveProperty("judgement");
  });

  it("round-trips a bounded layered frontier, decisions, queue, and budget counters", () => {
    const searchState = checkpoint();
    const durable = validateResearchRetrievalDurableCheckpoint({
      evidenceBundle: evidenceBundle(),
      searchState: JSON.parse(JSON.stringify(searchState)),
    });

    expect(durable.searchState).toMatchObject({
      budget: { modelCalls: 1, retrievalSteps: 2 },
      phase: "navigation",
      sequence: 2,
      version: ResearchRetrievalCheckpointVersion,
    });
    if (durable.searchState.version !== ResearchRetrievalCheckpointVersion) {
      throw new Error("expected V2 checkpoint fixture");
    }
    expect(durable.searchState.navigation[0]?.layeredCheckpoint.frontier).toEqual([
      expect.objectContaining({ nodeId: "chapter" }),
    ]);
    expect(durable.searchState.queue).toEqual([]);

    expect(
      researchRetrievalDurableCheckpointFromMetadata({
        [RESEARCH_RETRIEVAL_DURABLE_CHECKPOINT_METADATA_KEY]:
          toResearchRetrievalDurableCheckpointPayload(durable),
      }),
    ).toEqual(durable);
  });

  it("fails closed when query, trace, publication, or fingerprint scope changes", () => {
    const state = checkpoint();
    const scope = {
      fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
      knowledgeSpaceId: SPACE_ID,
      publicationId: PUBLICATION_ID,
      query: "invoice retention",
      tenantId: "tenant-1",
      traceId: TRACE_ID,
    } as const;

    expect(validateResearchRetrievalSearchCheckpointScope({ checkpoint: state, ...scope })).toEqual(
      state,
    );
    for (const override of [
      { query: "other" },
      { traceId: "60000000-0000-4000-8000-000000000001" },
      { publicationId: "70000000-0000-4000-8000-000000000001" },
      { fingerprint: `projection-set-sha256:${"c".repeat(64)}` },
    ]) {
      expect(() =>
        validateResearchRetrievalSearchCheckpointScope({
          checkpoint: state,
          ...scope,
          ...override,
        }),
      ).toThrow("scope mismatch");
    }
  });

  it("rejects malformed queues, duplicate navigation, and mismatched layered scope", () => {
    expect(() => parseResearchRetrievalSearchCheckpoint({})).toThrow(
      "search checkpoint is invalid",
    );
    expect(() =>
      parseResearchRetrievalSearchCheckpoint({ ...checkpoint(), queueOffset: 1 }),
    ).toThrow("queueOffset exceeds queue length");
    expect(() =>
      parseResearchRetrievalSearchCheckpoint({
        ...checkpoint(),
        navigation: [checkpoint().navigation[0], checkpoint().navigation[0]],
      }),
    ).toThrow("duplicate navigation state");
    expect(() =>
      parseResearchRetrievalSearchCheckpoint({
        ...checkpoint(),
        navigation: [
          {
            ...checkpoint().navigation[0],
            documentAssetId: "other-document",
          },
        ],
      }),
    ).toThrow("navigation scope mismatch");
  });

  it("validates durable and evidence checkpoint scope and optional metadata", () => {
    expect(researchRetrievalDurableCheckpointFromMetadata({})).toBeUndefined();
    expect(() =>
      validateResearchRetrievalDurableCheckpoint({
        evidenceBundle: { ...evidenceBundle(), query: "other" },
        searchState: checkpoint(),
      }),
    ).toThrow("durable checkpoint scope mismatch");
    expect(() =>
      validateResearchRetrievalDurableCheckpoint({
        evidenceBundle: {
          ...evidenceBundle(),
          traceId: "60000000-0000-4000-8000-000000000001",
        },
        searchState: checkpoint(),
      }),
    ).toThrow("durable checkpoint scope mismatch");

    expect(
      validateResearchRetrievalCheckpointScope({
        checkpoint: evidenceBundle(),
        query: " invoice retention ",
        traceId: TRACE_ID,
      }),
    ).toEqual(evidenceBundle());
    expect(() =>
      validateResearchRetrievalCheckpointScope({
        checkpoint: evidenceBundle(),
        query: "other",
        traceId: TRACE_ID,
      }),
    ).toThrow("checkpoint query mismatch");
    expect(() =>
      validateResearchRetrievalCheckpointScope({
        checkpoint: evidenceBundle(),
        query: "invoice retention",
        traceId: "60000000-0000-4000-8000-000000000001",
      }),
    ).toThrow("checkpoint trace mismatch");
  });

  it("rehydrates checkpoint evidence with bounded citation and source fallbacks", () => {
    const base = evidenceBundle();
    const item = {
      citations: [
        {
          artifactHash: "c".repeat(64),
          documentAssetId: DOCUMENT_ID,
          documentVersion: 1,
          endOffset: 20,
          pageNumber: 2,
          sectionPath: ["Book", "Chapter"],
          startOffset: 4,
        },
      ],
      conflicts: [],
      freshness: { status: "unknown" as const },
      metadata: {
        projectionIds: ["projection-1", 7],
        sources: ["dense", "invalid", "pageindex"],
      },
      nodeId: "b0000000-0000-4000-8000-000000000001",
      score: 0.9,
      scores: { final: 0.9, retrieval: 0.8 },
      text: "Invoice retention is seven years.",
    };
    const result = retrievalResultFromResearchCheckpoint({ ...base, items: [item] });
    expect(result.items[0]).toMatchObject({
      citation: { endOffset: 20, pageNumber: 2, startOffset: 4 },
      projectionIds: ["projection-1"],
      sources: ["dense", "pageindex"],
    });
    const citation = item.citations[0];
    if (!citation) throw new Error("Expected fixture citation");

    const fallback = retrievalResultFromResearchCheckpoint({
      ...base,
      items: [{ ...item, citations: [{ ...citation, pageNumber: undefined }], metadata: {} }],
    });
    expect(fallback.items[0]).toMatchObject({
      projectionIds: ["research-checkpoint:b0000000-0000-4000-8000-000000000001"],
      sources: ["pageindex"],
    });
    expect(fallback.items[0]?.citation).not.toHaveProperty("pageNumber");

    expect(() =>
      retrievalResultFromResearchCheckpoint({
        ...base,
        items: [{ ...item, citations: [{ ...citation, artifactHash: undefined }] }],
      }),
    ).toThrow("has no artifact hash");
  });
});

function checkpoint(): ResearchRetrievalSearchCheckpoint {
  const outline = fixtureOutline();
  return {
    budget: {
      elapsedMs: 50,
      exhaustedReasons: [],
      modelCalls: 1,
      openedResources: 0,
      retrievalSteps: 2,
      rounds: 0,
      supplementalSearches: 0,
    },
    fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
    knowledgeSpaceId: SPACE_ID,
    metrics: {
      candidateTruncated: false,
      degradationFlags: [],
      denseCandidates: 2,
      fallbackDocuments: 0,
      flattenedLevels: 0,
      layeredDocuments: 1,
      layeredSteps: 1,
      metadataFilteredCandidates: 0,
      openedRanges: 0,
      permissionFilteredCandidates: 0,
      scannedNodes: 1,
      selectedDocuments: 1,
      serializedTreeTokens: 120,
      valueMs: 4,
      wholeTreeDocuments: 0,
    },
    missingAspects: ["additional supporting evidence"],
    navigation: [
      {
        documentAssetId: DOCUMENT_ID,
        documentScore: 0.9,
        estimatedPromptTokens: 120,
        generationId: "80000000-0000-4000-8000-000000000001",
        layeredCheckpoint: {
          ...createInitialPageIndexLayeredTreeCheckpoint({
            outline,
            query: "invoice retention",
          }),
          depth: 1,
          frontier: [{ nodeId: "chapter", pathReason: ["relevant"], pathScore: 0.9 }],
          modelCalls: 1,
          visitedNodeIds: ["book"],
        },
        outlineId: OUTLINE_ID,
        scannedNodeIds: ["book"],
      },
    ],
    openedRangeCount: 0,
    openedTruncated: false,
    phase: "navigation",
    publicationId: PUBLICATION_ID,
    query: "invoice retention",
    queue: [],
    queueOffset: 0,
    researchSufficiencyReached: false,
    sequence: 2,
    tenantId: "tenant-1",
    traceId: TRACE_ID,
    version: ResearchRetrievalCheckpointVersion,
  };
}

function fixtureOutline() {
  return DocumentOutlineSchema.parse({
    artifactHash: "a".repeat(64),
    createdAt: "2026-08-06T00:00:00.000Z",
    documentAssetId: DOCUMENT_ID,
    id: OUTLINE_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    nodes: [
      {
        childNodeIds: ["chapter"],
        children: [
          {
            childNodeIds: [],
            children: [],
            endOffset: 100,
            id: "chapter",
            level: 2,
            metadata: {},
            sectionPath: ["Book", "Chapter"],
            sourceElementIds: [],
            sourceNodeIds: [],
            startOffset: 0,
            summary: "Chapter summary",
            title: "Chapter",
            tocSource: "parser-heading",
          },
        ],
        endOffset: 100,
        id: "book",
        level: 1,
        metadata: {},
        sectionPath: ["Book"],
        sourceElementIds: [],
        sourceNodeIds: [],
        startOffset: 0,
        summary: "Book summary",
        title: "Book",
        tocSource: "parser-heading",
      },
    ],
    outlineVersion: "outline-v1",
    parseArtifactId: "90000000-0000-4000-8000-000000000001",
    publicationGenerationId: "80000000-0000-4000-8000-000000000001",
    version: 1,
  });
}

function evidenceBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: "2026-08-06T00:00:00.000Z",
    id: "a0000000-0000-4000-8000-000000000001",
    items: [],
    missingEvidence: [],
    query: "invoice retention",
    state: "partial",
    traceId: TRACE_ID,
  });
}
