import { describe, expect, it } from "vitest";

import { createDurableDeletionFingerprinter } from "./durable-deletion-fingerprinter";

describe("durable deletion fingerprinter", () => {
  it("is stable within one scope and domain-separated everywhere else", () => {
    const fingerprint = createDurableDeletionFingerprinter(new Uint8Array(32).fill(41));
    const input = {
      knowledgeSpaceId: "space-1",
      operationKey: "delete-space-idempotency-1",
      purpose: "name_challenge" as const,
      tenantId: "tenant-1",
      value: "Docs",
    };
    const digest = fingerprint(input);

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(fingerprint(input)).toBe(digest);
    expect(fingerprint(input)).toBe(digest);
    expect(fingerprint({ ...input, operationKey: "delete-space-idempotency-2" })).not.toBe(digest);
    expect(fingerprint({ ...input, knowledgeSpaceId: "space-2" })).not.toBe(digest);
    expect(fingerprint({ ...input, purpose: "request_payload" })).not.toBe(digest);
    expect(fingerprint({ ...input, tenantId: "tenant-2" })).not.toBe(digest);
  });

  it("requires a deployment-strength key", () => {
    expect(() => createDurableDeletionFingerprinter(new Uint8Array(31))).toThrow(
      "at least 32 bytes",
    );
  });
});
