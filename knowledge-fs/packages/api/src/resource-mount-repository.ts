import { type ResourceMount, ResourceMountSchema } from "@knowledge/core";

import { normalizeSourceFsPath, sourcePathIsWithinMount } from "./storage-path-utils";

export interface ResourceMountLookupInput {
  readonly knowledgeSpaceId: string;
  readonly path: string;
  readonly tenantId: string;
}

export interface ResourceMountRepository {
  create(input: ResourceMount): Promise<ResourceMount>;
  findByPath(input: ResourceMountLookupInput): Promise<ResourceMount | null>;
}

export interface InMemoryResourceMountRepositoryOptions {
  readonly maxMounts: number;
}

export interface ResourceMountPathCachePolicy {
  readonly enabled: boolean;
  readonly maxBytes?: number | undefined;
  readonly strategy: ResourceMount["cachePolicy"]["strategy"];
  readonly ttlMs?: number | undefined;
}

export class ResourceMountCapacityExceededError extends Error {
  constructor(maxMounts: number) {
    super(`Resource mount repository maxMounts=${maxMounts} exceeded`);
  }
}

export function createInMemoryResourceMountRepository({
  maxMounts,
}: InMemoryResourceMountRepositoryOptions): ResourceMountRepository {
  if (!Number.isInteger(maxMounts) || maxMounts < 1) {
    throw new Error("Resource mount repository maxMounts must be at least 1");
  }

  const mounts = new Map<string, ResourceMount>();

  return {
    create: async (input) => {
      const mount = cloneResourceMount(ResourceMountSchema.parse(input));
      const key = resourceMountKey(mount.tenantId, mount.knowledgeSpaceId, mount.mountPath);

      if (!mounts.has(key) && mounts.size >= maxMounts) {
        throw new ResourceMountCapacityExceededError(maxMounts);
      }

      mounts.set(key, cloneResourceMount(mount));

      return cloneResourceMount(mount);
    },
    findByPath: async ({ knowledgeSpaceId, path, tenantId }) => {
      const normalizedPath = normalizeSourceFsPath(path);
      const matchingMount = Array.from(mounts.values())
        .filter((mount) => mount.tenantId === tenantId)
        .filter((mount) => mount.knowledgeSpaceId === knowledgeSpaceId)
        .filter((mount) => mount.resourceType === "source")
        .filter((mount) => sourcePathIsWithinMount(normalizedPath, mount.mountPath))
        .sort((left, right) => right.mountPath.length - left.mountPath.length)
        .at(0);

      return matchingMount ? cloneResourceMount(matchingMount) : null;
    },
  };
}

export function resourceMountPathCachePolicy(mount: ResourceMount): ResourceMountPathCachePolicy {
  const policy = ResourceMountSchema.parse(mount).cachePolicy;

  if (policy.strategy === "none") {
    return {
      enabled: false,
      strategy: "none",
    };
  }

  return {
    enabled: true,
    ...(policy.maxBytes === undefined ? {} : { maxBytes: policy.maxBytes }),
    strategy: policy.strategy,
    ...(policy.ttlSeconds === undefined ? {} : { ttlMs: policy.ttlSeconds * 1000 }),
  };
}

function resourceMountKey(tenantId: string, knowledgeSpaceId: string, mountPath: string): string {
  return `${tenantId}:${knowledgeSpaceId}:${normalizeSourceFsPath(mountPath)}`;
}

function cloneResourceMount(mount: ResourceMount): ResourceMount {
  return ResourceMountSchema.parse(JSON.parse(JSON.stringify(mount)) as unknown);
}
