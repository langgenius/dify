import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  createRetainedParseArtifactAdmission,
  estimateParseArtifactRetainedBytes,
} from "./retained-parse-artifact-admission";

describe("createRetainedParseArtifactAdmission", () => {
  it("enforces the artifact-count limit independently of the byte budget", async () => {
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 2,
      maxRetainedBytes: 1024 * 1024,
    });
    const artifact = parseArtifact("small");
    let active = 0;
    let maxActive = 0;
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });

    const work = Array.from({ length: 3 }, async () => {
      const lease = await admission.acquire(artifact);
      entered += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await barrier;
      } finally {
        active -= 1;
        lease.release();
      }
    });

    await waitUntil(() => entered === 2);
    expect(entered).toBe(2);
    expect(maxActive).toBe(2);
    release();
    await Promise.all(work);
    expect(entered).toBe(3);
  });

  it("admits mixed artifact sizes only while their conservative byte charges fit", async () => {
    const small = parseArtifact("s".repeat(64));
    const large = parseArtifact("l".repeat(4_096));
    const smallBytes = estimateParseArtifactRetainedBytes(small);
    const largeBytes = estimateParseArtifactRetainedBytes(large);
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 4,
      maxRetainedBytes: smallBytes + largeBytes,
    });
    const entered: string[] = [];
    let releaseLarge!: () => void;
    const largeBarrier = new Promise<void>((resolve) => {
      releaseLarge = resolve;
    });

    const firstLarge = admission.acquire(large).then(async (lease) => {
      entered.push("large-1");
      try {
        await largeBarrier;
      } finally {
        lease.release();
      }
    });
    const smallWork = admission.acquire(small).then((lease) => {
      entered.push("small");
      lease.release();
    });
    const secondLarge = admission.acquire(large).then((lease) => {
      entered.push("large-2");
      lease.release();
    });

    await waitUntil(() => entered.length === 2);
    expect(entered).toEqual(["large-1", "small"]);
    releaseLarge();
    await Promise.all([firstLarge, smallWork, secondLarge]);
    expect(entered).toEqual(["large-1", "small", "large-2"]);
  });

  it("removes a cancelled queued artifact without entering downstream work", async () => {
    const artifact = parseArtifact("queued");
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 1,
      maxRetainedBytes: 1024 * 1024,
    });
    const held = await admission.acquire(artifact);
    const controller = new AbortController();
    let entered = false;
    const queued = admission.acquire(artifact, { signal: controller.signal }).then((lease) => {
      entered = true;
      lease.release();
    });

    controller.abort(new Error("compilation cancelled while waiting for artifact memory"));
    await expect(queued).rejects.toThrow("compilation cancelled while waiting for artifact memory");
    expect(entered).toBe(false);
    held.release();
  });

  it("cleans an admitted waiter's abort listener and rejects an already-cancelled caller", async () => {
    const artifact = parseArtifact("queued with signal");
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 1,
      maxRetainedBytes: 1024 * 1024,
    });
    const held = await admission.acquire(artifact);
    const queuedController = new AbortController();
    const queued = admission.acquire(artifact, { signal: queuedController.signal });
    held.release();
    const queuedLease = await queued;
    queuedController.abort(new Error("abort after admission"));
    queuedLease.release();

    const cancelledController = new AbortController();
    cancelledController.abort(new Error("cancelled before admission"));
    await expect(
      admission.acquire(artifact, { signal: cancelledController.signal }),
    ).rejects.toThrow("cancelled before admission");
  });

  it("releases an immediately admitted lease when cancellation wins the await race", async () => {
    const artifact = parseArtifact("abort race");
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 1,
      maxRetainedBytes: 1024 * 1024,
    });
    const reason = new Error("cancelled as admission resolved");
    let throwChecks = 0;
    const racingSignal = {
      aborted: true,
      addEventListener: () => undefined,
      reason,
      removeEventListener: () => undefined,
      throwIfAborted: () => {
        throwChecks += 1;
        if (throwChecks > 1) throw reason;
      },
    } as unknown as AbortSignal;

    await expect(admission.acquire(artifact, { signal: racingSignal })).rejects.toThrow(
      "cancelled as admission resolved",
    );
    const following = await admission.acquire(artifact);
    following.release();
  });

  it("releases capacity after downstream failure", async () => {
    const artifact = parseArtifact("failure");
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 1,
      maxRetainedBytes: 1024 * 1024,
    });
    const first = await admission.acquire(artifact);
    first.release();
    first.release();

    const second = await admission.acquire(artifact);
    second.release();
  });

  it("lets an artifact larger than the configured byte budget run exclusively", async () => {
    const small = parseArtifact("small");
    const oversized = parseArtifact("x".repeat(8_192));
    const admission = createRetainedParseArtifactAdmission({
      maxConcurrentArtifacts: 4,
      maxRetainedBytes: estimateParseArtifactRetainedBytes(small),
    });
    const first = await admission.acquire(small);
    let oversizedEntered = false;
    const queuedOversized = admission.acquire(oversized).then((lease) => {
      oversizedEntered = true;
      return lease;
    });

    await Promise.resolve();
    expect(oversizedEntered).toBe(false);
    first.release();
    const oversizedLease = await queuedOversized;
    expect(oversizedEntered).toBe(true);

    let followingEntered = false;
    const following = admission.acquire(small).then((lease) => {
      followingEntered = true;
      lease.release();
    });
    await Promise.resolve();
    expect(followingEntered).toBe(false);
    oversizedLease.release();
    await following;
    expect(followingEntered).toBe(true);
  });
});

