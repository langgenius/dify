import { randomUUID } from "node:crypto";

import type { JobPayload, JobRecord } from "@knowledge/core";

export type RetentionPolicyScopeName = "tenant" | "knowledge_space";

export interface RetentionPolicyScope {
  readonly knowledgeSpaceId?: string | undefined;
  readonly tenantId: string;
}

export interface RetentionPolicy {
  readonly answerTraceRetentionDays: number;
  readonly createdAt: string;
  readonly evidenceCacheRetentionDays: number;
  readonly id: string;
  readonly inactiveProjectionRetentionDays: number;
  readonly knowledgeSpaceId: string | null;
  readonly parseArtifactVersions: number;
  readonly rawDocumentRetentionDays: number | null;
  readonly scope: RetentionPolicyScopeName;
  readonly sessionInactivityMinutes: number;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface RetentionPolicyPatch {
  readonly answerTraceRetentionDays?: number | undefined;
  readonly evidenceCacheRetentionDays?: number | undefined;
  readonly inactiveProjectionRetentionDays?: number | undefined;
  readonly parseArtifactVersions?: number | undefined;
  readonly rawDocumentRetentionDays?: number | null | undefined;
  readonly sessionInactivityMinutes?: number | undefined;
}

export interface RetentionPolicyRepository {
  get(scope: RetentionPolicyScope): Promise<RetentionPolicy>;
  update(input: {
    readonly patch: RetentionPolicyPatch;
    readonly scope: RetentionPolicyScope;
  }): Promise<RetentionPolicy>;
}

export interface InMemoryRetentionPolicyRepositoryOptions {
  readonly generateId?: () => string;
  readonly maxPolicies: number;
  readonly now?: () => string;
}

export interface KnowledgeSpaceRetentionCleanupWorkerOptions {
  readonly answerTraces: {
    deleteOlderThan(input: {
      readonly knowledgeSpaceId: string;
      readonly maxTraces: number;
      readonly olderThan: string;
    }): Promise<number>;
  };
  readonly indexProjections: {
    pruneInactiveVersions(input: {
      readonly knowledgeSpaceId: string;
      readonly maxProjections: number;
      readonly retainVersions: number;
      readonly type: "dense-vector" | "fts";
    }): Promise<number>;
  };
  readonly jobs: Pick<JobEnqueuer, "enqueue">;
  readonly maxProjectionDeletes: number;
  readonly maxTraceDeletes: number;
  readonly now?: () => string;
  readonly projectionRetainVersions?: number | undefined;
  readonly retentionPolicies: RetentionPolicyRepository;
}

export interface EnqueueKnowledgeSpaceRetentionCleanupInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceRetentionCleanupPayload {
  readonly [key: string]: JobPayload;
  readonly knowledgeSpaceId: string;
  readonly maxProjectionDeletes: number;
  readonly maxTraceDeletes: number;
  readonly projectionRetainVersions: number;
  readonly requestedAt: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceRetentionCleanupResult {
  readonly answerTraceOlderThan: string;
  readonly answerTracesDeleted: number;
  readonly denseVectorProjectionsDeleted: number;
  readonly ftsProjectionsDeleted: number;
  readonly knowledgeSpaceId: string;
  readonly sessionTtlMinutes: number;
  readonly tenantId: string;
}

export interface KnowledgeSpaceRetentionCleanupWorker {
  enqueue(input: EnqueueKnowledgeSpaceRetentionCleanupInput): Promise<JobRecord>;
  process(payload: JobPayload): Promise<KnowledgeSpaceRetentionCleanupResult>;
}

export interface ParseArtifactRetentionCleanupWorkerOptions {
  readonly assets: {
    list(input: {
      readonly cursor?: { readonly id: string } | undefined;
      readonly knowledgeSpaceId: string;
      readonly limit: number;
    }): Promise<{
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: { readonly id: string } | undefined;
    }>;
  };
  readonly jobs: Pick<JobEnqueuer, "enqueue">;
  readonly maxArtifactsPerDocument: number;
  readonly maxDocuments: number;
  readonly now?: () => string;
  readonly parseArtifacts: {
    pruneDocumentVersions(input: {
      readonly documentAssetId: string;
      readonly keepVersions: number;
      readonly maxArtifacts: number;
    }): Promise<number>;
  };
  readonly retentionPolicies: RetentionPolicyRepository;
}

export interface EnqueueParseArtifactRetentionCleanupInput {
  readonly cursorId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ParseArtifactRetentionCleanupPayload {
  readonly [key: string]: JobPayload;
  readonly cursorId: string;
  readonly knowledgeSpaceId: string;
  readonly maxArtifactsPerDocument: number;
  readonly maxDocuments: number;
  readonly requestedAt: string;
  readonly tenantId: string;
}

export interface ParseArtifactRetentionCleanupResult {
  readonly artifactsDeleted: number;
  readonly documentsScanned: number;
  readonly keepVersions: number;
  readonly knowledgeSpaceId: string;
  readonly nextCursorId?: string | undefined;
  readonly tenantId: string;
}

export interface ParseArtifactRetentionCleanupWorker {
  enqueue(input: EnqueueParseArtifactRetentionCleanupInput): Promise<JobRecord>;
  process(payload: JobPayload): Promise<ParseArtifactRetentionCleanupResult>;
}

interface JobEnqueuer {
  enqueue(input: {
    readonly idempotencyKey?: string | undefined;
    readonly payload: Record<string, JobPayload>;
    readonly type: string;
  }): Promise<JobRecord>;
}

function retentionPolicyKey({ knowledgeSpaceId, tenantId }: RetentionPolicyScope): string {
  return knowledgeSpaceId ? `${tenantId}:space:${knowledgeSpaceId}` : `${tenantId}:tenant`;
}

function defaultRetentionPolicy(
  scope: RetentionPolicyScope,
  generateId: () => string,
  now: () => string,
): RetentionPolicy {
  const timestamp = now();

  return {
    answerTraceRetentionDays: 90,
    createdAt: timestamp,
    evidenceCacheRetentionDays: 7,
    id: generateId(),
    inactiveProjectionRetentionDays: 30,
    knowledgeSpaceId: scope.knowledgeSpaceId ?? null,
    parseArtifactVersions: 3,
    rawDocumentRetentionDays: null,
    scope: scope.knowledgeSpaceId ? "knowledge_space" : "tenant",
    sessionInactivityMinutes: 30,
    tenantId: scope.tenantId,
    updatedAt: timestamp,
  };
}

function validateRetentionPolicyPatch(patch: RetentionPolicyPatch): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && key === "rawDocumentRetentionDays") {
      continue;
    }

    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new Error(`Retention policy ${key} must be at least 1`);
    }
  }
}

