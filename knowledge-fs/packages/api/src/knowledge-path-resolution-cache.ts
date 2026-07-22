import { createHash } from "node:crypto";
import {
  type CacheAdapter,
  type CommandName,
  CommandNameSchema,
  type KnowledgePath,
} from "@knowledge/core";
import { KnowledgePathSchema } from "@knowledge/core";

import { normalizeKnowledgeFsPath } from "./knowledge-fs-path-utils";
import { cloneKnowledgePath } from "./knowledge-path-repository";
import {
  cacheNamespaceSegment,
  knowledgeSpaceCacheNamespace,
} from "./knowledge-space-cache-namespace";

export interface KnowledgePathResolutionCacheOptions {
  readonly cache: CacheAdapter;
  readonly cacheVersion?: string | undefined;
  readonly maxPathBytes?: number | undefined;
  readonly ttlMs?: number | undefined;
}

export interface KnowledgePathResolutionCacheInput {
  readonly commandName: CommandName;
  readonly knowledgeSpaceId: string;
  readonly manifestVersion: number;
  readonly mountVersion: string;
  readonly pathIndexVersion: string;
  readonly permissionSnapshot: readonly string[];
  readonly targetVersion?: string | undefined;
  readonly tenantId: string;
  readonly virtualPath: string;
}

export interface KnowledgePathResolutionCache {
  get(input: KnowledgePathResolutionCacheInput): Promise<KnowledgePath | null>;
  set(input: KnowledgePathResolutionCacheInput, path: KnowledgePath): Promise<void>;
}

export function createKnowledgePathResolutionCache({
  cache,
  cacheVersion = "knowledge-path-cache-v1",
  maxPathBytes = 1024,
  ttlMs = 5 * 60 * 1000,
}: KnowledgePathResolutionCacheOptions): KnowledgePathResolutionCache {
  if (!cacheVersion.trim()) {
    throw new Error("Knowledge path cache cacheVersion is required");
  }

  if (!Number.isSafeInteger(maxPathBytes) || maxPathBytes < 1) {
    throw new Error("Knowledge path cache maxPathBytes must be at least 1");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("Knowledge path cache ttlMs must be at least 1");
  }

  return {
    async get(input) {
      const key = knowledgePathResolutionCacheKey(validateKnowledgePathCacheInput(input), {
        cacheVersion,
        maxPathBytes,
      });
      const cached = await cache.get(key);

      if (!cached) {
        return null;
      }

      try {
        return cloneKnowledgePath(
          KnowledgePathSchema.parse(JSON.parse(new TextDecoder().decode(cached))),
        );
      } catch {
        return null;
      }
    },
    async set(input, path) {
      const key = knowledgePathResolutionCacheKey(validateKnowledgePathCacheInput(input), {
        cacheVersion,
        maxPathBytes,
      });
      await cache.set(key, new TextEncoder().encode(JSON.stringify(cloneKnowledgePath(path))), {
        ttlMs,
      });
    },
  };
}

function validateKnowledgePathCacheInput(
  input: KnowledgePathResolutionCacheInput,
): KnowledgePathResolutionCacheInput {
  const commandName = CommandNameSchema.parse(input.commandName);
  const knowledgeSpaceId = input.knowledgeSpaceId.trim();
  const mountVersion = input.mountVersion.trim();
  const pathIndexVersion = input.pathIndexVersion.trim();
  const targetVersion = input.targetVersion?.trim();
  const tenantId = input.tenantId.trim();
  const virtualPath = normalizeKnowledgeFsPath(input.virtualPath);

  if (!tenantId) {
    throw new Error("Knowledge path cache tenantId is required");
  }

  if (!knowledgeSpaceId) {
    throw new Error("Knowledge path cache knowledgeSpaceId is required");
  }

  if (!Number.isSafeInteger(input.manifestVersion) || input.manifestVersion < 1) {
    throw new Error("Knowledge path cache manifestVersion must be at least 1");
  }

  if (!mountVersion) {
    throw new Error("Knowledge path cache mountVersion is required");
  }

  if (!pathIndexVersion) {
    throw new Error("Knowledge path cache pathIndexVersion is required");
  }

  if (targetVersion !== undefined && !targetVersion) {
    throw new Error("Knowledge path cache targetVersion must not be empty");
  }

  return {
    commandName,
    knowledgeSpaceId,
    manifestVersion: input.manifestVersion,
    mountVersion,
    pathIndexVersion,
    permissionSnapshot: uniqueStrings(input.permissionSnapshot.map((scope) => scope.trim())).sort(),
    ...(targetVersion === undefined ? {} : { targetVersion }),
    tenantId,
    virtualPath,
  };
}

function knowledgePathResolutionCacheKey(
  input: KnowledgePathResolutionCacheInput,
  options: {
    readonly cacheVersion: string;
    readonly maxPathBytes: number;
  },
): string {
  if (new TextEncoder().encode(input.virtualPath).byteLength > options.maxPathBytes) {
    throw new Error(
      `Knowledge path cache virtualPath exceeds maxPathBytes=${options.maxPathBytes}`,
    );
  }

  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        cacheVersion: options.cacheVersion,
        commandName: input.commandName,
        knowledgeSpaceId: input.knowledgeSpaceId,
        manifestVersion: input.manifestVersion,
        mountVersion: input.mountVersion,
        pathIndexVersion: input.pathIndexVersion,
        permissionSnapshot: input.permissionSnapshot,
        targetVersion: input.targetVersion ?? null,
        tenantId: input.tenantId,
        virtualPath: input.virtualPath,
      }),
    )
    .digest("hex");

  const namespace = knowledgeSpaceCacheNamespace({
    kind: "knowledge-path",
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: input.tenantId,
  });
  return `${namespace}version:${cacheNamespaceSegment(
    options.cacheVersion,
    "cacheVersion",
  )}:${digest}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
