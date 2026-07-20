import { z } from "@hono/zod-openapi";
import { EvidenceBundleSchema, ResourceMountSchema } from "@knowledge/core";

export const AgentWorkspaceSnapshotCommandSchema = z
  .object({
    command: z.string().trim().min(1).max(4000),
    completedAt: z.string().datetime().optional(),
    cost: z.record(z.any()).optional(),
    input: z.record(z.any()).default({}),
    outputSummary: z.string().max(4000).optional(),
    startedAt: z.string().datetime(),
  })
  .strict();

export const AgentWorkspaceSnapshotIndexProjectionSchema = z
  .object({
    fingerprint: z.string().trim().min(1).max(512),
    projectionIds: z.array(z.string().trim().min(1).max(240)).default([]),
  })
  .strict();

export const AgentWorkspaceSnapshotSourceVersionSchema = z
  .object({
    provider: z.string().trim().min(1).max(120),
    providerResourceKey: z.string().trim().min(1).max(1000),
    version: z.string().trim().min(1).max(512),
  })
  .strict();

export const AgentWorkspaceSnapshotPathVersionSchema = z
  .object({
    version: z.string().trim().min(1).max(512),
    virtualPath: z.string().trim().min(1).max(1000),
  })
  .strict();

export const AgentWorkspaceSnapshotPermissionSchema = z
  .object({
    scopes: z.array(z.string()),
    subjectId: z.string(),
    tenantId: z.string(),
  })
  .strict();

export const AgentWorkspaceSnapshotResponseSchema = z
  .object({
    commandLog: z.array(AgentWorkspaceSnapshotCommandSchema),
    createdAt: z.string().datetime(),
    evidenceBundles: z.array(EvidenceBundleSchema),
    fingerprint: z.string().regex(/^snapshot-sha256:[a-f0-9]{64}$/),
    id: z.string().min(1),
    indexProjection: AgentWorkspaceSnapshotIndexProjectionSchema,
    knowledgeSpaceId: z.string().uuid(),
    manifestVersion: z.number().int().positive(),
    metadata: z.record(z.any()),
    mounts: z.array(ResourceMountSchema),
    pathVersions: z.array(AgentWorkspaceSnapshotPathVersionSchema),
    researchTaskJobId: z.string().optional(),
    sourceVersions: z.array(AgentWorkspaceSnapshotSourceVersionSchema),
    traceIds: z.array(z.string().min(1)),
  })
  .openapi("AgentWorkspaceSnapshot");

export const AgentWorkspaceReplayCommandStatusSchema = z.enum(["changed", "failed", "matched"]);

export const AgentWorkspaceReplayCommandResultSchema = z
  .object({
    command: z.string(),
    commandIndex: z.number().int().nonnegative(),
    completedAt: z.string().datetime(),
    error: z.string().optional(),
    input: z.record(z.any()),
    originalOutputSummary: z.string().optional(),
    replayedOutputSummary: z.string().optional(),
    startedAt: z.string().datetime(),
    status: AgentWorkspaceReplayCommandStatusSchema,
  })
  .strict();

export const AgentWorkspaceReplaySummarySchema = z
  .object({
    changed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();

export const AgentWorkspaceReplayResponseSchema = z
  .object({
    commands: z.array(AgentWorkspaceReplayCommandResultSchema),
    completedAt: z.string().datetime(),
    id: z.string().min(1),
    knowledgeSpaceId: z.string().uuid(),
    snapshotId: z.string().min(1),
    startedAt: z.string().datetime(),
    summary: AgentWorkspaceReplaySummarySchema,
    traceId: z.string().optional(),
  })
  .openapi("AgentWorkspaceReplay");

export const CreateAgentWorkspaceSnapshotRequestSchema = z
  .object({
    commandLog: z.array(AgentWorkspaceSnapshotCommandSchema).default([]),
    evidenceBundles: z.array(EvidenceBundleSchema).default([]),
    indexProjection: AgentWorkspaceSnapshotIndexProjectionSchema,
    knowledgeSpaceId: z.string().uuid(),
    manifestVersion: z.number().int().positive().default(1),
    metadata: z.record(z.any()).default({}),
    mounts: z.array(ResourceMountSchema).default([]),
    pathVersions: z.array(AgentWorkspaceSnapshotPathVersionSchema).default([]),
    researchTaskJobId: z.string().min(1).max(240).optional(),
    sourceVersions: z.array(AgentWorkspaceSnapshotSourceVersionSchema).default([]),
    traceIds: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const AgentWorkspaceSnapshotParamsSchema = z.object({
  id: z.string().min(1).max(240),
});

export type CreateAgentWorkspaceSnapshotBody = z.infer<
  typeof CreateAgentWorkspaceSnapshotRequestSchema
>;

export type AgentWorkspaceSnapshotParams = z.infer<typeof AgentWorkspaceSnapshotParamsSchema>;

export const AgentWorkspaceSnapshotReplayInputSchema = AgentWorkspaceSnapshotParamsSchema.extend({
  snapshotFingerprint: z
    .string()
    .regex(/^snapshot-sha256:[a-f0-9]{64}$/)
    .optional(),
  traceId: z.string().trim().min(1).max(240).optional(),
}).strict();

export const KnowledgeMcpWorkspaceSnapshotCreateInputSchema =
  CreateAgentWorkspaceSnapshotRequestSchema.strict();

export const KnowledgeMcpWorkspaceSnapshotGetInputSchema =
  AgentWorkspaceSnapshotParamsSchema.strict();

export const KnowledgeMcpWorkspaceSnapshotReplayInputSchema =
  AgentWorkspaceSnapshotReplayInputSchema.strict();
