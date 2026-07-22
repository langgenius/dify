export const DeletionLifecycleTargetTypes = ["space", "source", "document"] as const;
export type DeletionLifecycleTargetType = (typeof DeletionLifecycleTargetTypes)[number];

export interface DeletionLifecycleFenceScope {
  readonly documentAssetId?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly sourceId?: string | undefined;
  readonly tenantId: string;
}

export interface ActiveDeletionLifecycleFence {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly targetId: string;
  readonly targetType: DeletionLifecycleTargetType;
  readonly tenantId: string;
}

/**
 * Minimal read port intentionally decoupled from the durable deletion schema. Implementations must
 * resolve the complete hierarchy: a space tombstone always wins, followed by the requested source
 * and document tombstones.
 */
export interface DeletionLifecycleFenceReader {
  getActiveFence(scope: DeletionLifecycleFenceScope): Promise<ActiveDeletionLifecycleFence | null>;
}

declare const deletionLifecycleFenceTokenBrand: unique symbol;

export interface DeletionLifecycleFenceToken {
  readonly [deletionLifecycleFenceTokenBrand]: true;
  readonly scope: DeletionLifecycleFenceScope;
}

export interface DeletionLifecycleFenceGuard {
  assertDeletionFenceUnchanged(token: DeletionLifecycleFenceToken): Promise<void>;
  captureDeletionFence(scope: DeletionLifecycleFenceScope): Promise<DeletionLifecycleFenceToken>;
}

export class DeletionLifecycleFenceActiveError extends Error {
  readonly fence: ActiveDeletionLifecycleFence;

  constructor(fence: ActiveDeletionLifecycleFence) {
    super(`Deletion lifecycle fence is active for ${fence.targetType} target=${fence.targetId}`);
    this.name = "DeletionLifecycleFenceActiveError";
    this.fence = cloneActiveFence(fence);
  }
}

export function createDeletionLifecycleFenceGuard(
  reader: DeletionLifecycleFenceReader,
): DeletionLifecycleFenceGuard {
  return {
    assertDeletionFenceUnchanged: (token) => assertDeletionFenceUnchanged(reader, token),
    captureDeletionFence: (scope) => captureDeletionFence(reader, scope),
  };
}

export async function captureDeletionFence(
  reader: DeletionLifecycleFenceReader,
  rawScope: DeletionLifecycleFenceScope,
): Promise<DeletionLifecycleFenceToken> {
  const scope = normalizeScope(rawScope);
  const active = await reader.getActiveFence(scope);
  if (active) {
    throw new DeletionLifecycleFenceActiveError(normalizeActiveFence(active));
  }
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
  }) as DeletionLifecycleFenceToken;
}

export async function assertDeletionFenceUnchanged(
  reader: DeletionLifecycleFenceReader,
  token: DeletionLifecycleFenceToken,
): Promise<void> {
  const scope = normalizeScope(token.scope);
  const active = await reader.getActiveFence(scope);
  if (active) {
    throw new DeletionLifecycleFenceActiveError(normalizeActiveFence(active));
  }
}

export interface InMemoryDeletionLifecycleFenceReader extends DeletionLifecycleFenceReader {
  activateFence(fence: ActiveDeletionLifecycleFence): Promise<void>;
}

export function createInMemoryDeletionLifecycleFenceReader(
  initialFences: readonly ActiveDeletionLifecycleFence[] = [],
): InMemoryDeletionLifecycleFenceReader {
  const fences = new Map<string, ActiveDeletionLifecycleFence>();

  const activateFence = async (rawFence: ActiveDeletionLifecycleFence): Promise<void> => {
    const fence = normalizeActiveFence(rawFence);
    fences.set(fenceKey(fence), cloneActiveFence(fence));
  };
  for (const fence of initialFences) {
    const normalized = normalizeActiveFence(fence);
    fences.set(fenceKey(normalized), cloneActiveFence(normalized));
  }

  return {
    activateFence,
    async getActiveFence(rawScope) {
      const scope = normalizeScope(rawScope);
      for (const target of scopeTargets(scope)) {
        const fence = fences.get(
          fenceKey({
            knowledgeSpaceId: scope.knowledgeSpaceId,
            targetId: target.targetId,
            targetType: target.targetType,
            tenantId: scope.tenantId,
          }),
        );
        if (fence) {
          return cloneActiveFence(fence);
        }
      }
      return null;
    },
  };
}

function scopeTargets(
  scope: DeletionLifecycleFenceScope,
): readonly Pick<ActiveDeletionLifecycleFence, "targetId" | "targetType">[] {
  return [
    { targetId: scope.knowledgeSpaceId, targetType: "space" },
    ...(scope.sourceId ? [{ targetId: scope.sourceId, targetType: "source" as const }] : []),
    ...(scope.documentAssetId
      ? [{ targetId: scope.documentAssetId, targetType: "document" as const }]
      : []),
  ];
}

function normalizeScope(scope: DeletionLifecycleFenceScope): DeletionLifecycleFenceScope {
  return {
    ...(scope.documentAssetId
      ? { documentAssetId: requiredId(scope.documentAssetId, "documentAssetId") }
      : {}),
    knowledgeSpaceId: requiredId(scope.knowledgeSpaceId, "knowledgeSpaceId"),
    ...(scope.sourceId ? { sourceId: requiredId(scope.sourceId, "sourceId") } : {}),
    tenantId: requiredId(scope.tenantId, "tenantId"),
  };
}

function normalizeActiveFence(fence: ActiveDeletionLifecycleFence): ActiveDeletionLifecycleFence {
  if (!DeletionLifecycleTargetTypes.includes(fence.targetType)) {
    throw new Error("Deletion lifecycle targetType is invalid");
  }
  const normalized = {
    id: requiredId(fence.id, "fence.id"),
    knowledgeSpaceId: requiredId(fence.knowledgeSpaceId, "fence.knowledgeSpaceId"),
    targetId: requiredId(fence.targetId, "fence.targetId"),
    targetType: fence.targetType,
    tenantId: requiredId(fence.tenantId, "fence.tenantId"),
  };
  if (normalized.targetType === "space" && normalized.targetId !== normalized.knowledgeSpaceId) {
    throw new Error("Space deletion lifecycle fence must target its knowledgeSpaceId");
  }
  return normalized;
}

function fenceKey(
  fence: Pick<
    ActiveDeletionLifecycleFence,
    "knowledgeSpaceId" | "targetId" | "targetType" | "tenantId"
  >,
): string {
  return `${fence.tenantId}:${fence.knowledgeSpaceId}:${fence.targetType}:${fence.targetId}`;
}

function cloneActiveFence(fence: ActiveDeletionLifecycleFence): ActiveDeletionLifecycleFence {
  return { ...fence };
}

function requiredId(value: string, field: string): string {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 512) {
    throw new Error(`Deletion lifecycle ${field} is invalid`);
  }
  return value;
}