describe("estimateParseArtifactRetainedBytes", () => {
  it("walks artifact content without serializing or copying it and respects a scan cap", () => {
    const artifact = parseArtifact("content".repeat(1_000));
    const originalStringify = JSON.stringify;
    JSON.stringify = () => {
      throw new Error("estimation must not serialize the artifact");
    };
    try {
      expect(estimateParseArtifactRetainedBytes(artifact, { capBytes: 1_024 })).toBe(1_024);
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it("conservatively charges supported metadata value shapes and excessive nesting", () => {
    const inheritedMetadata = Object.create({ inherited: "not an own property" }) as Record<
      string,
      unknown
    >;
    Object.assign(inheritedMetadata, {
      arrayBuffer: new ArrayBuffer(8),
      bigint: 1n,
      boolean: true,
      bytes: new Uint8Array(8),
      nil: null,
      number: 1,
      symbol: Symbol("metadata"),
      undefined,
    });
    const artifact = { ...parseArtifact("metadata"), metadata: inheritedMetadata };
    expect(estimateParseArtifactRetainedBytes(artifact)).toBeGreaterThan(0);

    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 65; depth += 1) nested = { nested };
    expect(
      estimateParseArtifactRetainedBytes(
        { ...parseArtifact("deep"), metadata: nested },
        { capBytes: 4_096 },
      ),
    ).toBe(4_096);
  });

  it("rejects invalid admission and estimator budgets", () => {
    expect(() =>
      createRetainedParseArtifactAdmission({
        maxConcurrentArtifacts: 0,
        maxRetainedBytes: 1024,
      }),
    ).toThrow("maxConcurrentArtifacts must be a positive safe integer");
    expect(() =>
      createRetainedParseArtifactAdmission({
        maxConcurrentArtifacts: 1,
        maxRetainedBytes: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("maxRetainedBytes must be a positive safe integer");
    expect(() =>
      estimateParseArtifactRetainedBytes(parseArtifact("invalid"), { capBytes: 0 }),
    ).toThrow("capBytes must be a positive safe integer");
  });
});

function parseArtifact(text: string): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "text",
    createdAt: "2026-08-31T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f9101",
    elements: [
      {
        id: "element-1",
        metadata: { language: "zh-CN" },
        sectionPath: ["Sheet 1"],
        text,
        type: "paragraph",
      },
    ],
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f9102",
    metadata: { source: "test" },
    parser: "unstructured",
    version: 1,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not reached");
}
