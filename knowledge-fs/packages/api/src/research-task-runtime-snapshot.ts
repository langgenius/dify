import {
  type JobPayload,
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";
import { z } from "zod";

import type {
  PublishedKnowledgeSpaceRuntimeSnapshot,
  PublishedKnowledgeSpaceRuntimeSnapshotResolver,
} from "./published-knowledge-space-runtime-snapshot";
import {
  type PublishedProjectionReadSnapshotLookupInput,
  PublishedProjectionReadUnavailableError,
} from "./published-projection-read-snapshot";

export const RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY = "__knowledgeFsPublishedRuntimeSnapshot";

const FrozenResearchTaskRuntimeSnapshotSchema = z
  .object({
    embeddingCapabilitySnapshot: z.record(z.unknown()).optional(),
    embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.optional(),
    projectionSnapshot: z
      .object({
        fingerprint: z.string().min(1),
        headRevision: z.number().int().positive(),
        knowledgeSpaceId: z.string().uuid(),
        projectionVersion: z.number().int().positive(),
        publicationId: z.string().uuid(),
        tenantId: z.string().min(1),
      })
      .strict(),
    retrievalCapabilitySnapshot: z.record(z.unknown()),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (Boolean(snapshot.embeddingProfile) !== Boolean(snapshot.embeddingCapabilitySnapshot)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Embedding profile and capability snapshot must be frozen together",
        path: ["embeddingCapabilitySnapshot"],
      });
    }
  });

export type FrozenResearchTaskRuntimeSnapshot = z.infer<
  typeof FrozenResearchTaskRuntimeSnapshotSchema
>;

export const RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID =
  "RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID" as const;

export class ResearchTaskRuntimeSnapshotInvalidError extends Error {
  readonly code = RESEARCH_TASK_RUNTIME_SNAPSHOT_INVALID;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResearchTaskRuntimeSnapshotInvalidError";
  }
}

export function toResearchTaskRuntimeSnapshotPayload(
  snapshot: PublishedKnowledgeSpaceRuntimeSnapshot,
): JobPayload {
  return JSON.parse(
    JSON.stringify(FrozenResearchTaskRuntimeSnapshotSchema.parse(snapshot)),
  ) as JobPayload;
}

export async function captureResearchTaskRuntimeSnapshotPayload({
  knowledgeSpaceId,
  resolvedMode,
  resolver,
  snapshot: suppliedSnapshot,
  tenantId,
}: PublishedProjectionReadSnapshotLookupInput & {
  readonly resolvedMode: "deep" | "fast" | "research";
  readonly resolver: PublishedKnowledgeSpaceRuntimeSnapshotResolver;
  readonly snapshot?: PublishedKnowledgeSpaceRuntimeSnapshot | undefined;
}): Promise<JobPayload> {
  const snapshot = suppliedSnapshot ?? (await resolver.resolve({ knowledgeSpaceId, tenantId }));
  if (
    snapshot.projectionSnapshot.knowledgeSpaceId !== knowledgeSpaceId ||
    snapshot.projectionSnapshot.tenantId !== tenantId
  ) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task runtime snapshot scope mismatch",
    );
  }
  await resolver.assertReady({ knowledgeSpaceId, resolvedMode, tenantId });
  if (resolvedMode !== "research" && !snapshot.embeddingProfile) {
    throw new PublishedProjectionReadUnavailableError({
      knowledgeSpaceId,
      resolvedMode,
      tenantId,
    });
  }
  return toResearchTaskRuntimeSnapshotPayload(snapshot);
}

export function researchTaskRuntimeSnapshotFromMetadata(
  metadata: Readonly<Record<string, JobPayload>>,
): FrozenResearchTaskRuntimeSnapshot | undefined {
  const value = metadata[RESEARCH_TASK_RUNTIME_SNAPSHOT_METADATA_KEY];
  if (value === undefined) {
    return undefined;
  }
  try {
    return FrozenResearchTaskRuntimeSnapshotSchema.parse(value);
  } catch (error) {
    throw new ResearchTaskRuntimeSnapshotInvalidError(
      "Research task runtime snapshot is malformed",
      { cause: error },
    );
  }
}
