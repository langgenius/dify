import { describe, expect, it, vi } from "vitest";

import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import type {
  ObjectMetadata,
  ObjectStorageAdapter,
  ObjectStorageDirectUploadAdapter,
} from "@knowledge/core";

import { createStaticStorageQuotaRepository } from "./storage-quota";
import {
  type CreateUploadSessionServiceOptions,
  DirectUploadUnavailableError,
  UploadSessionConflictError,
  UploadSessionIntegrityError,
  createInMemoryUploadSessionRepository,
  createUploadSessionService,
} from "./upload-session";

const MiB = 1024 * 1024;
const SESSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02";
const COMPLETION_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d04";
const RECOVERY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d05";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03";
const TENANT_ID = "tenant-1";
const CHECKSUM = "sha256-base64";

describe("upload session service", () => {
  it("reserves quota and returns a short-lived fixed-key presigned PUT", async () => {
    const recordMetric = vi.fn();
    const fixture = uploadFixture({ metrics: { record: recordMetric } });

    const created = await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/pdf",
      expectedSizeBytes: 512,
      fileName: "../quarterly report.pdf",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-1",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    expect(created.session).toMatchObject({
      expectedSizeBytes: 512,
      grantId: GRANT_ID,
      id: SESSION_ID,
      mode: "single",
      objectKey: `namespaces/${TENANT_ID}/spaces/${SPACE_ID}/uploads/${SESSION_ID}/source`,
      reservedBytes: 512,
      status: "ready",
    });
    expect(created.upload).toMatchObject({ method: "PUT", url: "https://objects.example/put" });
    expect(fixture.direct.presignPutObject).toHaveBeenCalledWith({
      checksumSha256Base64: CHECKSUM,
      contentLength: 512,
      contentType: "application/pdf",
      expiresInSeconds: 60,
      key: created.session.objectKey,
      metadata: {
        knowledge_space_id: SPACE_ID,
        tenant_id: TENANT_ID,
        upload_session_id: SESSION_ID,
      },
    });
    expect(recordMetric).toHaveBeenCalledWith({
      bytes: 512,
      mode: "single",
      status: "created",
    });
  });

  it("replays identical create requests and rejects idempotency-key payload changes", async () => {
    const fixture = uploadFixture();
    const input = {
      checksumSha256Base64: CHECKSUM,
      contentType: "text/plain",
      expectedSizeBytes: 512,
      fileName: "notes.txt",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-2",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    } as const;

    const first = await fixture.service.create(input);
    const replay = await fixture.service.create(input);

    expect(replay.session.id).toBe(first.session.id);
    await expect(fixture.service.create({ ...input, expectedSizeBytes: 513 })).rejects.toThrow(
      UploadSessionConflictError,
    );
  });

  it("atomically counts active reservations against raw-document quota", async () => {
    const fixture = uploadFixture({ maxRawDocumentBytes: 1_000, rawDocumentBytes: 600 });

    await expect(
      fixture.service.create({
        checksumSha256Base64: CHECKSUM,
        contentType: "application/pdf",
        expectedSizeBytes: 401,
        fileName: "too-large.pdf",
        grantId: GRANT_ID,
        idempotencyKey: "upload-intent-over-quota",
        knowledgeSpaceId: SPACE_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("Storage quota exceeded");
    await expect(
      fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toBeNull();
  });

  it("uses a deterministic multipart plan and verifies the final object before one publication", async () => {
    const recordMetric = vi.fn();
    const fixture = uploadFixture({
      head: {
        checksumSha256Base64: CHECKSUM,
        key: "ignored-by-fixture",
        metadata: {},
        sizeBytes: 11 * MiB,
      },
      metrics: { record: recordMetric },
    });
    const created = await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
      fileName: "archive.bin",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-multipart",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    expect(created.session).toMatchObject({
      mode: "multipart",
      multipartPartCount: 3,
      multipartPartSizeBytes: 5 * MiB,
      multipartUploadId: "multipart-1",
      status: "ready",
    });
    await expect(
      fixture.service.presignPart({
        checksumSha256Base64: "part-3-checksum",
        contentLength: MiB,
        partNumber: 3,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ url: "https://objects.example/part" });
    await expect(
      fixture.service.presignPart({
        checksumSha256Base64: "wrong-size",
        contentLength: MiB - 1,
        partNumber: 3,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("part content length does not match the session plan");

    const parts = [
      { checksumSha256Base64: "part-1", etag: '"etag-1"', partNumber: 1 },
      { checksumSha256Base64: "part-2", etag: '"etag-2"', partNumber: 2 },
      { checksumSha256Base64: "part-3", etag: '"etag-3"', partNumber: 3 },
    ];
    const completed = await fixture.service.complete({
      grantId: COMPLETION_GRANT_ID,
      parts,
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
    });
    const replay = await fixture.service.complete({
      grantId: COMPLETION_GRANT_ID,
      parts,
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
    });

    expect(completed.session).toMatchObject({
      compilationJobId: "compilation-1",
      documentAssetId: "asset-1",
      reservedBytes: 0,
      status: "completed",
    });
    expect(replay).toEqual(completed);
    expect(fixture.direct.completeMultipartUpload).toHaveBeenCalledOnce();
    expect(fixture.direct.verifyObjectSha256).toHaveBeenCalledWith({
      checksumSha256Base64: CHECKSUM,
      expectedSizeBytes: 11 * MiB,
      key: created.session.objectKey,
    });
    expect(fixture.publish).toHaveBeenCalledOnce();
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: COMPLETION_GRANT_ID,
        idempotencyKey: `upload-session:${SESSION_ID}:publish`,
        objectKey: created.session.objectKey,
      }),
    );
    expect(recordMetric.mock.calls.map((call) => call[0])).toEqual([
      { bytes: 11 * MiB, mode: "multipart", status: "created" },
      { bytes: 11 * MiB, mode: "multipart", status: "completed" },
    ]);
  });

  it("fails closed and deletes an object when size or checksum does not match", async () => {
    const recordMetric = vi.fn();
    const fixture = uploadFixture({
      head: {
        checksumSha256Base64: "different-checksum",
        key: "ignored-by-fixture",
        metadata: {},
        sizeBytes: 512,
      },
      metrics: { record: recordMetric },
    });
    await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/pdf",
      expectedSizeBytes: 512,
      fileName: "report.pdf",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-integrity",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    await expect(
      fixture.service.complete({
        grantId: COMPLETION_GRANT_ID,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow(UploadSessionIntegrityError);
    expect(fixture.storage.deleteObject).toHaveBeenCalledOnce();
    await expect(
      fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ reservedBytes: 0, status: "failed" });
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(recordMetric).toHaveBeenLastCalledWith({
      bytes: 512,
      mode: "single",
      status: "checksum_failure",
    });
  });

  it("fails closed when streamed full-object verification rejects a completed multipart upload", async () => {
    const direct = fakeDirectUpload();
    direct.verifyObjectSha256.mockResolvedValue(false);
    const fixture = uploadFixture({
      direct,
      head: {
        key: "ignored-by-fixture",
        metadata: {},
        sizeBytes: 11 * MiB,
      },
    });
    await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
      fileName: "archive.bin",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-multipart-mismatch",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    await expect(
      fixture.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts: [
          { checksumSha256Base64: "part-1", etag: '"etag-1"', partNumber: 1 },
          { checksumSha256Base64: "part-2", etag: '"etag-2"', partNumber: 2 },
          { checksumSha256Base64: "part-3", etag: '"etag-3"', partNumber: 3 },
        ],
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow(UploadSessionIntegrityError);
    expect(fixture.storage.deleteObject).toHaveBeenCalledOnce();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it("aborts multipart state idempotently and releases its reservation", async () => {
    const recordMetric = vi.fn();
    const fixture = uploadFixture({ metrics: { record: recordMetric } });
    await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
      fileName: "archive.bin",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-abort",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });

    const aborted = await fixture.service.abort({ sessionId: SESSION_ID, tenantId: TENANT_ID });
    const replay = await fixture.service.abort({ sessionId: SESSION_ID, tenantId: TENANT_ID });

    expect(aborted).toMatchObject({ reservedBytes: 0, status: "aborted" });
    expect(replay).toEqual(aborted);
    expect(fixture.direct.abortMultipartUpload).toHaveBeenCalledOnce();
    expect(recordMetric.mock.calls.map((call) => call[0].status)).toEqual(["created", "aborted"]);
  });

  it("claims expired sessions, aborts remote multipart state, and releases quota", async () => {
    let timestamp = 2_000_000;
    const recordMetric = vi.fn();
    const fixture = uploadFixture({ metrics: { record: recordMetric }, now: () => timestamp });
    await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
      fileName: "expired.bin",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-expired",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    timestamp += 16 * 60_000;

    await expect(
      fixture.service.cleanupExpired({ limit: 10, staleBefore: timestamp - 60_000 }),
    ).resolves.toEqual({ expired: 1, failed: 0 });
    await expect(
      fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ reservedBytes: 0, status: "expired" });
    expect(fixture.direct.abortMultipartUpload).toHaveBeenCalledOnce();
    expect(recordMetric.mock.calls.map((call) => call[0].status)).toEqual(["created", "expired"]);
  });

  it("keeps upload state transitions independent from metric exporter failures", async () => {
    const fixture = uploadFixture({
      metrics: { record: vi.fn(() => Promise.reject(new Error("collector unavailable"))) },
    });

    await expect(
      fixture.service.create({
        checksumSha256Base64: CHECKSUM,
        contentType: "application/pdf",
        expectedSizeBytes: 512,
        fileName: "report.pdf",
        grantId: GRANT_ID,
        idempotencyKey: "metric-failure",
        knowledgeSpaceId: SPACE_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ session: { status: "ready" } });
  });

  it("allows only an explicit bounded small-file fallback when presigning is unavailable", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 4 });
    const fixture = uploadFixture({ storage });
    const body = new TextEncoder().encode("tiny");
    const checksumSha256Base64 = await sha256Base64(body);

    const created = await fixture.service.create({
      checksumSha256Base64,
      contentType: "text/plain",
      expectedSizeBytes: 4,
      fileName: "small.txt",
      grantId: GRANT_ID,
      idempotencyKey: "small-fallback",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    expect(created).toMatchObject({ session: { mode: "small_fallback", status: "ready" } });
    await expect(
      fixture.service.putSmallFile({
        body: new TextEncoder().encode("nope"),
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow(UploadSessionIntegrityError);
    await fixture.service.putSmallFile({ body, sessionId: SESSION_ID, tenantId: TENANT_ID });
    await expect(
      fixture.service.complete({
        grantId: COMPLETION_GRANT_ID,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ session: { status: "completed" } });
    await expect(
      fixture.service.putSmallFile({ body, sessionId: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toBeUndefined();
    await expect(
      fixture.service.complete({
        grantId: RECOVERY_GRANT_ID,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ session: { status: "completed" } });
    expect(fixture.publish).toHaveBeenCalledOnce();
    await expect(
      fixture.service.create({
        checksumSha256Base64: CHECKSUM,
        contentType: "application/octet-stream",
        expectedSizeBytes: 5,
        fileName: "not-small.bin",
        grantId: GRANT_ID,
        idempotencyKey: "large-fallback-denied",
        knowledgeSpaceId: SPACE_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow(DirectUploadUnavailableError);
  });

  it("does not revive an aborted small-file fallback", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 4 });
    const fixture = uploadFixture({ storage });
    const body = new TextEncoder().encode("tiny");

    await fixture.service.create({
      checksumSha256Base64: await sha256Base64(body),
      contentType: "text/plain",
      expectedSizeBytes: body.byteLength,
      fileName: "small.txt",
      grantId: GRANT_ID,
      idempotencyKey: "small-fallback-abort",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    await fixture.service.abort({ sessionId: SESSION_ID, tenantId: TENANT_ID });

    await expect(
      fixture.service.putSmallFile({ body, sessionId: SESSION_ID, tenantId: TENANT_ID }),
    ).rejects.toThrow(UploadSessionConflictError);
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it("resumes a completing session with a fresh completion grant after publication crashes", async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error("publisher crashed"))
      .mockResolvedValueOnce({ compilationJobId: "compilation-1", documentAssetId: "asset-1" });
    const fixture = uploadFixture({
      head: {
        checksumSha256Base64: CHECKSUM,
        key: "ignored-by-fixture",
        metadata: {},
        sizeBytes: 11 * MiB,
      },
      publish,
    });
    await fixture.service.create({
      checksumSha256Base64: CHECKSUM,
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
      fileName: "recover.bin",
      grantId: GRANT_ID,
      idempotencyKey: "upload-intent-recover",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    const parts = [
      { etag: '"etag-1"', partNumber: 1 },
      { etag: '"etag-2"', partNumber: 2 },
      { etag: '"etag-3"', partNumber: 3 },
    ];

    await expect(
      fixture.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("publisher crashed");
    await expect(
      fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ completionGrantId: COMPLETION_GRANT_ID, status: "completing" });

    await expect(
      fixture.service.complete({
        grantId: RECOVERY_GRANT_ID,
        parts,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({
      session: {
        completionGrantId: RECOVERY_GRANT_ID,
        reservedBytes: 0,
        status: "completed",
      },
    });
    expect(fixture.direct.completeMultipartUpload).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ grantId: RECOVERY_GRANT_ID }),
    );
  });

  it.each([
    [{ maxFileBytes: 0 }, "maxFileBytes must be a positive safe integer"],
    [{ multipartThresholdBytes: 21 * MiB }, "must not exceed maxFileBytes"],
    [{ multipartPartSizeBytes: 1 }, "must be between 5 MiB and 5 GiB"],
    [{ multipartPartSizeBytes: 5 * 1024 * MiB + 1 }, "must be between 5 MiB and 5 GiB"],
    [{ sessionTtlMs: 0 }, "sessionTtlMs must be a positive safe integer"],
    [{ presignTtlSeconds: 0 }, "must be between 1 and 900"],
    [{ presignTtlSeconds: 901 }, "must be between 1 and 900"],
    [{ smallFileFallbackMaxBytes: -1 }, "must be a non-negative safe integer"],
    [{ smallFileFallbackMaxBytes: 10 * MiB }, "must be below multipartThresholdBytes"],
  ] satisfies ReadonlyArray<readonly [Partial<CreateUploadSessionServiceOptions>, string]>)(
    "rejects invalid service bounds %#",
    (overrides, message) => {
      expect(() => createUploadSessionService({ ...uploadServiceOptions(), ...overrides })).toThrow(
        message,
      );
    },
  );

  it("covers repository capacity, fencing, immutability, and cleanup bounds", async () => {
    expect(() => createInMemoryUploadSessionRepository({ maxSessions: 0 })).toThrow(
      "repository maxSessions must be a positive safe integer",
    );
    const fixture = uploadFixture();
    const created = await fixture.service.create(createInput("repository-bounds"));
    const session = created.session;

    await expect(
      fixture.repository.claimExpired({ limit: 1, now: 10, staleBefore: 11 }),
    ).rejects.toThrow("staleBefore must not exceed now");
    await expect(
      fixture.repository.get({ id: session.id, tenantId: "tenant-other" }),
    ).resolves.toBeNull();
    await expect(
      fixture.repository.update({
        expectedRowVersion: session.rowVersion + 1,
        session: { ...session, rowVersion: session.rowVersion + 2 },
      }),
    ).resolves.toBeNull();
    await expect(
      fixture.repository.update({
        expectedRowVersion: session.rowVersion,
        session: { ...session, rowVersion: session.rowVersion },
      }),
    ).rejects.toThrow("must increment rowVersion by one");
    await expect(
      fixture.repository.update({
        expectedRowVersion: session.rowVersion,
        session: {
          ...session,
          expiresAt: session.expiresAt + 1,
          rowVersion: session.rowVersion + 1,
        },
      }),
    ).rejects.toThrow("immutable fields cannot be changed");

    const bounded = createInMemoryUploadSessionRepository({ maxSessions: 1 });
    await bounded.create({ currentRawDocumentBytes: 0, maxRawDocumentBytes: null, session });
    await expect(
      bounded.create({
        currentRawDocumentBytes: 0,
        maxRawDocumentBytes: null,
        session: {
          ...session,
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d09",
          idempotencyKey: "repository-capacity",
        },
      }),
    ).rejects.toThrow("maxSessions=1 exceeded");
  });

  it("rejects every non-abortable terminal or in-flight state", async () => {
    for (const status of ["completed", "aborting", "completing"] as const) {
      const fixture = uploadFixture();
      await fixture.service.create(createInput(`abort-${status}`));
      await setSessionStatus(fixture, status);
      await expect(
        fixture.service.abort({ sessionId: SESSION_ID, tenantId: TENANT_ID }),
      ).rejects.toThrow(UploadSessionConflictError);
    }

    for (const status of ["aborted", "expired"] as const) {
      const fixture = uploadFixture();
      await fixture.service.create(createInput(`abort-replay-${status}`));
      await setSessionStatus(fixture, status);
      await expect(
        fixture.service.abort({ sessionId: SESSION_ID, tenantId: TENANT_ID }),
      ).resolves.toMatchObject({ status });
    }
  });

  it("covers part, completion, expiry, and fallback state boundaries", async () => {
    const single = uploadFixture();
    await single.service.create(createInput("single-boundaries"));
    await expect(
      single.service.presignPart({
        checksumSha256Base64: "checksum",
        contentLength: 512,
        partNumber: 1,
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("not multipart");
    await expect(
      single.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts: [{ etag: "etag", partNumber: 1 }],
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("Single-part completion cannot include multipart parts");
    await expect(
      single.service.putSmallFile({
        body: new Uint8Array([1]),
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("does not allow small-file fallback");

    const multipart = uploadFixture();
    await multipart.service.create({
      ...createInput("multipart-boundaries"),
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
    });
    for (const partNumber of [0, 4]) {
      await expect(
        multipart.service.presignPart({
          checksumSha256Base64: "checksum",
          contentLength: 5 * MiB,
          partNumber,
          sessionId: SESSION_ID,
          tenantId: TENANT_ID,
        }),
      ).rejects.toThrow("partNumber is outside the plan");
    }
    await expect(
      multipart.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts: [{ etag: "etag", partNumber: 1 }],
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("does not match the session plan");
    await expect(
      multipart.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts: [
          { etag: "etag-2", partNumber: 2 },
          { etag: "etag-1", partNumber: 1 },
          { etag: "etag-3", partNumber: 3 },
        ],
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("parts must be ordered and complete");
  });

  it("leaves cleanup claims retryable when remote object cleanup fails", async () => {
    let timestamp = 2_000_000;
    const direct = fakeDirectUpload();
    direct.abortMultipartUpload.mockRejectedValue(new Error("remote unavailable"));
    const fixture = uploadFixture({ direct, now: () => timestamp });
    await fixture.service.create({
      ...createInput("cleanup-failure"),
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
    });
    timestamp += 16 * 60_000;

    await expect(
      fixture.service.cleanupExpired({ limit: 1, staleBefore: timestamp - 60_000 }),
    ).resolves.toEqual({ expired: 0, failed: 1 });
    await expect(
      fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ status: "aborting" });
  });

  it("recovers a remote multipart completion that committed before the client error", async () => {
    const direct = fakeDirectUpload();
    direct.completeMultipartUpload.mockRejectedValue(new Error("connection reset"));
    const fixture = uploadFixture({
      direct,
      head: {
        checksumSha256Base64: CHECKSUM,
        key: "ignored-by-fixture",
        metadata: {},
        sizeBytes: 11 * MiB,
      },
    });
    await fixture.service.create({
      ...createInput("remote-completion-recovery"),
      contentType: "application/octet-stream",
      expectedSizeBytes: 11 * MiB,
    });

    await expect(
      fixture.service.complete({
        grantId: COMPLETION_GRANT_ID,
        parts: [
          { etag: "etag-1", partNumber: 1 },
          { etag: "etag-2", partNumber: 2 },
          { etag: "etag-3", partNumber: 3 },
        ],
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ session: { status: "completed" } });
  });
});

function createInput(idempotencyKey: string) {
  return {
    checksumSha256Base64: CHECKSUM,
    contentType: "application/pdf",
    expectedSizeBytes: 512,
    fileName: "report.pdf",
    grantId: GRANT_ID,
    idempotencyKey,
    knowledgeSpaceId: SPACE_ID,
    tenantId: TENANT_ID,
  } as const;
}

function uploadServiceOptions(): CreateUploadSessionServiceOptions {
  const direct = fakeDirectUpload();
  return {
    completionPublisher: {
      publish: async () => ({ compilationJobId: "compilation-1", documentAssetId: "asset-1" }),
    },
    generateId: () => SESSION_ID,
    maxFileBytes: 20 * MiB,
    multipartPartSizeBytes: 5 * MiB,
    multipartThresholdBytes: 10 * MiB,
    now: () => 2_000_000,
    objectStorage: fakeStorage({ direct }),
    objectStorageUsage: { getStorageUsage: async () => ({ rawDocumentBytes: 0 }) },
    presignTtlSeconds: 60,
    quotas: createStaticStorageQuotaRepository({ maxRawDocumentBytes: null }),
    repository: createInMemoryUploadSessionRepository({ maxSessions: 100 }),
    sessionTtlMs: 15 * 60_000,
    smallFileFallbackMaxBytes: 4,
  };
}

async function setSessionStatus(
  fixture: ReturnType<typeof uploadFixture>,
  status: "aborted" | "aborting" | "completed" | "completing" | "expired",
) {
  const current = await fixture.repository.get({ id: SESSION_ID, tenantId: TENANT_ID });
  if (!current) throw new Error("upload session fixture missing");
  const updated = await fixture.repository.update({
    expectedRowVersion: current.rowVersion,
    session: { ...current, rowVersion: current.rowVersion + 1, status },
  });
  if (!updated) throw new Error("upload session fixture update failed");
}

function uploadFixture(
  input: {
    readonly direct?: ReturnType<typeof fakeDirectUpload>;
    readonly head?: ObjectMetadata | null;
    readonly maxRawDocumentBytes?: number | null;
    readonly metrics?: { record(event: unknown): Promise<void> | void };
    readonly now?: () => number;
    readonly publish?: ReturnType<typeof vi.fn>;
    readonly rawDocumentBytes?: number;
    readonly storage?: ObjectStorageAdapter;
  } = {},
) {
  const direct = input.direct ?? fakeDirectUpload();
  const storage = input.storage ?? fakeStorage({ direct, head: input.head });
  const repository = createInMemoryUploadSessionRepository({ maxSessions: 100 });
  const publish =
    input.publish ??
    vi.fn(async () => ({
      compilationJobId: "compilation-1",
      documentAssetId: "asset-1",
    }));
  const service = createUploadSessionService({
    completionPublisher: { publish },
    generateId: () => SESSION_ID,
    maxFileBytes: 20 * MiB,
    multipartPartSizeBytes: 5 * MiB,
    multipartThresholdBytes: 10 * MiB,
    ...(input.metrics ? { metrics: input.metrics } : {}),
    now: input.now ?? (() => 2_000_000),
    objectStorage: storage,
    objectStorageUsage: {
      getStorageUsage: async () => ({ rawDocumentBytes: input.rawDocumentBytes ?? 0 }),
    },
    presignTtlSeconds: 60,
    quotas: createStaticStorageQuotaRepository({
      maxRawDocumentBytes: input.maxRawDocumentBytes ?? null,
    }),
    repository,
    sessionTtlMs: 15 * 60_000,
    smallFileFallbackMaxBytes: 4,
  });
  return { direct, publish, repository, service, storage };
}

async function sha256Base64(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Buffer.from(digest).toString("base64");
}

function fakeDirectUpload(): ObjectStorageDirectUploadAdapter & {
  readonly abortMultipartUpload: ReturnType<typeof vi.fn>;
  readonly completeMultipartUpload: ReturnType<typeof vi.fn>;
  readonly createMultipartUpload: ReturnType<typeof vi.fn>;
  readonly presignMultipartPart: ReturnType<typeof vi.fn>;
  readonly presignPutObject: ReturnType<typeof vi.fn>;
  readonly verifyObjectSha256: ReturnType<typeof vi.fn>;
} {
  return {
    abortMultipartUpload: vi.fn(async () => undefined),
    completeMultipartUpload: vi.fn(async () => undefined),
    createMultipartUpload: vi.fn(async ({ key }: { readonly key: string }) => ({
      key,
      uploadId: "multipart-1",
    })),
    ensureIncompleteMultipartUploadLifecycle: vi.fn(async () => undefined),
    presignMultipartPart: vi.fn(async () => ({
      expiresAt: 2_060_000,
      headers: {},
      method: "PUT" as const,
      url: "https://objects.example/part",
    })),
    presignPutObject: vi.fn(async () => ({
      expiresAt: 2_060_000,
      headers: {},
      method: "PUT" as const,
      url: "https://objects.example/put",
    })),
    verifyObjectSha256: vi.fn(async () => true),
  };
}

function fakeStorage(input: {
  readonly direct?: ObjectStorageDirectUploadAdapter | undefined;
  readonly head?: ObjectMetadata | null | undefined;
}): ObjectStorageAdapter & {
  readonly deleteObject: ReturnType<typeof vi.fn>;
} {
  return {
    kind: "memory",
    ...(input.direct ? { directUpload: input.direct } : {}),
    deleteObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => null),
    getObjectStream: vi.fn(async () => null),
    health: vi.fn(async () => true),
    headObject: vi.fn(async (key: string) =>
      input.head === undefined
        ? { checksumSha256Base64: CHECKSUM, key, metadata: {}, sizeBytes: 512 }
        : input.head,
    ),
    listObjects: vi.fn(async () => ({ objects: [] })),
    putObject: vi.fn(async ({ body, key }) => ({ key, metadata: {}, sizeBytes: body.byteLength })),
  };
}
