import { z } from "@hono/zod-openapi";
import {
  DocumentAssetSchema,
  KnowledgeNodeSchema,
  KnowledgePathSchema,
  KnowledgeSpaceConsistencyClassSchema,
} from "@knowledge/core";

import { jsonByteLength } from "./json-utils";

export const KnowledgeFsDiffModeSchema = z.enum(["line", "word"]);

export const KnowledgeFsEntryResponseSchema = z.object({
  kind: z.enum(["directory", "resource"]),
  metadata: z.record(z.unknown()),
  name: z.string(),
  path: z.string(),
  resourceType: KnowledgePathSchema.shape.resourceType.optional(),
  targetId: z.string().optional(),
  version: z.number().int().positive().optional(),
});

export const KnowledgeFsListResponseSchema = z.object({
  consistencyClass: KnowledgeSpaceConsistencyClassSchema.optional(),
  items: z.array(KnowledgeFsEntryResponseSchema),
  nextCursor: z.string().optional(),
  path: z.string(),
  preview: z.boolean().optional(),
  truncated: z.boolean(),
});

export const KnowledgeFsTreeResponseSchema = z.object({
  consistencyClass: KnowledgeSpaceConsistencyClassSchema.optional(),
  nextCursor: z.string().optional(),
  path: z.string(),
  preview: z.boolean().optional(),
  root: z.any().openapi({
    additionalProperties: true,
    type: "object",
  }),
  truncated: z.boolean(),
});

export const KnowledgeFsGrepResponseSchema = z.object({
  matches: z.array(
    z.object({
      endOffset: z.number().int().nonnegative(),
      kind: z.enum(["node", "segment"]),
      metadata: z.record(z.unknown()),
      nodeId: z.string().optional(),
      path: z.string(),
      segmentId: z.string().optional(),
      snippet: z.string(),
      startOffset: z.number().int().nonnegative(),
    }),
  ),
  nextCursor: z.string().optional(),
  path: z.string(),
  truncated: z.boolean(),
});

export const KnowledgeFsTextDiffOperationSchema = z.object({
  kind: z.enum(["equal", "insert", "delete"]),
  newEnd: z.number().int().positive().optional(),
  newStart: z.number().int().positive().optional(),
  oldEnd: z.number().int().positive().optional(),
  oldStart: z.number().int().positive().optional(),
  text: z.string(),
});

export const MAX_SEMANTIC_DIFF_CHANGES = 100;
export const MAX_SEMANTIC_DIFF_EVIDENCE_PER_CHANGE = 20;
export const MAX_SEMANTIC_DIFF_TEXT_CHARS = 8_000;
export const MAX_SEMANTIC_DIFF_METADATA_BYTES = 16_384;

export const SemanticDiffSummarySchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            category: z.string().min(1).max(120),
            evidence: z
              .array(z.string().max(MAX_SEMANTIC_DIFF_TEXT_CHARS))
              .max(MAX_SEMANTIC_DIFF_EVIDENCE_PER_CHANGE),
            summary: z.string().min(1).max(MAX_SEMANTIC_DIFF_TEXT_CHARS),
          })
          .strict(),
      )
      .max(MAX_SEMANTIC_DIFF_CHANGES),
    metadata: z
      .record(z.unknown())
      .refine((metadata) => jsonByteLength(metadata) <= MAX_SEMANTIC_DIFF_METADATA_BYTES, {
        message: `Semantic diff metadata exceeds ${MAX_SEMANTIC_DIFF_METADATA_BYTES} bytes`,
      }),
    model: z.string().min(1).max(200).optional(),
    summary: z.string().min(1).max(MAX_SEMANTIC_DIFF_TEXT_CHARS),
  })
  .strict();

export const KnowledgeFsDiffResponseSchema = z.object({
  mode: KnowledgeFsDiffModeSchema,
  newPath: z.string(),
  oldPath: z.string(),
  operations: z.array(KnowledgeFsTextDiffOperationSchema),
  semantic: SemanticDiffSummarySchema.optional(),
  stats: z.object({
    delete: z.number().int().nonnegative(),
    equal: z.number().int().nonnegative(),
    insert: z.number().int().nonnegative(),
  }),
});

export const KnowledgeFsOpenNodeResponseSchema = z.object({
  citation: z.object({
    artifactHash: z.string(),
    documentAssetId: z.string(),
    endOffset: z.number().int().nonnegative(),
    pageNumber: z.number().int().positive().optional(),
    parseArtifactId: z.string(),
    sectionPath: z.array(z.string()),
    startOffset: z.number().int().nonnegative(),
  }),
  node: KnowledgeNodeSchema,
});

export const KnowledgeFsCatResponseSchema = z.object({
  contentType: z.string(),
  nextCursor: z.string().optional(),
  path: z.string(),
  text: z.string(),
  truncated: z.boolean(),
});

export const KnowledgeFsStatResponseSchema = z.object({
  consistencyClass: KnowledgeSpaceConsistencyClassSchema.optional(),
  contentType: z.string().optional(),
  metadata: z.record(z.unknown()),
  parserStatus: DocumentAssetSchema.shape.parserStatus.optional(),
  path: z.string(),
  resourceType: KnowledgePathSchema.shape.resourceType,
  sha256: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  targetId: z.string(),
  preview: z.boolean().optional(),
  version: z.number().int().positive().optional(),
});

export const KnowledgeFsWriteResponseSchema = z.object({
  bytesWritten: z.number().int().nonnegative(),
  mode: z.enum(["append", "write"]),
  objectKey: z.string(),
  path: z.string(),
  targetId: z.string(),
  version: z.number().int().positive(),
});
