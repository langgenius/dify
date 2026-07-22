import type { UploadSessionService } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import {
  createApiUploadSessionAssembly,
  createApiUploadSessionCleanupRuntime,
  createApiUploadSessionOptions,
} from "./upload-session-options";

describe("API upload-session options", () => {
  it("keeps direct upload disabled unless rollout is explicit", () => {
    expect(createApiUploadSessionOptions({})).toBeUndefined();
    expect(
      createApiUploadSessionOptions({ KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "off" }),
    ).toBeUndefined();
  });

  it("parses a bounded direct-upload and cleanup profile", () => {
    expect(
      createApiUploadSessionOptions({
        KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS:
          "https://console.example.com,http://localhost:3000,https://console.example.com",
        KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_BATCH_SIZE: "25",
        KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_INTERVAL_MS: "30000",
        KNOWLEDGE_DIRECT_UPLOAD_CLEANUP_STALE_MS: "120000",
        KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS: "3",
        KNOWLEDGE_DIRECT_UPLOAD_MAX_FILE_BYTES: "1073741824",
        KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES: "8388608",
        KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES: "16777216",
        KNOWLEDGE_DIRECT_UPLOAD_PRESIGN_TTL_SECONDS: "600",
        KNOWLEDGE_DIRECT_UPLOAD_SESSION_TTL_MS: "3600000",
        KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES: "4194304",
      }),
    ).toEqual({
      allowedOrigins: ["https://console.example.com", "http://localhost:3000"],
      cleanupBatchSize: 25,
      cleanupIntervalMs: 30_000,
      cleanupStaleMs: 120_000,
      incompleteMultipartDays: 3,
      maxFileBytes: 1_073_741_824,
      multipartPartSizeBytes: 8_388_608,
      multipartThresholdBytes: 16_777_216,
      presignTtlSeconds: 600,
      sessionTtlMs: 3_600_000,
      smallFileFallbackMaxBytes: 4_194_304,
    });
  });

  it("rejects remote HTTP origins in production while allowing HTTPS and loopback", () => {
    expect(() =>
      createApiUploadSessionOptions({
        KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: "http://console.example.com",
        KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        NODE_ENV: "production",
      }),
    ).toThrow("HTTPS");

    for (const origin of [
      "https://console.example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      expect(
        createApiUploadSessionOptions({
          KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: origin,
          KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
          NODE_ENV: "production",
        })?.allowedOrigins,
      ).toEqual([origin]);
    }
  });

  it("fails fast on ambiguous rollout and unsafe bounds", () => {
    expect(() =>
      createApiUploadSessionOptions({ KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "maybe" }),
    ).toThrow("KNOWLEDGE_DIRECT_UPLOAD_ENABLED");
    expect(() => createApiUploadSessionOptions({ KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on" })).toThrow(
      "KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS",
    );
    for (const origin of ["*", "https://dify.example.com/app", "https://user@dify.example.com"]) {
      expect(() =>
        createApiUploadSessionOptions({
          KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: origin,
          KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        }),
      ).toThrow("absolute HTTP(S) origins");
    }
    expect(() =>
      createApiUploadSessionOptions({
        KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: "https://console.example.com",
        KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS: "0",
      }),
    ).toThrow("KNOWLEDGE_DIRECT_UPLOAD_INCOMPLETE_MULTIPART_DAYS");
    expect(() =>
      createApiUploadSessionOptions({
        KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: "https://console.example.com",
        KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES: "1048576",
      }),
    ).toThrow("KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_PART_BYTES");
    expect(() =>
      createApiUploadSessionOptions({
        KNOWLEDGE_DIRECT_UPLOAD_ALLOWED_ORIGINS: "https://console.example.com",
        KNOWLEDGE_DIRECT_UPLOAD_ENABLED: "on",
        KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES: "4194304",
        KNOWLEDGE_DIRECT_UPLOAD_SMALL_FALLBACK_MAX_BYTES: "4194304",
      }),
    ).toThrow("below KNOWLEDGE_DIRECT_UPLOAD_MULTIPART_THRESHOLD_BYTES");
  });
});

describe("API upload-session cleanup runtime", () => {
  it("runs one bounded cleanup tick and reports failures without overlapping", async () => {
    let release: (() => void) | undefined;
    const cleanupExpired = vi.fn(
      () =>
        new Promise<{ expired: number; failed: number }>((resolve) => {
          release = () => resolve({ expired: 2, failed: 1 });
        }),
    );
    const onError = vi.fn();
    const runtime = createApiUploadSessionCleanupRuntime({
      cleanupBatchSize: 7,
      cleanupIntervalMs: 1_000,
      cleanupStaleMs: 5_000,
      now: () => 10_000,
      onError,
      sessions: { cleanupExpired } as unknown as UploadSessionService,
    });

    const first = runtime.tick();
    const overlapping = await runtime.tick();
    expect(overlapping).toEqual({ expired: 0, failed: 0, skipped: true });
    expect(cleanupExpired).toHaveBeenCalledWith({ limit: 7, staleBefore: 5_000 });
    release?.();
    await expect(first).resolves.toEqual({ expired: 2, failed: 1, skipped: false });
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the timer retryable after a failed tick", async () => {
    const error = new Error("object store unavailable");
    const cleanupExpired = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ expired: 1, failed: 0 });
    const onError = vi.fn();
    const runtime = createApiUploadSessionCleanupRuntime({
      cleanupBatchSize: 3,
      cleanupIntervalMs: 1_000,
      cleanupStaleMs: 5_000,
      now: () => 20_000,
      onError,
      sessions: { cleanupExpired } as unknown as UploadSessionService,
    });

    await expect(runtime.tick()).resolves.toEqual({ expired: 0, failed: 1, skipped: false });
    expect(onError).toHaveBeenCalledWith(error);
    await expect(runtime.tick()).resolves.toEqual({ expired: 1, failed: 0, skipped: false });
  });
});