function compactRetentionPolicyPatch(patch: RetentionPolicyPatch): RetentionPolicyPatch {
  const compacted: Record<string, number | null> = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      compacted[key] = value;
    }
  }

  return compacted;
}

function validateRetentionCleanupBound(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Retention cleanup ${label} must be at least 1`);
  }
}

function validateKnowledgeSpaceRetentionCleanupPayload(
  payload: JobPayload,
): KnowledgeSpaceRetentionCleanupPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Retention cleanup payload is invalid");
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.tenantId !== "string" || !candidate.tenantId.trim()) {
    throw new Error("Retention cleanup tenantId is required");
  }

  if (typeof candidate.knowledgeSpaceId !== "string" || !candidate.knowledgeSpaceId.trim()) {
    throw new Error("Retention cleanup knowledgeSpaceId is required");
  }

  if (
    typeof candidate.requestedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.requestedAt))
  ) {
    throw new Error("Retention cleanup requestedAt must be a valid timestamp");
  }

  const maxTraceDeletes = candidate.maxTraceDeletes;
  const maxProjectionDeletes = candidate.maxProjectionDeletes;
  const projectionRetainVersions = candidate.projectionRetainVersions;

  if (!Number.isInteger(maxTraceDeletes) || Number(maxTraceDeletes) < 1) {
    throw new Error("Retention cleanup maxTraceDeletes must be at least 1");
  }

  if (!Number.isInteger(maxProjectionDeletes) || Number(maxProjectionDeletes) < 1) {
    throw new Error("Retention cleanup maxProjectionDeletes must be at least 1");
  }

  if (!Number.isInteger(projectionRetainVersions) || Number(projectionRetainVersions) < 1) {
    throw new Error("Retention cleanup projectionRetainVersions must be at least 1");
  }

  return {
    knowledgeSpaceId: candidate.knowledgeSpaceId,
    maxProjectionDeletes: Number(maxProjectionDeletes),
    maxTraceDeletes: Number(maxTraceDeletes),
    projectionRetainVersions: Number(projectionRetainVersions),
    requestedAt: candidate.requestedAt,
    tenantId: candidate.tenantId,
  };
}

function subtractDaysIso(timestamp: string, days: number): string {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return new Date(Date.parse(timestamp) - days * millisecondsPerDay).toISOString();
}

function validateParseArtifactRetentionCleanupBound(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Parse artifact retention cleanup ${label} must be at least 1`);
  }
}

