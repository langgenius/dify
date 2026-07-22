export interface StorageQuotaPolicy {
  readonly maxRawDocumentBytes: number | null;
}

export interface StorageQuotaRepository {
  get(input: StorageQuotaScope): Promise<StorageQuotaPolicy>;
}

export interface StorageQuotaScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface StaticStorageQuotaRepositoryOptions {
  readonly maxRawDocumentBytes: number | null;
}

export interface StorageUsageReader {
  getStorageUsage(input: { readonly knowledgeSpaceId: string }): Promise<{
    readonly rawDocumentBytes: number;
  }>;
}

export class StorageQuotaExceededError extends Error {
  constructor() {
    super("Storage quota exceeded");
  }
}

export class StorageQuotaPolicyUnavailableError extends Error {
  constructor() {
    super("Storage quota policy is unavailable for the knowledge space");
    this.name = "StorageQuotaPolicyUnavailableError";
  }
}

export function createKnowledgeSpaceManifestStorageQuotaRepository({
  manifests,
}: {
  readonly manifests: {
    get(input: StorageQuotaScope): Promise<Pick<KnowledgeSpaceManifest, "quotaPolicy"> | null>;
  };
}): StorageQuotaRepository {
  return {
    get: async (scope) => {
      const manifest = await manifests.get(scope);
      if (!manifest) throw new StorageQuotaPolicyUnavailableError();
      return { maxRawDocumentBytes: manifest.quotaPolicy.maxRawDocumentBytes };
    },
  };
}

export function createStaticStorageQuotaRepository({
  maxRawDocumentBytes,
}: StaticStorageQuotaRepositoryOptions): StorageQuotaRepository {
  if (
    maxRawDocumentBytes !== null &&
    (!Number.isSafeInteger(maxRawDocumentBytes) || maxRawDocumentBytes < 1)
  ) {
    throw new Error("Storage quota maxRawDocumentBytes must be null or at least 1");
  }

  return {
    get: async () => ({ maxRawDocumentBytes }),
  };
}

export async function enforceStorageQuota({
  assets,
  incomingBytes,
  knowledgeSpaceId,
  quotas,
  tenantId,
}: {
  readonly assets: StorageUsageReader;
  readonly incomingBytes: number;
  readonly knowledgeSpaceId: string;
  readonly quotas: StorageQuotaRepository;
  readonly tenantId: string;
}): Promise<void> {
  const quota = await quotas.get({ knowledgeSpaceId, tenantId });

  if (quota.maxRawDocumentBytes === null) {
    return;
  }

  const usage = await assets.getStorageUsage({ knowledgeSpaceId });

  if (usage.rawDocumentBytes > quota.maxRawDocumentBytes - incomingBytes) {
    throw new StorageQuotaExceededError();
  }
}
import type { KnowledgeSpaceManifest } from "@knowledge/core";
