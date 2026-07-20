import { z } from "@hono/zod-openapi";
import { DateTimeSchema } from "@knowledge/core";

export const DurableDeletionTargetTypeSchema = z.enum([
  "knowledge_space",
  "source",
  "document",
  "logical_document",
]);

export const DurableDeletionModeSchema = z.enum(["cascade", "keep"]);

/**
 * Public checkpoints deliberately mirror the durable repository contract. More granular cleanup
 * work is reported as an item kind and never becomes a second, incompatible state machine.
 */
export const DurableDeletionCheckpointSchema = z.enum([
  "requested",
  "quiescing",
  "deleting_objects",
  "deleting_derived_data",
  "deleting_primary_data",
  "completed",
]);

export const DurableDeletionRunStateSchema = z.enum([
  "dispatch_pending",
  "queued",
  "running",
  "retry_wait",
  "completed",
  "failed",
  "canceled",
]);

export const DurableDeletionPublicErrorSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u),
    message: z.string().min(1).max(256),
    retryable: z.boolean(),
  })
  .strict();

export const DurableDeletionProgressSchema = z
  .object({
    completedItems: z.number().int().nonnegative(),
    currentItemKind: z.string().min(1).optional(),
    totalItems: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Allow-listed public projection: lease, worker, outbox and idempotency internals stay private. */
export const DurableDeletionJobResponseSchema = z
  .object({
    checkpoint: DurableDeletionCheckpointSchema,
    completedAt: DateTimeSchema.optional(),
    createdAt: DateTimeSchema,
    error: DurableDeletionPublicErrorSchema.optional(),
    id: z.string().uuid(),
    knowledgeSpaceId: z.string().uuid(),
    mode: DurableDeletionModeSchema.optional(),
    progress: DurableDeletionProgressSchema.optional(),
    retryAt: DateTimeSchema.optional(),
    runState: DurableDeletionRunStateSchema,
    targetId: z.string().uuid(),
    targetType: DurableDeletionTargetTypeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()
  .openapi("DurableDeletionJob");

export const DurableDeletionAcceptedResponseSchema = z
  .object({
    job: DurableDeletionJobResponseSchema,
    statusUrl: z.string().min(1),
  })
  .strict()
  .openapi("DurableDeletionAccepted");

export const DurableBulkDeletionAcceptedResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          documentId: z.string().uuid(),
          job: DurableDeletionJobResponseSchema,
          statusUrl: z.string().min(1),
        })
        .strict(),
    ),
    total: z.number().int().positive(),
  })
  .strict()
  .openapi("DurableBulkDeletionAccepted");

export type DurableDeletionJobResponse = z.infer<typeof DurableDeletionJobResponseSchema>;
export type DurableDeletionAcceptedResponse = z.infer<typeof DurableDeletionAcceptedResponseSchema>;
export type DurableBulkDeletionAcceptedResponse = z.infer<
  typeof DurableBulkDeletionAcceptedResponseSchema
>;
