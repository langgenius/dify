import { type AnswerTrace, EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { traceEvidenceAvailabilityFromMetadata } from "./answer-trace-evidence-availability";
import { projectAnswerTraceEvidence } from "./answer-trace-evidence-projection";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const BUNDLE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const AVAILABLE_NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const DELETED_NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const AVAILABLE_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const DELETED_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";

describe("answer trace evidence projection", () => {
  it("keeps available evidence and tombstones only evidence from a deleted document", async () => {
    const trace = bundledTrace();
    const projection = await projectAnswerTraceEvidence({
      assets: {
        get: vi.fn(async ({ id }) => (id === AVAILABLE_ASSET_ID ? { metadata: {} } : null)),
      } as never,
      candidateGrants: [],
      nodes: {
        getManyByIdsAcrossGenerations: vi.fn(async () => [
          node(AVAILABLE_NODE_ID, AVAILABLE_ASSET_ID),
          node(DELETED_NODE_ID, DELETED_ASSET_ID),
        ]),
      } as never,
      trace,
    });

    expect(projection).not.toBeNull();
    expect(projection?.bundle?.items[0]).toMatchObject({
      metadata: { label: "available" },
      text: "Available evidence",
    });
    expect(projection?.bundle?.items[1]).toMatchObject({
      citations: [{ documentAssetId: DELETED_ASSET_ID, sectionPath: [] }],
      conflicts: [],
      freshness: { status: "unknown" },
      text: "Evidence deleted or unavailable",
    });
    expect(projection?.bundle?.items[1]?.metadata).not.toHaveProperty("label");
    expect(
      traceEvidenceAvailabilityFromMetadata(projection?.bundle?.items[1]?.metadata ?? {}),
    ).toEqual({
      reason: "document-deleted-or-unavailable",
      status: "unavailable",
    });
    expect(projection?.trace.steps[0]?.metadata.evidenceBundle).toEqual(projection?.bundle);
    expect(trace.steps[0]?.metadata.evidenceBundle).not.toEqual(projection?.bundle);
  });

  it("redacts permission-revoked evidence without exposing its original metadata", async () => {
    const trace = bundledTrace();
    const projection = await projectAnswerTraceEvidence({
      assets: { get: vi.fn(async () => ({ metadata: { permissionScope: ["private"] } })) } as never,
      candidateGrants: [],
      nodes: {
        getManyByIdsAcrossGenerations: vi.fn(async () => [
          node(AVAILABLE_NODE_ID, AVAILABLE_ASSET_ID),
          node(DELETED_NODE_ID, DELETED_ASSET_ID),
        ]),
      } as never,
      trace,
    });

    expect(projection?.bundle?.items).toHaveLength(2);
    for (const item of projection?.bundle?.items ?? []) {
      expect(item.metadata).not.toHaveProperty("label");
      expect(traceEvidenceAvailabilityFromMetadata(item.metadata)).toEqual({
        reason: "permission-denied",
        status: "unavailable",
      });
    }
  });

  it("revalidates all cited documents with one bounded bulk lookup", async () => {
    const get = vi.fn(async () => {
      throw new Error("Per-document lookup must not run when bulk lookup is available");
    });
    const getManyByIds = vi.fn(async () => [
      { id: AVAILABLE_ASSET_ID, metadata: {} },
      { id: DELETED_ASSET_ID, metadata: {} },
    ]);

    const projection = await projectAnswerTraceEvidence({
      assets: { get, getManyByIds } as never,
      candidateGrants: [],
      nodes: {
        getManyByIdsAcrossGenerations: vi.fn(async () => [
          node(AVAILABLE_NODE_ID, AVAILABLE_ASSET_ID),
          node(DELETED_NODE_ID, DELETED_ASSET_ID),
        ]),
      } as never,
      trace: bundledTrace(),
    });

    expect(projection?.bundle?.items.map((item) => item.text)).toEqual([
      "Available evidence",
      "Deleted document content",
    ]);
    expect(get).not.toHaveBeenCalled();
    expect(getManyByIds).toHaveBeenCalledOnce();
    expect(getManyByIds).toHaveBeenCalledWith({
      ids: [AVAILABLE_ASSET_ID, DELETED_ASSET_ID],
      knowledgeSpaceId: SPACE_ID,
    });
  });

  it("rejects only a trace whose referenced bundle is unavailable", async () => {
    const trace = answerTrace([], BUNDLE_ID);
    await expect(
      projectAnswerTraceEvidence({
        assets: { get: vi.fn() } as never,
        candidateGrants: [],
        nodes: { getManyByIdsAcrossGenerations: vi.fn() } as never,
        trace,
      }),
    ).resolves.toBeNull();
  });
});

function bundledTrace(): AnswerTrace {
  const bundle = EvidenceBundleSchema.parse({
    createdAt: "2026-08-30T12:00:00.000Z",
    id: BUNDLE_ID,
    items: [
      evidenceItem({
        assetId: AVAILABLE_ASSET_ID,
        label: "available",
        nodeId: AVAILABLE_NODE_ID,
        text: "Available evidence",
      }),
      evidenceItem({
        assetId: DELETED_ASSET_ID,
        label: "deleted-secret",
        nodeId: DELETED_NODE_ID,
        text: "Deleted document content",
      }),
    ],
    query: "What changed?",
    state: "answerable",
    traceId: TRACE_ID,
  });
  return answerTrace(
    [
      {
        metadata: { evidenceBundle: bundle },
        name: "query.generate",
        startedAt: "2026-08-30T12:00:00.000Z",
        status: "ok",
      },
    ],
    BUNDLE_ID,
  );
}

function answerTrace(steps: AnswerTrace["steps"], evidenceBundleId?: string): AnswerTrace {
  return {
    createdAt: "2026-08-30T12:00:00.000Z",
    ...(evidenceBundleId ? { evidenceBundleId } : {}),
    id: TRACE_ID,
    knowledgeSpaceId: SPACE_ID,
    mode: "fast",
    query: "What changed?",
    steps,
  };
}

function evidenceItem({
  assetId,
  label,
  nodeId,
  text,
}: {
  assetId: string;
  label: string;
  nodeId: string;
  text: string;
}) {
  return {
    citations: [{ documentAssetId: assetId, documentVersion: 1, sectionPath: [label] }],
    freshness: { status: "fresh" as const },
    metadata: { label },
    nodeId,
    score: 0.9,
    scores: { final: 0.9, retrieval: 0.8 },
    text,
  };
}

function node(id: string, documentAssetId: string) {
  return { documentAssetId, id, permissionScope: [] };
}
