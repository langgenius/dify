import { z } from "@hono/zod-openapi";
import { DateTimeSchema } from "@knowledge/core";

import {
  KnowledgeSpaceProfileMigrationCheckpoints,
  KnowledgeSpaceProfileMigrationRunStates,
} from "./knowledge-space-profile-migration";
import { KnowledgeSpaceProfileKinds } from "./knowledge-space-profile-repository";

export const KnowledgeSpaceProfileMigrationParamsSchema = z
  .object({ id: z.string().uuid(), migrationId: z.string().uuid() })
  .strict();

export const KnowledgeSpaceProfileMigrationSpaceParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const KnowledgeSpaceProfileMigrationIdempotencyHeadersSchema = z
  .object({ "idempotency-key": z.string().trim().min(8).max(255) })
  .passthrough();

export const RequestKnowledgeSpaceProfileMigrationBodySchema = z
  .object({
    candidateRevision: z.number().int().positive(),
    changedKind: z.enum(KnowledgeSpaceProfileKinds),
  })
  .strict();

export const CancelKnowledgeSpaceProfileMigrationBodySchema = z
  .object({ reason: z.string().trim().min(1).max(512).optional() })
  .strict();

export const KnowledgeSpaceProfileMigrationResponseSchema = z
  .object({
    candidatePublicationFingerprint: z.string().trim().min(1).max(86).optional(),
    changedKind: z.enum(KnowledgeSpaceProfileKinds),
    checkpoint: z.enum(KnowledgeSpaceProfileMigrationCheckpoints),
    completedAt: DateTimeSchema.optional(),
    createdAt: DateTimeSchema,
    errorCode: z.string().trim().min(1).max(64).optional(),
    evaluationSummary: z.record(z.union([z.boolean(), z.number(), z.string()])).optional(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    rebuildScope: z.enum([
      "clone-publication",
      "full-page-index-summary-outline",
      "full-vector-space",
    ]),
    runState: z.enum(KnowledgeSpaceProfileMigrationRunStates),
    updatedAt: DateTimeSchema,
  })
  .strict()
  .openapi("KnowledgeSpaceProfileMigration");

export type RequestKnowledgeSpaceProfileMigrationBody = z.infer<
  typeof RequestKnowledgeSpaceProfileMigrationBodySchema
>;
export type KnowledgeSpaceProfileMigrationParams = z.infer<
  typeof KnowledgeSpaceProfileMigrationParamsSchema
>;
