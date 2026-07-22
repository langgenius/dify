import {
  type KnowledgeGatewayOptions,
  type SourceSecretStore,
  createEncryptedObjectSourceSecretStore,
  parseSourceSecretEncryptionKey,
} from "@knowledge/api";

export interface SourceSecretEnv {
  readonly KNOWLEDGE_SOURCE_SECRET_KEY?: string | undefined;
  readonly KNOWLEDGE_SOURCE_SECRET_MAX_BYTES?: string | undefined;
  readonly KNOWLEDGE_SOURCE_SECRET_PREFIX?: string | undefined;
}

export interface ApiSourceSecretDurabilityInput {
  readonly objectStorageKind: KnowledgeGatewayOptions["adapter"]["objectStorage"]["kind"];
  readonly production: boolean;
  readonly secretStoreConfigured: boolean;
  readonly usesDatabaseLifecycleLedger: boolean;
}

/**
 * Source credentials must survive process loss as one durable unit: both their encrypted payloads
 * and the lifecycle ledger that eventually removes retired payloads. Local development may use
 * process-local adapters, but production must fail startup instead of silently accepting them.
 */
export function assertApiSourceSecretDurability({
  objectStorageKind,
  production,
  secretStoreConfigured,
  usesDatabaseLifecycleLedger,
}: ApiSourceSecretDurabilityInput): void {
  if (!production || !secretStoreConfigured) {
    return;
  }
  if (objectStorageKind === "memory") {
    throw new Error(
      "Production Source SecretStore requires durable object storage; memory storage is not allowed",
    );
  }
  if (!usesDatabaseLifecycleLedger) {
    throw new Error(
      "Production Source SecretStore requires a database-backed source secret lifecycle ledger",
    );
  }
}

/**
 * Secret storage is opt-in by key. When absent, credential-bearing source writes fail closed at the
 * gateway while ordinary credential-free sources continue to work.
 */
export function createApiSourceSecretStore(
  storage: KnowledgeGatewayOptions["adapter"]["objectStorage"],
  env: SourceSecretEnv = process.env,
): SourceSecretStore | undefined {
  const rawKey = env.KNOWLEDGE_SOURCE_SECRET_KEY?.trim();
  if (!rawKey) {
    return undefined;
  }
  return createEncryptedObjectSourceSecretStore({
    encryptionKey: parseSourceSecretEncryptionKey(rawKey),
    maxSecretBytes: positiveInteger(
      env.KNOWLEDGE_SOURCE_SECRET_MAX_BYTES,
      64 * 1024,
      "KNOWLEDGE_SOURCE_SECRET_MAX_BYTES",
    ),
    objectKeyPrefix: env.KNOWLEDGE_SOURCE_SECRET_PREFIX?.trim() || "__knowledge-secrets/source/v1/",
    storage,
  });
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}