function validateParseArtifactRetentionCleanupPayload(
  payload: JobPayload,
): ParseArtifactRetentionCleanupPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Parse artifact retention cleanup payload is invalid");
  }

  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.tenantId !== "string" || !candidate.tenantId.trim()) {
    throw new Error("Parse artifact retention cleanup tenantId is required");
  }

  if (typeof candidate.knowledgeSpaceId !== "string" || !candidate.knowledgeSpaceId.trim()) {
    throw new Error("Parse artifact retention cleanup knowledgeSpaceId is required");
  }

  if (typeof candidate.cursorId !== "string") {
    throw new Error("Parse artifact retention cleanup cursorId must be a string");
  }

  if (
    typeof candidate.requestedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.requestedAt))
  ) {
    throw new Error("Parse artifact retention cleanup requestedAt must be a valid timestamp");
  }

  const maxDocuments = candidate.maxDocuments;
  const maxArtifactsPerDocument = candidate.maxArtifactsPerDocument;

  if (!Number.isInteger(maxDocuments) || Number(maxDocuments) < 1) {
    throw new Error("Parse artifact retention cleanup maxDocuments must be at least 1");
  }

  if (!Number.isInteger(maxArtifactsPerDocument) || Number(maxArtifactsPerDocument) < 1) {
    throw new Error("Parse artifact retention cleanup maxArtifactsPerDocument must be at least 1");
  }

  return {
    cursorId: candidate.cursorId,
    knowledgeSpaceId: candidate.knowledgeSpaceId,
    maxArtifactsPerDocument: Number(maxArtifactsPerDocument),
    maxDocuments: Number(maxDocuments),
    requestedAt: candidate.requestedAt,
    tenantId: candidate.tenantId,
  };
}

function cloneRetentionPolicy(policy: RetentionPolicy): RetentionPolicy {
  return { ...policy };
}

export function createInMemoryRetentionPolicyRepository({
  generateId = randomUUID,
  maxPolicies,
  now = () => new Date().toISOString(),
}: InMemoryRetentionPolicyRepositoryOptions): RetentionPolicyRepository {
  if (!Number.isInteger(maxPolicies) || maxPolicies < 1) {
    throw new Error("Retention policy repository maxPolicies must be at least 1");
  }

  const policies = new Map<string, RetentionPolicy>();

  return {
    get: async (scope) =>
      cloneRetentionPolicy(
        policies.get(retentionPolicyKey(scope)) ?? defaultRetentionPolicy(scope, generateId, now),
      ),
    update: async ({ patch, scope }) => {
      validateRetentionPolicyPatch(patch);
      const key = retentionPolicyKey(scope);
      const existing = policies.get(key) ?? defaultRetentionPolicy(scope, generateId, now);
      const normalizedPatch = compactRetentionPolicyPatch(patch);

      if (!policies.has(key) && policies.size >= maxPolicies) {
        throw new Error(`Retention policy repository maxPolicies=${maxPolicies} exceeded`);
      }

      const updated = cloneRetentionPolicy({
        ...existing,
        answerTraceRetentionDays:
          normalizedPatch.answerTraceRetentionDays ?? existing.answerTraceRetentionDays,
        evidenceCacheRetentionDays:
          normalizedPatch.evidenceCacheRetentionDays ?? existing.evidenceCacheRetentionDays,
        inactiveProjectionRetentionDays:
          normalizedPatch.inactiveProjectionRetentionDays ??
          existing.inactiveProjectionRetentionDays,
        parseArtifactVersions:
          normalizedPatch.parseArtifactVersions ?? existing.parseArtifactVersions,
        rawDocumentRetentionDays:
          normalizedPatch.rawDocumentRetentionDays === undefined
            ? existing.rawDocumentRetentionDays
            : normalizedPatch.rawDocumentRetentionDays,
        sessionInactivityMinutes:
          normalizedPatch.sessionInactivityMinutes ?? existing.sessionInactivityMinutes,
        updatedAt: now(),
      });
      policies.set(key, updated);

      return cloneRetentionPolicy(updated);
    },
  };
}

