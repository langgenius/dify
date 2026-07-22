import type {
  KnowledgeFsLease,
  KnowledgeFsLeaseTargetType,
  KnowledgeFsLeaseType,
} from "@knowledge/core";

import type { KnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";

export interface KnowledgeFsOperationLeaseInput {
  readonly knowledgeSpaceId: string;
  readonly leaseType: Exclude<KnowledgeFsLeaseType, "read">;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly targetId: string;
  readonly targetType: KnowledgeFsLeaseTargetType;
  readonly targetVersion?: number | undefined;
  readonly tenantId: string;
  readonly virtualPath: string;
}

export interface KnowledgeFsOperationLeaseCoordinator {
  withLease<T>(input: KnowledgeFsOperationLeaseInput, operation: () => Promise<T>): Promise<T>;
}

export interface KnowledgeFsOperationLeaseCoordinatorOptions {
  readonly generateLeaseId: () => string;
  readonly leaseTtlMs: number;
  readonly leases: KnowledgeFsLeaseRepository;
  readonly now?: () => string;
  readonly sessionId: string;
}

export function createKnowledgeFsOperationLeaseCoordinator({
  generateLeaseId,
  leases,
  leaseTtlMs,
  now = () => new Date().toISOString(),
  sessionId,
}: KnowledgeFsOperationLeaseCoordinatorOptions): KnowledgeFsOperationLeaseCoordinator {
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1) {
    throw new Error("KnowledgeFS operation lease TTL must be at least 1ms");
  }

  return {
    async withLease(input, operation) {
      const acquiredAt = now();
      const lease: KnowledgeFsLease = {
        acquiredAt,
        expiresAt: addMilliseconds(acquiredAt, leaseTtlMs),
        heartbeatAt: acquiredAt,
        id: generateLeaseId(),
        knowledgeSpaceId: input.knowledgeSpaceId,
        leaseType: input.leaseType,
        metadata: input.metadata ?? {},
        sessionId,
        status: "active",
        targetId: input.targetId,
        targetType: input.targetType,
        ...(input.targetVersion === undefined ? {} : { targetVersion: input.targetVersion }),
        tenantId: input.tenantId,
        updatedAt: acquiredAt,
        virtualPath: input.virtualPath,
      };
      const acquired = await leases.acquire(lease);

      try {
        const result = await operation();
        const heartbeatAt = now();
        await leases.heartbeat({
          expiresAt: addMilliseconds(heartbeatAt, leaseTtlMs),
          heartbeatAt,
          id: acquired.id,
          tenantId: acquired.tenantId,
          updatedAt: heartbeatAt,
        });
        await leases.release({
          id: acquired.id,
          status: "released",
          tenantId: acquired.tenantId,
          updatedAt: now(),
        });

        return result;
      } catch (error) {
        await leases
          .release({
            id: acquired.id,
            status: "failed",
            tenantId: acquired.tenantId,
            updatedAt: now(),
          })
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}
