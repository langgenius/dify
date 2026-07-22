import type { KnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import type { KnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";

export interface KnowledgeFsRuntimeCleanupInput {
  readonly leaseCursor?: string | undefined;
  readonly leaseLimit?: number | undefined;
  readonly now?: string | undefined;
  readonly sessionCursor?: string | undefined;
  readonly sessionLimit?: number | undefined;
  readonly tenantId: string;
}

export interface KnowledgeFsRuntimeCleanupResult {
  readonly leaseCursor?: string | undefined;
  readonly leasesDeleted: number;
  readonly now: string;
  readonly sessionCursor?: string | undefined;
  readonly sessionsDeleted: number;
  readonly tenantId: string;
}

export interface KnowledgeFsRuntimeCleanupWorker {
  cleanup(input: KnowledgeFsRuntimeCleanupInput): Promise<KnowledgeFsRuntimeCleanupResult>;
}

export interface KnowledgeFsRuntimeCleanupWorkerOptions {
  readonly leases: Pick<KnowledgeFsLeaseRepository, "delete" | "listExpired">;
  readonly maxLeaseDeletes: number;
  readonly maxSessionDeletes: number;
  readonly now?: () => string;
  readonly sessions: Pick<KnowledgeFsSessionRepository, "delete" | "listExpired">;
}

export function createKnowledgeFsRuntimeCleanupWorker({
  leases,
  maxLeaseDeletes,
  maxSessionDeletes,
  now = () => new Date().toISOString(),
  sessions,
}: KnowledgeFsRuntimeCleanupWorkerOptions): KnowledgeFsRuntimeCleanupWorker {
  validateMax("maxLeaseDeletes", maxLeaseDeletes);
  validateMax("maxSessionDeletes", maxSessionDeletes);

  return {
    async cleanup(input) {
      const cleanupNow = input.now ?? now();
      const sessionLimit = validateLimit({
        label: "sessionLimit",
        limit: input.sessionLimit ?? maxSessionDeletes,
        max: maxSessionDeletes,
      });
      const leaseLimit = validateLimit({
        label: "leaseLimit",
        limit: input.leaseLimit ?? maxLeaseDeletes,
        max: maxLeaseDeletes,
      });
      const expiredSessions = await sessions.listExpired({
        cursor: input.sessionCursor,
        limit: sessionLimit,
        now: cleanupNow,
        tenantId: input.tenantId,
      });
      const expiredLeases = await leases.listExpired({
        cursor: input.leaseCursor,
        limit: leaseLimit,
        now: cleanupNow,
        tenantId: input.tenantId,
      });

      let sessionsDeleted = 0;
      let leasesDeleted = 0;

      for (const session of expiredSessions.items) {
        if (await sessions.delete({ id: session.id, tenantId: session.tenantId })) {
          sessionsDeleted += 1;
        }
      }

      for (const lease of expiredLeases.items) {
        if (await leases.delete({ id: lease.id, tenantId: lease.tenantId })) {
          leasesDeleted += 1;
        }
      }

      return {
        ...(expiredLeases.nextCursor ? { leaseCursor: expiredLeases.nextCursor } : {}),
        leasesDeleted,
        now: cleanupNow,
        ...(expiredSessions.nextCursor ? { sessionCursor: expiredSessions.nextCursor } : {}),
        sessionsDeleted,
        tenantId: input.tenantId,
      };
    },
  };
}

function validateMax(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`KnowledgeFS cleanup ${label} must be at least 1`);
  }
}

function validateLimit({
  label,
  limit,
  max,
}: {
  readonly label: string;
  readonly limit: number;
  readonly max: number;
}): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`KnowledgeFS cleanup ${label} must be at least 1`);
  }

  if (limit > max) {
    const maxLabel = label === "leaseLimit" ? "maxLeaseDeletes" : "maxSessionDeletes";
    throw new Error(`KnowledgeFS cleanup ${label} exceeds ${maxLabel}=${max}`);
  }

  return limit;
}
