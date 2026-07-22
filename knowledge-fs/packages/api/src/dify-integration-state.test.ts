import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DifyIntegrationActivationConflictError,
  decideDifyIntegrationActivation,
} from "./dify-integration-state";

const activatedAt = "2026-07-21T12:00:00.000Z";
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const activationIdA = canonicalActivationId(7, "tenant-a", digestA);

describe("Dify Workspace integration activation", () => {
  it("creates the first immutable active state", () => {
    const decision = decideDifyIntegrationActivation(null, activation(), activatedAt);

    expect(decision).toEqual({
      kind: "insert",
      result: {
        applied: true,
        replayed: false,
        state: {
          activatedAt,
          activationId: activationIdA,
          activationRevision: 7,
          namespaceId: "tenant-a",
          sourceRevisionDigest: digestA,
          updatedAt: activatedAt,
        },
      },
    });
  });

  it("replays the exact activation without mutating evidence", () => {
    const existing = state();

    expect(
      decideDifyIntegrationActivation(existing, activation(), "2026-07-21T12:01:00.000Z"),
    ).toEqual({
      kind: "replay",
      result: { applied: false, replayed: true, state: existing },
    });
  });

  it("advances only to a higher revision while preserving first activation time", () => {
    const decision = decideDifyIntegrationActivation(
      state(),
      activation({
        activationRevision: 8,
        sourceRevisionDigest: digestB,
      }),
      "2026-07-21T12:02:00.000Z",
    );

    expect(decision).toEqual({
      kind: "update",
      previousRevision: 7,
      result: {
        applied: true,
        replayed: false,
        state: {
          ...state(),
          activationId: canonicalActivationId(8, "tenant-a", digestB),
          activationRevision: 8,
          sourceRevisionDigest: digestB,
          updatedAt: "2026-07-21T12:02:00.000Z",
        },
      },
    });
  });

  it.each([
    ["stale revision", activation({ activationRevision: 6 })],
    ["same revision with another digest", activation({ sourceRevisionDigest: digestB })],
  ])("rejects %s", (_name, input) => {
    expect(() => decideDifyIntegrationActivation(state(), input, activatedAt)).toThrow(
      DifyIntegrationActivationConflictError,
    );
  });

  it.each([
    activation({ activationId: " " }),
    activation({ activationRevision: 0 }),
    activation({ activationRevision: Number.MAX_SAFE_INTEGER + 1 }),
    activation({ namespaceId: "" }),
    activation({ sourceRevisionDigest: "sha256:not-a-digest" }),
  ])("rejects malformed activation input before persistence", (input) => {
    expect(() => decideDifyIntegrationActivation(null, input, activatedAt)).toThrow(TypeError);
  });

  it("rejects an activation id that is not the canonical evidence-envelope digest", () => {
    expect(() =>
      decideDifyIntegrationActivation(
        null,
        activation({ activationId: `sha256:${"f".repeat(64)}` }),
        activatedAt,
      ),
    ).toThrow("canonical activation evidence");
  });
});

function activation(
  overrides: Partial<{
    activationId: string;
    activationRevision: number;
    namespaceId: string;
    sourceRevisionDigest: string;
  }> = {},
) {
  const activationRevision = overrides.activationRevision ?? 7;
  const namespaceId = overrides.namespaceId ?? "tenant-a";
  const sourceRevisionDigest = overrides.sourceRevisionDigest ?? digestA;
  return {
    activationId:
      overrides.activationId ??
      canonicalActivationId(activationRevision, namespaceId, sourceRevisionDigest),
    activationRevision,
    namespaceId,
    sourceRevisionDigest,
  };
}

function state() {
  return {
    activatedAt,
    activationId: activationIdA,
    activationRevision: 7,
    namespaceId: "tenant-a",
    sourceRevisionDigest: digestA,
    updatedAt: activatedAt,
  };
}

function canonicalActivationId(
  activationRevision: number,
  namespaceId: string,
  sourceRevisionDigest: string,
): string {
  const canonicalJson = JSON.stringify({
    activationRevision,
    namespaceId,
    sourceRevisionDigest,
  });
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}
