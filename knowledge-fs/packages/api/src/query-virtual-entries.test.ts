import { AnswerTraceSchema, EvidenceBundleSchema } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { KnowledgeFsValidationError } from "./knowledge-fs-errors";
import {
  evidenceBundleFromAnswerTrace,
  paginateQueryVirtualEntries,
  productionBadCaseGoldenQuestionInput,
  queryConflictEntries,
  queryEvidenceEntries,
  queryMissingEntries,
} from "./query-virtual-entries";

const TRACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f8a01";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const BUNDLE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const RELATED_NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d00";
const MISSING_EVIDENCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d10";
const CREATED_AT = "2026-05-15T00:00:00.000Z";

function evidenceBundle() {
  return EvidenceBundleSchema.parse({
    createdAt: CREATED_AT,
    id: BUNDLE_ID,
    items: [
      {
        citations: [
          {
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
            documentVersion: 1,
            sectionPath: ["Roadmap"],
          },
        ],
        conflicts: [
          {
            reason: "The renewal memo conflicts with the roadmap.",
            severity: "warning",
            withNodeId: RELATED_NODE_ID,
          },
        ],
        freshness: { status: "fresh" },
        metadata: { source: "test" },
        nodeId: NODE_ID,
        score: 0.92,
        scores: { final: 0.92, retrieval: 0.88 },
        text: "KnowledgeFS exposes evidence.",
      },
    ],
    missingEvidence: [
      {
        expectedEvidenceId: MISSING_EVIDENCE_ID,
        metadata: { source: "golden" },
        reason: "not-retrieved",
        text: "Need deployment latency evidence.",
      },
    ],
    query: "What changed?",
    state: "partial",
    traceId: TRACE_ID,
  });
}

describe("query-virtual-entries", () => {
  it("extracts the latest valid evidence bundle from answer trace metadata", () => {
    const latestBundle = evidenceBundle();
    const trace = AnswerTraceSchema.parse({
      createdAt: CREATED_AT,
      id: TRACE_ID,
      knowledgeSpaceId: SPACE_ID,
      mode: "fast",
      query: "What changed?",
      steps: [
        {
          metadata: { evidenceBundle: { invalid: true } },
          name: "draft",
          startedAt: CREATED_AT,
          status: "ok",
        },
        {
          metadata: { evidenceBundle: latestBundle },
          name: "final",
          startedAt: CREATED_AT,
          status: "ok",
        },
      ],
    });

    expect(evidenceBundleFromAnswerTrace(trace)).toEqual(latestBundle);
  });

  it("maps evidence, conflict, and missing evidence entries to query virtual paths", () => {
    const bundle = evidenceBundle();

    expect(queryEvidenceEntries(TRACE_ID, bundle)).toMatchObject([
      {
        name: NODE_ID,
        path: `/queries/${TRACE_ID}/evidence/${NODE_ID}`,
        resourceType: "node",
        targetId: NODE_ID,
      },
    ]);
    expect(queryConflictEntries(TRACE_ID, bundle)).toMatchObject([
      {
        name: "conflict-1",
        path: `/queries/${TRACE_ID}/conflicts/${NODE_ID}/1`,
        targetId: RELATED_NODE_ID,
      },
    ]);
    expect(queryMissingEntries(TRACE_ID, bundle)).toMatchObject([
      {
        name: "missing-1",
        path: `/queries/${TRACE_ID}/missing/1`,
        resourceType: "evidence",
        targetId: MISSING_EVIDENCE_ID,
      },
    ]);
  });

  it("paginates virtual entries with explicit cursor validation", () => {
    const entries = queryEvidenceEntries(TRACE_ID, evidenceBundle());

    expect(
      paginateQueryVirtualEntries({
        entries: [...entries, ...entries],
        limit: 1,
        path: `/queries/${TRACE_ID}/evidence`,
      }),
    ).toMatchObject({ nextCursor: "1", truncated: true });

    expect(() =>
      paginateQueryVirtualEntries({
        cursor: "not-a-cursor",
        entries,
        limit: 1,
        path: `/queries/${TRACE_ID}/evidence`,
      }),
    ).toThrow(KnowledgeFsValidationError);
  });

  it("builds bounded production bad-case golden question input", () => {
    const trace = AnswerTraceSchema.parse({
      createdAt: CREATED_AT,
      id: TRACE_ID,
      knowledgeSpaceId: SPACE_ID,
      mode: "fast",
      query: "What changed?",
      steps: [
        {
          metadata: { evidenceBundle: evidenceBundle() },
          name: "final",
          startedAt: CREATED_AT,
          status: "ok",
        },
      ],
    });

    expect(
      productionBadCaseGoldenQuestionInput({
        reason: "bad citation",
        tags: ["retrieval"],
        trace,
      }),
    ).toMatchObject({
      expectedEvidenceIds: [NODE_ID, MISSING_EVIDENCE_ID],
      knowledgeSpaceId: SPACE_ID,
      metadata: {
        reason: "bad citation",
        source: "production-bad-case",
        traceId: TRACE_ID,
      },
      question: "What changed?",
      tags: ["production-bad-case", "needs-review", "retrieval"],
    });
  });
});
