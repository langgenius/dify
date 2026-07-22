import { describe, expect, it } from "vitest";

import {
  AnnotateGoldenQuestionSchema,
  CreateGoldenQuestionSchema,
  CreateKnowledgeSpaceSchema,
  GoldenQuestionParamsSchema,
  KnowledgeSpaceParamsSchema,
  ListGoldenQuestionsQuerySchema,
  ListKnowledgeSpacesQuerySchema,
  UpdateGoldenQuestionSchema,
  UpdateKnowledgeSpaceRetrievalProfileSchema,
  UpdateKnowledgeSpaceSchema,
} from "./knowledge-space-golden-question-schemas";

const SPACE_ID = "00000000-0000-4000-8000-000000000001";
const QUESTION_ID = "00000000-0000-4000-8000-000000000002";

describe("knowledge-space-golden-question-schemas", () => {
  it("validates knowledge-space params, create/update bodies, and list queries", () => {
    expect(KnowledgeSpaceParamsSchema.parse({ id: SPACE_ID })).toEqual({ id: SPACE_ID });
    expect(CreateKnowledgeSpaceSchema.parse({ name: "Engineering", slug: "engineering" })).toEqual({
      name: "Engineering",
      slug: "engineering",
    });
    expect(
      CreateKnowledgeSpaceSchema.parse({
        iconRef: "builtin:camera-spec",
        name: "Camera",
        slug: "camera",
      }),
    ).toMatchObject({ iconRef: "builtin:camera-spec" });
    expect(UpdateKnowledgeSpaceSchema.parse({ expectedRevision: 1, iconRef: null })).toEqual({
      expectedRevision: 1,
      iconRef: null,
    });
    expect(CreateKnowledgeSpaceSchema.parse({ name: "Generated slug" })).toEqual({
      name: "Generated slug",
    });
    expect(
      CreateKnowledgeSpaceSchema.parse({ idempotencyKey: "  create-request-1  ", name: "Replay" }),
    ).toEqual({ idempotencyKey: "create-request-1", name: "Replay" });
    expect(CreateKnowledgeSpaceSchema.parse({ name: "  Trimmed space  " })).toEqual({
      name: "Trimmed space",
    });
    expect(
      UpdateKnowledgeSpaceSchema.parse({ expectedRevision: 1, name: "\tRenamed space\n" }),
    ).toEqual({ expectedRevision: 1, name: "Renamed space" });
    expect(
      CreateKnowledgeSpaceSchema.parse({
        embeddingProfile: {
          model: "embed-v2",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Research",
        slug: "research",
      }),
    ).toMatchObject({ embeddingProfile: { model: "embed-v2" } });
    expect(
      UpdateKnowledgeSpaceRetrievalProfileSchema.parse({
        expectedRevision: 0,
        profile: {
          defaultMode: "fast",
          reasoningModel: {
            model: "gpt-4.1-mini",
            pluginId: "openai-plugin",
            provider: "openai",
          },
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "rerank" },
          topK: 3,
        },
      }),
    ).toMatchObject({ expectedRevision: 0, profile: { defaultMode: "fast", topK: 3 } });
    expect(
      UpdateKnowledgeSpaceSchema.parse({
        description: "Updated",
        expectedRevision: 1,
        slug: "engineering-v2",
      }),
    ).toMatchObject({
      expectedRevision: 1,
      slug: "engineering-v2",
    });
    expect(ListKnowledgeSpacesQuerySchema.parse({ cursor: "abc", limit: "25" })).toEqual({
      cursor: "abc",
      limit: 25,
    });
    expect(ListKnowledgeSpacesQuerySchema.parse({})).toEqual({ limit: 100 });
  });

  it("validates golden-question params, create/update bodies, and bounded annotations", () => {
    expect(GoldenQuestionParamsSchema.parse({ id: SPACE_ID, questionId: QUESTION_ID })).toEqual({
      id: SPACE_ID,
      questionId: QUESTION_ID,
    });
    expect(
      CreateGoldenQuestionSchema.parse({
        expectedEvidenceIds: [QUESTION_ID],
        metadata: { owner: "eval" },
        question: "What does KnowledgeFS expose?",
        tags: ["retrieval"],
      }),
    ).toMatchObject({ tags: ["retrieval"] });
    expect(UpdateGoldenQuestionSchema.parse({ metadata: { reviewed: true } })).toEqual({
      metadata: { reviewed: true },
    });
    expect(ListGoldenQuestionsQuerySchema.parse({ limit: "10" })).toEqual({ limit: 10 });
    expect(ListGoldenQuestionsQuerySchema.parse({})).toEqual({ limit: 100 });

    expect(
      AnnotateGoldenQuestionSchema.parse({
        answerCorrectness: "partially-correct",
        evidenceRelevance: [
          {
            evidenceId: QUESTION_ID,
            note: "Supports the answer",
            relevant: true,
          },
        ],
        note: "Needs one more citation",
      }),
    ).toMatchObject({ answerCorrectness: "partially-correct" });
  });

  it("rejects invalid slugs and oversized annotation evidence", () => {
    expect(() => CreateKnowledgeSpaceSchema.parse({ name: " \t\n " })).toThrow();
    expect(() =>
      UpdateKnowledgeSpaceSchema.parse({ expectedRevision: 1, name: "\u00a0\t" }),
    ).toThrow();
    expect(() => CreateKnowledgeSpaceSchema.parse({ name: "Bad", slug: "Bad Slug" })).toThrow();
    expect(() =>
      CreateKnowledgeSpaceSchema.parse({
        iconRef: "https://example.com/icon.png",
        name: "External icon",
      }),
    ).toThrow();
    expect(() =>
      UpdateKnowledgeSpaceSchema.parse({ expectedRevision: 1, iconRef: "builtin:Camera" }),
    ).toThrow();
    expect(() =>
      CreateKnowledgeSpaceSchema.parse({ name: "Too long", slug: "a".repeat(161) }),
    ).toThrow();
    expect(() =>
      CreateKnowledgeSpaceSchema.parse({ idempotencyKey: "a".repeat(256), name: "Too long" }),
    ).toThrow();
    expect(() =>
      CreateKnowledgeSpaceSchema.parse({
        embeddingProfile: {
          dimension: 1536,
          model: "embed-v2",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Unsafe",
        slug: "unsafe",
      }),
    ).toThrow();
    expect(() =>
      CreateKnowledgeSpaceSchema.parse({
        embeddingProfile: {
          credentials: { apiKey: "secret" },
          model: "embed-v2",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Unsafe",
        slug: "unsafe",
      }),
    ).toThrow();
    expect(() =>
      AnnotateGoldenQuestionSchema.parse({
        answerCorrectness: "correct",
        evidenceRelevance: Array.from({ length: 51 }, (_, index) => ({
          evidenceId: index % 2 === 0 ? SPACE_ID : QUESTION_ID,
          relevant: true,
        })),
      }),
    ).toThrow();
  });
});
