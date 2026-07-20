import { createHash, randomUUID } from "node:crypto";

import type { CacheAdapter } from "@knowledge/core";

import {
  cacheNamespaceSegment,
  knowledgeSpaceCacheNamespace,
} from "./knowledge-space-cache-namespace";

export interface SessionPreviousQuery {
  readonly askedAt: string;
  readonly query: string;
  readonly traceId: string;
}

export interface QuerySessionContext {
  readonly activeDocumentIds: readonly string[];
  readonly activeEntityIds: readonly string[];
  readonly expiresAt: string;
  readonly permissionInvalidated: boolean;
  readonly permissionSnapshot: readonly string[];
  readonly previousQueries: readonly SessionPreviousQuery[];
  readonly sessionId: string;
  readonly updatedAt: string;
}

export interface SessionContext extends Omit<QuerySessionContext, "permissionInvalidated"> {
  readonly createdAt: string;
  readonly knowledgeSpaceId: string;
  readonly subjectId: string;
  readonly tenantId: string;
}

export interface RecordSessionQueryInput {
  readonly activeDocumentIds?: readonly string[] | undefined;
  readonly activeEntityIds?: readonly string[] | undefined;
  readonly knowledgeSpaceId: string;
  /** Durable retrieval fence; cache writes are compensated if it is lost after set(). */
  readonly retrievalExecution?: { assertActive(): Promise<void> } | undefined;
  readonly permissionSnapshot: readonly string[];
  readonly query: string;
  readonly sessionId?: string | undefined;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly traceId: string;
}

export interface RecordSessionQueryResult {
  readonly context: QuerySessionContext;
  readonly stored: SessionContext;
}

