import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createNodePlatformAdapter } from "./node";

const describeMinio = process.env.RUN_MINIO_INTEGRATION === "1" ? describe : describe.skip;

describeMinio("MinIO object storage integration", () => {
  it("round-trips objects through the Node platform S3-compatible adapter", async () => {
    const adapter = createNodePlatformAdapter({ env: readMinioEnv() });
    const key = `integration-smoke/${Date.now()}-${randomUUID()}.txt`;
    const body = new TextEncoder().encode("knowledge minio smoke");

    expect(adapter.objectStorage.kind).toBe("s3-compatible");
    await expect(adapter.objectStorage.health()).resolves.toBe(true);

    try {
      const putMetadata = await adapter.objectStorage.putObject({
        body,
        contentType: "text/plain",
        key,
        metadata: { smoke: "minio" },
      });

      expect(putMetadata).toEqual({
        contentType: "text/plain",
        key,
        metadata: { smoke: "minio" },
        sizeBytes: body.byteLength,
      });

      const firstRead = await adapter.objectStorage.getObject(key);
      expect(firstRead).toEqual(body);

      if (!firstRead) {
        throw new Error("Expected MinIO object body to be readable");
      }

      firstRead[0] = 0;
      await expect(adapter.objectStorage.getObject(key)).resolves.toEqual(body);
      await expect(adapter.objectStorage.headObject(key)).resolves.toEqual({
        contentType: "text/plain",
        key,
        metadata: { smoke: "minio" },
        sizeBytes: body.byteLength,
      });

      const listed = await adapter.objectStorage.listObjects({
        limit: 10,
        prefix: "integration-smoke/",
      });

      expect(listed.objects.some((object) => object.key === key)).toBe(true);

      await adapter.objectStorage.deleteObject(key);

      await expect(adapter.objectStorage.getObject(key)).resolves.toBeNull();
      await expect(adapter.objectStorage.headObject(key)).resolves.toBeNull();
    } finally {
      await adapter.objectStorage.deleteObject(key).catch(() => undefined);
    }
  });
});

function readMinioEnv(): Readonly<Record<string, string>> {
  return {
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY ?? "knowledge",
    MINIO_BUCKET: process.env.MINIO_BUCKET ?? "knowledge-fs",
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? "http://127.0.0.1:9000",
    MINIO_REGION: process.env.MINIO_REGION ?? "us-east-1",
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY ?? "knowledge-secret",
  };
}