describe("API upload-session assembly", () => {
  it("stays unready when the explicitly enabled durable dependencies are incomplete", async () => {
    const assembly = await createApiUploadSessionAssembly({
      adapter: { objectStorage: {} as never },
      capabilityV2Configured: false,
      config: requiredConfig(),
      repositories: { usesDatabaseRepositories: false },
    });

    expect(assembly).toMatchObject({ ready: false });
    expect(assembly?.sessions).toBeUndefined();
  });

  it("assembles the publication service, bucket lifecycle, and cleanup runtime", async () => {
    const ensureLifecycle = vi.fn(async () => undefined);
    const assembly = await createApiUploadSessionAssembly({
      adapter: {
        objectStorage: {
          directUpload: { ensureIncompleteMultipartUploadLifecycle: ensureLifecycle },
        } as never,
      },
      capabilityV2Configured: true,
      config: requiredConfig(),
      repositories: {
        assets: {} as never,
        capabilityGrants: {} as never,
        compilationJobs: {
          releaseDispatch: vi.fn(),
          start: vi.fn(),
        } as never,
        logicalDocuments: {} as never,
        manifests: {} as never,
        paths: {} as never,
        sessions: {} as never,
        usesDatabaseRepositories: true,
      },
    });

    expect(assembly).toMatchObject({ ready: true, sessions: expect.any(Object) });
    expect(ensureLifecycle).toHaveBeenCalledWith({ daysAfterInitiation: 3 });
    assembly?.start();
    assembly?.stop();
  });

  it("fails readiness instead of exposing routes when bucket lifecycle setup fails", async () => {
    const error = new Error("lifecycle denied");
    const onError = vi.fn();
    const assembly = await createApiUploadSessionAssembly({
      adapter: {
        objectStorage: {
          directUpload: {
            ensureIncompleteMultipartUploadLifecycle: vi.fn(async () => {
              throw error;
            }),
          },
        } as never,
      },
      capabilityV2Configured: true,
      config: requiredConfig(),
      onError,
      repositories: {
        assets: {} as never,
        capabilityGrants: {} as never,
        compilationJobs: { releaseDispatch: vi.fn(), start: vi.fn() } as never,
        logicalDocuments: {} as never,
        manifests: {} as never,
        paths: {} as never,
        sessions: {} as never,
        usesDatabaseRepositories: true,
      },
    });

    expect(assembly).toMatchObject({ ready: false });
    expect(onError).toHaveBeenCalledWith(error);
  });
});

function requiredConfig() {
  return {
    allowedOrigins: ["https://console.example.com"],
    cleanupBatchSize: 25,
    cleanupIntervalMs: 30_000,
    cleanupStaleMs: 120_000,
    incompleteMultipartDays: 3,
    maxFileBytes: 1_073_741_824,
    multipartPartSizeBytes: 8_388_608,
    multipartThresholdBytes: 16_777_216,
    presignTtlSeconds: 600,
    sessionTtlMs: 3_600_000,
    smallFileFallbackMaxBytes: 4_194_304,
  } as const;
}
