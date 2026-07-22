import { createDefaultKnowledgeSpaceManifest } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceQuotaExceededError,
  KnowledgeSpaceQuotaUsageTruncatedError,
  enforceKnowledgeSpaceQuotaAdmission,
} from "./knowledge-space-quota-admission";
import type { KnowledgeSpaceQuotaUsage } from "./knowledge-space-quota-usage";

const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("enforceKnowledgeSpaceQuotaAdmission", () => {
  it("skips usage reads when supported quota limits are disabled", async () => {
    let reads = 0;

    await enforceKnowledgeSpaceQuotaAdmission({
      delta: { rawDocumentBytes: 100 },
      knowledgeSpaceId,
      manifest: manifest(),
      projectionVersion: 1,
      usageReader: {
        read: async () => {
          reads += 1;
          return usage();
        },
      },
    });

    expect(reads).toBe(0);
  });

  it("rejects projected usage above manifest quota limits", async () => {
    await expect(
      enforceKnowledgeSpaceQuotaAdmission({
        delta: { rawDocumentBytes: 3 },
        knowledgeSpaceId,
        manifest: manifest({ maxRawDocumentBytes: 10 }),
        projectionVersion: 1,
        usageReader: {
          read: async () => usage({ rawDocumentBytes: 8 }),
        },
      }),
    ).rejects.toThrow(KnowledgeSpaceQuotaExceededError);
  });

  it("fails closed when bounded usage reads are truncated", async () => {
    await expect(
      enforceKnowledgeSpaceQuotaAdmission({
        knowledgeSpaceId,
        manifest: manifest({ maxNodeCount: 10 }),
        projectionVersion: 1,
        usageReader: {
          read: async () => usage({ nodeCount: 1, truncated: true }),
        },
      }),
    ).rejects.toThrow(KnowledgeSpaceQuotaUsageTruncatedError);
  });
});

function manifest(
  quotaPolicy: Partial<ReturnType<typeof createDefaultKnowledgeSpaceManifest>["quotaPolicy"]> = {},
) {
  const base = createDefaultKnowledgeSpaceManifest({
    createdAt: "2026-05-27T12:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18fb100",
    knowledgeSpaceId,
    tenantId: "tenant-1",
    updatedAt: "2026-05-27T12:00:00.000Z",
  });

  return {
    ...base,
    quotaPolicy: {
      ...base.quotaPolicy,
      ...quotaPolicy,
    },
  };
}

function usage(overrides: Partial<KnowledgeSpaceQuotaUsage> = {}): KnowledgeSpaceQuotaUsage {
  return {
    artifactBytes: 0,
    artifactCount: 0,
    documentCount: 0,
    nodeCount: 0,
    projectionCount: 0,
    rawDocumentBytes: 0,
    segmentCount: 0,
    truncated: false,
    ...overrides,
  };
}
