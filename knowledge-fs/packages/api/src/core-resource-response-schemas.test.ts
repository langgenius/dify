import { describe, expect, it } from "vitest";

import {
  AnswerTraceResponseSchema,
  GoldenQuestionResponseSchema,
  KnowledgeSpaceConfigurationStatusResponseSchema,
  KnowledgeSpaceCreationResponseSchema,
  KnowledgeSpaceResponseSchema,
  ParseArtifactResponseSchema,
} from "./core-resource-response-schemas";

const CREATED_AT = "2026-05-14T00:00:00.000Z";
const UPDATED_AT = "2026-05-14T00:01:00.000Z";
const SPACE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000003";
const NODE_ID = "00000000-0000-4000-8000-000000000004";
const TRACE_ID = "00000000-0000-4000-8000-000000000005";
const BUNDLE_ID = "00000000-0000-4000-8000-000000000006";

describe("core-resource-response-schemas", () => {
  it("keeps model-configuration diagnostics bounded and state-consistent", () => {
    expect(
      KnowledgeSpaceConfigurationStatusResponseSchema.parse({
        activeProfiles: { retrievalRevision: 1 },
        availableModes: ["research"],
        pendingModelConfiguration: {
          digest: "a".repeat(64),
          failure: {
            code: "MODEL_CAPABILITY_MISMATCH",
            failedAt: UPDATED_AT,
            retryable: false,
          },
          revision: 2,
          state: "validation-failed",
        },
        status: "ready",
      }),
    ).toMatchObject({ status: "ready" });

    expect(() =>
      KnowledgeSpaceConfigurationStatusResponseSchema.parse({
        activeProfiles: {},
        availableModes: [],
        pendingModelConfiguration: {
          digest: "a".repeat(64),
          embeddingSelection: {
            model: "must-not-leak",
            pluginId: "must-not-leak",
            provider: "must-not-leak",
          },
          revision: 1,
          state: "pending-validation",
        },
        status: "pending-validation",
      }),
    ).toThrow();
  });

  it("accepts knowledge space and golden question core responses", () => {
    expect(
      KnowledgeSpaceResponseSchema.parse({
        createdAt: CREATED_AT,
        description: "Engineering docs",
        id: SPACE_ID,
        name: "Engineering Knowledge",
        revision: 1,
        slug: "engineering-knowledge",
        tenantId: "tenant-a",
        updatedAt: UPDATED_AT,
      }),
    ).toMatchObject({ slug: "engineering-knowledge" });

    expect(
      KnowledgeSpaceCreationResponseSchema.parse({
        configurationStatus: "setup-required",
        createdAt: CREATED_AT,
        id: SPACE_ID,
        name: "Needs model setup",
        revision: 1,
        slug: "needs-model-setup",
        tenantId: "tenant-a",
        updatedAt: UPDATED_AT,
      }),
    ).toMatchObject({ configurationStatus: "setup-required" });

    expect(
      GoldenQuestionResponseSchema.parse({
        createdAt: CREATED_AT,
        expectedAnswer: "KnowledgeFS exposes agent-readable evidence.",
        expectedEvidenceIds: [NODE_ID],
        id: "00000000-0000-4000-8000-000000000007",
        knowledgeSpaceId: SPACE_ID,
        metadata: { owner: "eval" },
        question: "What does KnowledgeFS expose?",
        tags: ["retrieval"],
        updatedAt: UPDATED_AT,
      }),
    ).toMatchObject({ expectedEvidenceIds: [NODE_ID] });
  });

  it("accepts parse artifact and answer trace core responses", () => {
    expect(
      ParseArtifactResponseSchema.parse({
        artifactHash: "a".repeat(64),
        contentType: "structured",
        createdAt: CREATED_AT,
        documentAssetId: DOCUMENT_ID,
        elements: [
          {
            id: "element-1",
            pageNumber: 1,
            sectionPath: ["Overview"],
            text: "KnowledgeFS exposes agent-readable evidence.",
            type: "paragraph",
          },
        ],
        id: ARTIFACT_ID,
        metadata: { traceId: TRACE_ID },
        parser: "native-markdown",
        updatedAt: UPDATED_AT,
        version: 1,
      }),
    ).toMatchObject({ parser: "native-markdown" });

    expect(
      AnswerTraceResponseSchema.parse({
        createdAt: CREATED_AT,
        evidenceBundleId: BUNDLE_ID,
        id: TRACE_ID,
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        query: "What does KnowledgeFS expose?",
        steps: [
          {
            endedAt: UPDATED_AT,
            name: "recall",
            startedAt: CREATED_AT,
            status: "ok",
          },
        ],
      }),
    ).toMatchObject({ mode: "fast", steps: [{ name: "recall" }] });
  });
});