export function createKnowledgeSpaceRetentionCleanupWorker({
  answerTraces,
  indexProjections,
  jobs,
  maxProjectionDeletes,
  maxTraceDeletes,
  now = () => new Date().toISOString(),
  projectionRetainVersions = 1,
  retentionPolicies,
}: KnowledgeSpaceRetentionCleanupWorkerOptions): KnowledgeSpaceRetentionCleanupWorker {
  validateRetentionCleanupBound(maxTraceDeletes, "maxTraceDeletes");
  validateRetentionCleanupBound(maxProjectionDeletes, "maxProjectionDeletes");
  validateRetentionCleanupBound(projectionRetainVersions, "projectionRetainVersions");

  return {
    enqueue: async (input) => {
      const payload = validateKnowledgeSpaceRetentionCleanupPayload({
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxProjectionDeletes,
        maxTraceDeletes,
        projectionRetainVersions,
        requestedAt: now(),
        tenantId: input.tenantId,
      });

      return jobs.enqueue({
        idempotencyKey: `retention.cleanup.knowledge-space:${payload.tenantId}:${payload.knowledgeSpaceId}`,
        payload,
        type: "retention.cleanup.knowledge-space",
      });
    },
    process: async (payload) => {
      const cleanup = validateKnowledgeSpaceRetentionCleanupPayload(payload);

      if (cleanup.maxTraceDeletes > maxTraceDeletes) {
        throw new Error(
          `Retention cleanup maxTraceDeletes exceeds maxTraceDeletes=${maxTraceDeletes}`,
        );
      }

      if (cleanup.maxProjectionDeletes > maxProjectionDeletes) {
        throw new Error(
          `Retention cleanup maxProjectionDeletes exceeds maxProjectionDeletes=${maxProjectionDeletes}`,
        );
      }

      if (cleanup.projectionRetainVersions > projectionRetainVersions) {
        throw new Error(
          `Retention cleanup projectionRetainVersions exceeds projectionRetainVersions=${projectionRetainVersions}`,
        );
      }

      const policy = await retentionPolicies.get({
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        tenantId: cleanup.tenantId,
      });
      const answerTraceOlderThan = subtractDaysIso(
        cleanup.requestedAt,
        policy.answerTraceRetentionDays,
      );
      const answerTracesDeleted = await answerTraces.deleteOlderThan({
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        maxTraces: cleanup.maxTraceDeletes,
        olderThan: answerTraceOlderThan,
      });
      const denseVectorProjectionsDeleted = await indexProjections.pruneInactiveVersions({
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        maxProjections: cleanup.maxProjectionDeletes,
        retainVersions: cleanup.projectionRetainVersions,
        type: "dense-vector",
      });
      const ftsProjectionsDeleted = await indexProjections.pruneInactiveVersions({
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        maxProjections: cleanup.maxProjectionDeletes,
        retainVersions: cleanup.projectionRetainVersions,
        type: "fts",
      });

      return {
        answerTraceOlderThan,
        answerTracesDeleted,
        denseVectorProjectionsDeleted,
        ftsProjectionsDeleted,
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        sessionTtlMinutes: policy.sessionInactivityMinutes,
        tenantId: cleanup.tenantId,
      };
    },
  };
}

export function createParseArtifactRetentionCleanupWorker({
  assets,
  jobs,
  maxArtifactsPerDocument,
  maxDocuments,
  now = () => new Date().toISOString(),
  parseArtifacts,
  retentionPolicies,
}: ParseArtifactRetentionCleanupWorkerOptions): ParseArtifactRetentionCleanupWorker {
  validateParseArtifactRetentionCleanupBound(maxDocuments, "maxDocuments");
  validateParseArtifactRetentionCleanupBound(maxArtifactsPerDocument, "maxArtifactsPerDocument");

  return {
    enqueue: async (input) => {
      const payload = validateParseArtifactRetentionCleanupPayload({
        cursorId: input.cursorId ?? "",
        knowledgeSpaceId: input.knowledgeSpaceId,
        maxArtifactsPerDocument,
        maxDocuments,
        requestedAt: now(),
        tenantId: input.tenantId,
      });

      return jobs.enqueue({
        idempotencyKey: `retention.cleanup.parse-artifacts:${payload.tenantId}:${payload.knowledgeSpaceId}:${payload.cursorId}`,
        payload,
        type: "retention.cleanup.parse-artifacts",
      });
    },
    process: async (payload) => {
      const cleanup = validateParseArtifactRetentionCleanupPayload(payload);

      if (cleanup.maxDocuments > maxDocuments) {
        throw new Error(
          `Parse artifact retention cleanup maxDocuments exceeds maxDocuments=${maxDocuments}`,
        );
      }

      if (cleanup.maxArtifactsPerDocument > maxArtifactsPerDocument) {
        throw new Error(
          `Parse artifact retention cleanup maxArtifactsPerDocument exceeds maxArtifactsPerDocument=${maxArtifactsPerDocument}`,
        );
      }

      const policy = await retentionPolicies.get({
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        tenantId: cleanup.tenantId,
      });
      const page = await assets.list({
        ...(cleanup.cursorId ? { cursor: { id: cleanup.cursorId } } : {}),
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        limit: cleanup.maxDocuments,
      });
      const deletedByDocument = await Promise.all(
        page.items.map((asset) =>
          parseArtifacts.pruneDocumentVersions({
            documentAssetId: asset.id,
            keepVersions: policy.parseArtifactVersions,
            maxArtifacts: cleanup.maxArtifactsPerDocument,
          }),
        ),
      );
      const artifactsDeleted = deletedByDocument.reduce((sum, deleted) => sum + deleted, 0);

      return {
        artifactsDeleted,
        documentsScanned: page.items.length,
        keepVersions: policy.parseArtifactVersions,
        knowledgeSpaceId: cleanup.knowledgeSpaceId,
        ...(page.nextCursor ? { nextCursorId: page.nextCursor.id } : {}),
        tenantId: cleanup.tenantId,
      };
    },
  };
}
