import { z } from "@hono/zod-openapi";
import { KnowledgePathSchema, KnowledgeSpaceConsistencyClassSchema } from "@knowledge/core";

import { KnowledgeFsDiffModeSchema } from "./knowledge-fs-response-schemas";

const KNOWLEDGE_FS_PATH_PATTERN = /^\/(?:sources|knowledge|evidence|workspaces)(?:\/[^/\s]+)*$/;
const CandidatePermissionScopeSchema = z.array(z.string().min(1).max(512)).max(64).optional();

export const KnowledgeFsConsistencyQuerySchema = z
  .object({
    consistencyClass: KnowledgeSpaceConsistencyClassSchema.optional(),
  })
  .strict();

export const KnowledgeFsPathQuerySchema = z
  .object({
    consistencyClass: KnowledgeFsConsistencyQuerySchema.shape.consistencyClass,
    cursor: z.string().optional(),
    depth: z.coerce.number().int().min(1).max(8).optional(),
    limit: z.coerce.number().int().min(1),
    path: z.string().regex(KNOWLEDGE_FS_PATH_PATTERN),
  })
  .strict();

export const KnowledgeFsGrepQuerySchema = KnowledgeFsPathQuerySchema.omit({ depth: true })
  .extend({
    q: z.string().trim().min(1).max(4000),
    timeoutMs: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export const KnowledgeFsFindQuerySchema = KnowledgeFsPathQuerySchema.omit({ depth: true })
  .extend({
    metadataKey: z.string().min(1).max(120).optional(),
    metadataValue: z.string().min(1).max(4000).optional(),
    nameContains: z.string().min(1).max(240).optional(),
    resourceType: KnowledgePathSchema.shape.resourceType.optional(),
  })
  .strict();

export const KnowledgeFsDiffQuerySchema = z
  .object({
    consistencyClass: KnowledgeFsConsistencyQuerySchema.shape.consistencyClass,
    mode: KnowledgeFsDiffModeSchema.optional(),
    newPath: KnowledgeFsPathQuerySchema.shape.path,
    oldPath: KnowledgeFsPathQuerySchema.shape.path,
    semantic: z.enum(["true", "false"]).optional(),
  })
  .strict();

export const KnowledgeFsOpenNodeQuerySchema = z
  .object({
    consistencyClass: KnowledgeFsConsistencyQuerySchema.shape.consistencyClass,
    nodeId: z.string().uuid(),
  })
  .strict();

export const KnowledgeFsWriteBodySchema = z
  .object({
    path: KnowledgeFsPathQuerySchema.shape.path,
    text: z.string().max(256 * 1024),
  })
  .strict();

export const KnowledgeFsCommandInputSchema = z.object({
  /** Server-injected candidate grants; no public route request schema accepts this field. */
  candidatePermissionScope: CandidatePermissionScopeSchema,
  consistencyClass: KnowledgeFsConsistencyQuerySchema.shape.consistencyClass,
  cursor: z.string().optional(),
  depth: z.number().int().positive().optional(),
  knowledgeSpaceId: z.string().uuid(),
  limit: z.number().int().positive(),
  path: z.string().regex(KNOWLEDGE_FS_PATH_PATTERN),
});
export type KnowledgeFsCommandInput = z.infer<typeof KnowledgeFsCommandInputSchema>;

export const KnowledgeFsGrepCommandInputSchema = KnowledgeFsCommandInputSchema.omit({
  depth: true,
}).extend({
  q: z.string().trim().min(1).max(4000),
  timeoutMs: z.number().int().positive().max(10_000).optional(),
});
export type KnowledgeFsGrepCommandInput = z.infer<typeof KnowledgeFsGrepCommandInputSchema>;

export const KnowledgeFsFindCommandInputSchema = KnowledgeFsCommandInputSchema.omit({
  depth: true,
}).extend({
  metadataKey: z.string().min(1).max(120).optional(),
  metadataValue: z.string().min(1).max(4000).optional(),
  nameContains: z.string().min(1).max(240).optional(),
  resourceType: KnowledgePathSchema.shape.resourceType.optional(),
});
export type KnowledgeFsFindCommandInput = z.infer<typeof KnowledgeFsFindCommandInputSchema>;

export const KnowledgeFsDiffCommandInputSchema = KnowledgeFsDiffQuerySchema.extend({
  /** Server-injected candidate grants; no public route request schema accepts this field. */
  candidatePermissionScope: CandidatePermissionScopeSchema,
  knowledgeSpaceId: z.string().uuid(),
});
export type KnowledgeFsDiffCommandInput = z.infer<typeof KnowledgeFsDiffCommandInputSchema>;

export const KnowledgeFsOpenNodeCommandInputSchema = KnowledgeFsOpenNodeQuerySchema.extend({
  /** Server-injected candidate grants; no public route request schema accepts this field. */
  candidatePermissionScope: CandidatePermissionScopeSchema,
  knowledgeSpaceId: z.string().uuid(),
});
export type KnowledgeFsOpenNodeCommandInput = z.infer<typeof KnowledgeFsOpenNodeCommandInputSchema>;

export const KnowledgeFsReadCommandInputSchema = KnowledgeFsCommandInputSchema.pick({
  candidatePermissionScope: true,
  consistencyClass: true,
  cursor: true,
  knowledgeSpaceId: true,
  limit: true,
  path: true,
}).partial({ cursor: true, limit: true });
export type KnowledgeFsReadCommandInput = z.infer<typeof KnowledgeFsReadCommandInputSchema>;

export const KnowledgeFsWriteCommandInputSchema = KnowledgeFsWriteBodySchema.extend({
  /** Server-injected candidate grants; no public route request schema accepts this field. */
  candidatePermissionScope: CandidatePermissionScopeSchema,
  knowledgeSpaceId: z.string().uuid(),
});
export type KnowledgeFsWriteCommandInput = z.infer<typeof KnowledgeFsWriteCommandInputSchema>;
