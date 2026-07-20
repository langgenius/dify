import { z } from "@hono/zod-openapi";
import { DateTimeSchema } from "@knowledge/core";

import {
  KnowledgeSpaceProfileKinds,
  KnowledgeSpaceProfileRevisionStates,
} from "./knowledge-space-profile-repository";

export const KnowledgeSpaceProfileAuditParamsSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(KnowledgeSpaceProfileKinds),
  })
  .strict();

export const KnowledgeSpaceProfileAuditQuerySchema = z
  .object({
    afterRevision: z.coerce.number().int().positive().optional(),
    limit: z.preprocess(
      (value) => (value === undefined ? 25 : value),
      z.coerce.number().int().min(1).max(100),
    ),
  })
  .strict();

const ProfileDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const KnowledgeSpaceProfileAuditRevisionSchema = z
  .object({
    activatedAt: DateTimeSchema.optional(),
    capabilitySnapshotDigest: ProfileDigestSchema,
    createdAt: DateTimeSchema,
    createdBySubjectId: z.string().trim().min(1).max(255),
    dimension: z.number().int().positive().optional(),
    failedAt: DateTimeSchema.optional(),
    failureCode: z.string().trim().min(1).max(64).optional(),
    kind: z.enum(KnowledgeSpaceProfileKinds),
    model: z.string().trim().min(1).max(256),
    pluginId: z.string().trim().min(1).max(256),
    provider: z.string().trim().min(1).max(256),
    revision: z.number().int().positive(),
    snapshotDigest: ProfileDigestSchema,
    state: z.enum(KnowledgeSpaceProfileRevisionStates),
    supersededAt: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema,
    vectorSpaceId: z
      .string()
      .regex(/^embedding-space-sha256:[a-f0-9]{64}$/u)
      .optional(),
  })
  .strict()
  .openapi("KnowledgeSpaceProfileAuditRevision");

export const KnowledgeSpaceProfileAuditListResponseSchema = z
  .object({
    activeRevision: z.number().int().positive().nullable(),
    items: z.array(KnowledgeSpaceProfileAuditRevisionSchema).max(100),
    nextRevision: z.number().int().positive().optional(),
  })
  .strict()
  .openapi("KnowledgeSpaceProfileAuditRevisionList");

export type KnowledgeSpaceProfileAuditRevision = z.infer<
  typeof KnowledgeSpaceProfileAuditRevisionSchema
>;