export interface SessionContextRepository {
  delete(input: {
    readonly knowledgeSpaceId: string;
    readonly sessionId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<void>;
  get(input: {
    readonly knowledgeSpaceId: string;
    readonly sessionId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<SessionContext | null>;
  recordQuery(input: RecordSessionQueryInput): Promise<RecordSessionQueryResult>;
}

export interface CacheSessionContextRepositoryOptions {
  readonly cache: CacheAdapter;
  readonly cacheVersion?: string | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly maxActiveDocumentIds?: number | undefined;
  readonly maxActiveEntityIds?: number | undefined;
  readonly maxEntryBytes?: number | undefined;
  readonly maxPreviousQueries?: number | undefined;
  readonly maxQueryBytes?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly ttlMs?: number | undefined;
}

export function createCacheSessionContextRepository({
  cache,
  cacheVersion = "session-context-v1",
  generateId = randomUUID,
  maxActiveDocumentIds = 100,
  maxActiveEntityIds = 100,
  maxEntryBytes = 64 * 1024,
  maxPreviousQueries = 20,
  maxQueryBytes = 16 * 1024,
  now = Date.now,
  ttlMs = 30 * 60 * 1000,
}: CacheSessionContextRepositoryOptions): SessionContextRepository {
  validateSessionContextRepositoryOptions({
    cacheVersion,
    maxActiveDocumentIds,
    maxActiveEntityIds,
    maxEntryBytes,
    maxPreviousQueries,
    maxQueryBytes,
    ttlMs,
  });

  return {
    async delete(input) {
      const keyInput = normalizeSessionContextKeyInput(input);
      await cache.delete(sessionContextCacheKey(keyInput, cacheVersion));
    },
    async get(input) {
      const keyInput = normalizeSessionContextKeyInput(input);
      const cached = await cache.get(sessionContextCacheKey(keyInput, cacheVersion), {
        now: now(),
      });

      if (!cached || cached.byteLength > maxEntryBytes) {
        return null;
      }

      const context = decodeSessionContext(cached);

      if (!context || Date.parse(context.expiresAt) <= now()) {
        return null;
      }

      return cloneSessionContext(context);
    },
    async recordQuery(input) {
      await input.retrievalExecution?.assertActive();
      const query = input.query.trim();

      if (!query) {
        throw new Error("Session context query is required");
      }

      if (new TextEncoder().encode(query).byteLength > maxQueryBytes) {
        throw new Error(`Session context query exceeds maxQueryBytes=${maxQueryBytes}`);
      }

      const sessionId = input.sessionId?.trim() || generateId();
      const keyInput = normalizeSessionContextKeyInput({
        knowledgeSpaceId: input.knowledgeSpaceId,
        sessionId,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
      });
      const key = sessionContextCacheKey(keyInput, cacheVersion);
      const cached = await cache.get(key, { now: now() });
      const current =
        cached && cached.byteLength <= maxEntryBytes ? decodeSessionContext(cached) : null;
      const timestamp = new Date(now()).toISOString();
      const expiresAt = new Date(now() + ttlMs).toISOString();
      const permissionSnapshot = normalizeSessionPermissionSnapshot(input.permissionSnapshot);
      const currentIsLive = current ? Date.parse(current.expiresAt) > now() : false;
      const permissionInvalidated =
        !!currentIsLive &&
        !!current &&
        !stringArraysEqual(current.permissionSnapshot, permissionSnapshot);
      const previousQueries =
        currentIsLive && current && !permissionInvalidated ? current.previousQueries : [];
      const activeDocumentIds =
        currentIsLive && current && !permissionInvalidated
          ? boundedUniqueStrings(
              [...current.activeDocumentIds, ...(input.activeDocumentIds ?? [])],
              maxActiveDocumentIds,
            )
          : boundedUniqueStrings(input.activeDocumentIds ?? [], maxActiveDocumentIds);
      const activeEntityIds =
        currentIsLive && current && !permissionInvalidated
          ? boundedUniqueStrings(
              [...current.activeEntityIds, ...(input.activeEntityIds ?? [])],
              maxActiveEntityIds,
            )
          : boundedUniqueStrings(input.activeEntityIds ?? [], maxActiveEntityIds);
      const contextForQuery: QuerySessionContext = {
        activeDocumentIds,
        activeEntityIds,
        expiresAt,
        permissionInvalidated,
        permissionSnapshot,
        previousQueries: previousQueries.map(cloneSessionPreviousQuery),
        sessionId,
        updatedAt: timestamp,
      };
      const stored: SessionContext = {
        activeDocumentIds: contextForQuery.activeDocumentIds,
        activeEntityIds: contextForQuery.activeEntityIds,
        createdAt:
          currentIsLive && current && !permissionInvalidated ? current.createdAt : timestamp,
        expiresAt: contextForQuery.expiresAt,
        knowledgeSpaceId: keyInput.knowledgeSpaceId,
        permissionSnapshot: contextForQuery.permissionSnapshot,
        previousQueries: [
          ...previousQueries,
          {
            askedAt: timestamp,
            query,
            traceId: input.traceId,
          },
        ]
          .slice(-maxPreviousQueries)
          .map(cloneSessionPreviousQuery),
        subjectId: keyInput.subjectId,
        sessionId,
        tenantId: keyInput.tenantId,
        updatedAt: contextForQuery.updatedAt,
      };
      const encoded = new TextEncoder().encode(JSON.stringify(cloneSessionContext(stored)));

      if (encoded.byteLength > maxEntryBytes) {
        throw new Error(`Session context entry exceeds maxEntryBytes=${maxEntryBytes}`);
      }

      await cache.set(key, encoded, { ttlMs });
      try {
        await input.retrievalExecution?.assertActive();
      } catch (error) {
        await cache.delete(key).catch(() => undefined);
        throw error;
      }

      return {
        context: cloneQuerySessionContext(contextForQuery),
        stored: cloneSessionContext(stored),
      };
    },
  };
}

function validateSessionContextRepositoryOptions({
  cacheVersion,
  maxActiveDocumentIds,
  maxActiveEntityIds,
  maxEntryBytes,
  maxPreviousQueries,
  maxQueryBytes,
  ttlMs,
}: {
  readonly cacheVersion: string;
  readonly maxActiveDocumentIds: number;
  readonly maxActiveEntityIds: number;
  readonly maxEntryBytes: number;
  readonly maxPreviousQueries: number;
  readonly maxQueryBytes: number;
  readonly ttlMs: number;
}): void {
  if (!cacheVersion.trim()) {
    throw new Error("Session context cacheVersion is required");
  }

  if (!Number.isSafeInteger(maxPreviousQueries) || maxPreviousQueries < 1) {
    throw new Error("Session context maxPreviousQueries must be at least 1");
  }

  if (!Number.isSafeInteger(maxActiveDocumentIds) || maxActiveDocumentIds < 1) {
    throw new Error("Session context maxActiveDocumentIds must be at least 1");
  }

  if (!Number.isSafeInteger(maxActiveEntityIds) || maxActiveEntityIds < 1) {
    throw new Error("Session context maxActiveEntityIds must be at least 1");
  }

  if (!Number.isSafeInteger(maxEntryBytes) || maxEntryBytes < 1) {
    throw new Error("Session context maxEntryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(maxQueryBytes) || maxQueryBytes < 1) {
    throw new Error("Session context maxQueryBytes must be at least 1");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Session context ttlMs must be at least 1");
  }
}

function normalizeSessionContextKeyInput(input: {
  readonly knowledgeSpaceId: string;
  readonly sessionId: string;
  readonly subjectId: string;
  readonly tenantId: string;
}): {
  readonly knowledgeSpaceId: string;
  readonly sessionId: string;
  readonly subjectId: string;
  readonly tenantId: string;
} {
  const knowledgeSpaceId = input.knowledgeSpaceId.trim();
  const sessionId = input.sessionId.trim();
  const subjectId = input.subjectId.trim();
  const tenantId = input.tenantId.trim();

  if (!knowledgeSpaceId) {
    throw new Error("Session context knowledgeSpaceId is required");
  }

  if (!sessionId) {
    throw new Error("Session context sessionId is required");
  }

  if (!subjectId) {
    throw new Error("Session context subjectId is required");
  }

  if (!tenantId) {
    throw new Error("Session context tenantId is required");
  }

  return {
    knowledgeSpaceId,
    sessionId,
    subjectId,
    tenantId,
  };
}

function sessionContextCacheKey(
  input: {
    readonly knowledgeSpaceId: string;
    readonly sessionId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  },
  cacheVersion: string,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        cacheVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        sessionId: input.sessionId,
        subjectId: input.subjectId,
        tenantId: input.tenantId,
      }),
    )
    .digest("hex");

  const namespace = knowledgeSpaceCacheNamespace({
    kind: "session-context",
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: input.tenantId,
  });
  return `${namespace}version:${cacheNamespaceSegment(cacheVersion, "cacheVersion")}:${digest}`;
}

function decodeSessionContext(bytes: Uint8Array): SessionContext | null {
  try {
    return cloneSessionContext(JSON.parse(new TextDecoder().decode(bytes)) as SessionContext);
  } catch {
    return null;
  }
}

function cloneQuerySessionContext(context: QuerySessionContext): QuerySessionContext {
  return {
    activeDocumentIds: [...context.activeDocumentIds],
    activeEntityIds: [...context.activeEntityIds],
    expiresAt: context.expiresAt,
    permissionInvalidated: context.permissionInvalidated,
    permissionSnapshot: [...context.permissionSnapshot],
    previousQueries: context.previousQueries.map(cloneSessionPreviousQuery),
    sessionId: context.sessionId,
    updatedAt: context.updatedAt,
  };
}

function cloneSessionContext(context: SessionContext): SessionContext {
  return {
    activeDocumentIds: [...context.activeDocumentIds],
    activeEntityIds: [...context.activeEntityIds],
    createdAt: context.createdAt,
    expiresAt: context.expiresAt,
    knowledgeSpaceId: context.knowledgeSpaceId,
    permissionSnapshot: [...context.permissionSnapshot],
    previousQueries: context.previousQueries.map(cloneSessionPreviousQuery),
    sessionId: context.sessionId,
    subjectId: context.subjectId,
    tenantId: context.tenantId,
    updatedAt: context.updatedAt,
  };
}

function cloneSessionPreviousQuery(query: SessionPreviousQuery): SessionPreviousQuery {
  return {
    askedAt: query.askedAt,
    query: query.query,
    traceId: query.traceId,
  };
}

function normalizeSessionPermissionSnapshot(scopes: readonly string[]): string[] {
  return uniqueStrings(scopes.map((scope) => scope.trim()).filter(Boolean)).sort();
}

function boundedUniqueStrings(values: readonly string[], maxItems: number): string[] {
  return uniqueStrings(values.map((value) => value.trim()).filter(Boolean)).slice(-maxItems);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
