import {
  type KnowledgeFsLease,
  KnowledgeFsLeaseSchema,
  type KnowledgeFsSession,
  KnowledgeFsSessionSchema,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryKnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import { createKnowledgeFsRuntimeCleanupWorker } from "./knowledge-fs-runtime-cleanup-worker";
import { createInMemoryKnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01";

describe("createKnowledgeFsRuntimeCleanupWorker", () => {
  it("prunes expired sessions and leases with stable cursors and limits", async () => {
    const sessions = createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 2,
      maxSessions: 10,
    });
    const leases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 10,
      maxListLimit: 2,
    });
    await sessions.create(session("018f0d60-7a49-7cc2-9c1b-5b36f18f7a01"));
    await sessions.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f7a02", {
        expiresAt: "2026-05-27T10:01:00.000Z",
      }),
    );
    await sessions.create(
      session("018f0d60-7a49-7cc2-9c1b-5b36f18f7a03", {
        expiresAt: "2026-05-27T10:30:00.000Z",
      }),
    );
    await leases.acquire(lease("018f0d60-7a49-7cc2-9c1b-5b36f18f7b01"));
    await leases.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f7b02", {
        expiresAt: "2026-05-27T10:01:00.000Z",
        virtualPath: "/sources/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f7b02",
      }),
    );
    await leases.acquire(
      lease("018f0d60-7a49-7cc2-9c1b-5b36f18f7b03", {
        expiresAt: "2026-05-27T10:30:00.000Z",
        virtualPath: "/sources/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
      }),
    );
    const worker = createKnowledgeFsRuntimeCleanupWorker({
      leases,
      maxLeaseDeletes: 1,
      maxSessionDeletes: 1,
      now: () => "2026-05-27T10:02:00.000Z",
      sessions,
    });

    const first = await worker.cleanup({
      tenantId: "tenant-1",
    });
    expect(first).toMatchObject({
      leasesDeleted: 1,
      sessionsDeleted: 1,
      tenantId: "tenant-1",
    });
    expect(first.leaseCursor).toBeDefined();
    expect(first.sessionCursor).toBeDefined();
    await expect(
      sessions.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a01",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();

    await expect(
      worker.cleanup({
        leaseCursor: first.leaseCursor,
        sessionCursor: first.sessionCursor,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      leasesDeleted: 1,
      sessionsDeleted: 1,
    });
    await expect(
      sessions.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a03" });
    await expect(
      leases.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b03" });
  });

  it("rejects cleanup limits above configured bounds", async () => {
    const worker = createKnowledgeFsRuntimeCleanupWorker({
      leases: createInMemoryKnowledgeFsLeaseRepository({ maxLeases: 1, maxListLimit: 1 }),
      maxLeaseDeletes: 1,
      maxSessionDeletes: 1,
      sessions: createInMemoryKnowledgeFsSessionRepository({ maxListLimit: 1, maxSessions: 1 }),
    });

    await expect(
      worker.cleanup({
        leaseLimit: 2,
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("KnowledgeFS cleanup leaseLimit exceeds maxLeaseDeletes=1");
  });
});

function session(id: string, overrides: Partial<KnowledgeFsSession> = {}): KnowledgeFsSession {
  return KnowledgeFsSessionSchema.parse({
    clientKind: "worker",
    clientVersion: "1.0.0",
    consistencyClass: "path-consistent",
    createdAt: "2026-05-27T09:55:00.000Z",
    expiresAt: "2026-05-27T10:00:00.000Z",
    heartbeatAt: "2026-05-27T09:55:00.000Z",
    id,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    permissionSnapshot: ["knowledge-spaces:write"],
    subject: {
      scopes: ["knowledge-spaces:write"],
      subjectId: "worker-1",
      tenantId: "tenant-1",
    },
    tenantId: "tenant-1",
    updatedAt: "2026-05-27T09:55:00.000Z",
    ...overrides,
  });
}

function lease(id: string, overrides: Partial<KnowledgeFsLease> = {}): KnowledgeFsLease {
  return KnowledgeFsLeaseSchema.parse({
    acquiredAt: "2026-05-27T09:55:00.000Z",
    expiresAt: "2026-05-27T10:00:00.000Z",
    heartbeatAt: "2026-05-27T09:55:00.000Z",
    id,
    knowledgeSpaceId: SPACE_ID,
    leaseType: "publish",
    metadata: {},
    sessionId: SESSION_ID,
    status: "active",
    targetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    targetType: "document-asset",
    targetVersion: 1,
    tenantId: "tenant-1",
    updatedAt: "2026-05-27T09:55:00.000Z",
    virtualPath: "/sources/documents/018f0d60-7a49-7cc2-9c1b-5b36f18f7b01",
    ...overrides,
  });
}
