import {
  type KnowledgeFsGcCandidate,
  type KnowledgeFsGcDryRunReport,
  KnowledgeFsGcDryRunReportSchema,
  type PlatformAdapter,
} from "@knowledge/core";

import { KnowledgeFsLeaseConflictError } from "./knowledge-fs-lease-repository";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import type { StagedCommitRepository } from "./staged-commit-repository";

export interface KnowledgeFsStagedObjectGcDryRunInput {
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly stagedObjectPrefix: string;
  readonly tenantId: string;
}

export interface KnowledgeFsStagedObjectGcDryRun {
  preview(input: KnowledgeFsStagedObjectGcDryRunInput): Promise<KnowledgeFsGcDryRunReport>;
}

export interface KnowledgeFsStagedObjectGcDryRunOptions {
  readonly commits: StagedCommitRepository;
  readonly generateDryRunId: () => string;
  readonly maxFailedCommitsPerRun: number;
  readonly maxObjectsPerRun: number;
  readonly now?: () => string;
  readonly objectStorage: PlatformAdapter["objectStorage"];
}

export interface KnowledgeFsStagedObjectGcExecuteInput {
  readonly candidates: readonly KnowledgeFsGcCandidate[];
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeFsStagedObjectGcExecuteItem {
  readonly idempotencyKey: string;
  readonly objectKey: string;
  readonly status: "deleted" | "skipped-active-lease";
}

export interface KnowledgeFsStagedObjectGcExecuteResult {
  readonly deleted: number;
  readonly items: readonly KnowledgeFsStagedObjectGcExecuteItem[];
  readonly skipped: number;
  readonly tenantId: string;
}

export interface KnowledgeFsStagedObjectGcExecutor {
  execute(
    input: KnowledgeFsStagedObjectGcExecuteInput,
  ): Promise<KnowledgeFsStagedObjectGcExecuteResult>;
}

export interface KnowledgeFsStagedObjectGcExecutorOptions {
  readonly maxDeletes: number;
  readonly objectStorage: PlatformAdapter["objectStorage"];
  readonly operationLeases?: KnowledgeFsOperationLeaseCoordinator | undefined;
}

export function createKnowledgeFsStagedObjectGcDryRun({
  commits,
  generateDryRunId,
  maxFailedCommitsPerRun,
  maxObjectsPerRun,
  now = () => new Date().toISOString(),
  objectStorage,
}: KnowledgeFsStagedObjectGcDryRunOptions): KnowledgeFsStagedObjectGcDryRun {
  validateGcDryRunLimit("maxObjectsPerRun", maxObjectsPerRun);
  validateGcDryRunLimit("maxFailedCommitsPerRun", maxFailedCommitsPerRun);

  return {
    async preview({ cursor, knowledgeSpaceId, stagedObjectPrefix, tenantId }) {
      const decodedCursor = cursor ? decodeGcDryRunCursor(cursor) : {};
      const generatedAt = now();
      const stagedObjects = await objectStorage.listObjects({
        ...(decodedCursor.objectCursor ? { cursor: decodedCursor.objectCursor } : {}),
        limit: maxObjectsPerRun,
        prefix: stagedObjectPrefix,
      });
      const candidates: KnowledgeFsGcCandidate[] = stagedObjects.objects.map((object) => ({
        candidateType: "staged-object",
        count: 1,
        estimatedBytes: object.sizeBytes,
        idempotencyKey: gcIdempotencyKey({
          key: object.key,
          knowledgeSpaceId,
          tenantId,
          type: "staged-object",
        }),
        reason: "staged object is under the configured cleanup prefix",
        target: {
          objectKey: object.key,
          type: "staged-commit",
        },
      }));
      const failedCommitCandidates = await listFailedCommitCandidates({
        commits,
        generatedAt,
        knowledgeSpaceId,
        limit: maxFailedCommitsPerRun,
        tenantId,
      });
      candidates.push(...failedCommitCandidates);

      return KnowledgeFsGcDryRunReportSchema.parse({
        candidates,
        ...(stagedObjects.nextCursor
          ? {
              cursor: encodeGcDryRunCursor({
                objectCursor: stagedObjects.nextCursor,
              }),
            }
          : {}),
        dryRunId: generateDryRunId(),
        generatedAt,
        knowledgeSpaceId,
        summary: summarizeGcCandidates(candidates),
        tenantId,
      });
    },
  };
}

export function createKnowledgeFsStagedObjectGcExecutor({
  maxDeletes,
  objectStorage,
  operationLeases,
}: KnowledgeFsStagedObjectGcExecutorOptions): KnowledgeFsStagedObjectGcExecutor {
  validateGcLimit("maxDeletes", maxDeletes);

  return {
    async execute({ candidates, knowledgeSpaceId, tenantId }) {
      const stagedObjectCandidates = candidates.filter(isExecutableStagedObjectCandidate);

      if (stagedObjectCandidates.length > maxDeletes) {
        throw new Error(`KnowledgeFS staged object GC maxDeletes=${maxDeletes} exceeded`);
      }

      const items: KnowledgeFsStagedObjectGcExecuteItem[] = [];

      for (const candidate of stagedObjectCandidates) {
        const objectKey = candidate.target.objectKey;
        const deleteObject = () => objectStorage.deleteObject(objectKey);

        try {
          if (operationLeases) {
            await operationLeases.withLease(
              {
                knowledgeSpaceId,
                leaseType: "delete",
                metadata: {
                  idempotencyKey: candidate.idempotencyKey,
                },
                targetId: objectKey,
                targetType: "staged-commit",
                tenantId,
                virtualPath: stagedObjectGcVirtualPath(objectKey),
              },
              deleteObject,
            );
          } else {
            await deleteObject();
          }

          items.push({
            idempotencyKey: candidate.idempotencyKey,
            objectKey,
            status: "deleted",
          });
        } catch (error) {
          if (!(error instanceof KnowledgeFsLeaseConflictError)) {
            throw error;
          }

          items.push({
            idempotencyKey: candidate.idempotencyKey,
            objectKey,
            status: "skipped-active-lease",
          });
        }
      }

      return {
        deleted: items.filter((item) => item.status === "deleted").length,
        items,
        skipped: items.filter((item) => item.status === "skipped-active-lease").length,
        tenantId,
      };
    },
  };
}

export function stagedObjectGcVirtualPath(objectKey: string): string {
  return `/sources/staged/${encodeURIComponent(objectKey)}`;
}

async function listFailedCommitCandidates({
  commits,
  generatedAt,
  knowledgeSpaceId,
  limit,
  tenantId,
}: {
  readonly commits: StagedCommitRepository;
  readonly generatedAt: string;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly tenantId: string;
}): Promise<KnowledgeFsGcCandidate[]> {
  const candidates: KnowledgeFsGcCandidate[] = [];

  for (const status of ["failed-terminal", "failed-retryable"] as const) {
    if (candidates.length >= limit) {
      break;
    }

    const listed = await commits.list({
      knowledgeSpaceId,
      limit: limit - candidates.length,
      status,
      tenantId,
    });

    for (const commit of listed.items) {
      if (!commit.expiresAt || commit.expiresAt > generatedAt) {
        continue;
      }

      candidates.push({
        candidateType: "failed-commit",
        count: 1,
        estimatedBytes: commit.sizeBytes ?? 0,
        idempotencyKey: gcIdempotencyKey({
          key: commit.id,
          knowledgeSpaceId,
          tenantId,
          type: "failed-commit",
        }),
        reason: "failed staged commit is expired",
        target: {
          id: commit.id,
          ...(commit.rawObjectKey ? { objectKey: commit.rawObjectKey } : {}),
          type: "staged-commit",
        },
      });
    }
  }

  return candidates;
}

function isExecutableStagedObjectCandidate(
  candidate: KnowledgeFsGcCandidate,
): candidate is KnowledgeFsGcCandidate & { readonly target: { readonly objectKey: string } } {
  return (
    candidate.candidateType === "staged-object" && typeof candidate.target.objectKey === "string"
  );
}

function summarizeGcCandidates(candidates: readonly KnowledgeFsGcCandidate[]) {
  return {
    candidateCount: candidates.length,
    estimatedBytes: candidates.reduce((total, candidate) => total + candidate.estimatedBytes, 0),
    failedCommitCount: candidates.filter((candidate) => candidate.candidateType === "failed-commit")
      .length,
    stagedObjectCount: candidates.filter((candidate) => candidate.candidateType === "staged-object")
      .length,
  };
}

function gcIdempotencyKey({
  key,
  knowledgeSpaceId,
  tenantId,
  type,
}: {
  readonly key: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
  readonly type: KnowledgeFsGcCandidate["candidateType"];
}): string {
  return `gc:${tenantId}:${knowledgeSpaceId}:${type}:${key}`;
}

function validateGcDryRunLimit(label: string, value: number): void {
  validateGcLimit(`dry-run ${label}`, value);
}

function validateGcLimit(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`KnowledgeFS GC ${label} must be at least 1`);
  }
}

interface GcDryRunCursor {
  readonly objectCursor?: string | undefined;
}

function encodeGcDryRunCursor(cursor: GcDryRunCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeGcDryRunCursor(cursor: string): GcDryRunCursor {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      objectCursor?: unknown;
    };

    return {
      ...(typeof decoded.objectCursor === "string" ? { objectCursor: decoded.objectCursor } : {}),
    };
  } catch {
    // Fall through to the stable validation error below.
  }

  throw new Error("KnowledgeFS GC dry-run cursor is invalid");
}
