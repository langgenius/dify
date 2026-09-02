import { createHash } from "node:crypto";

import { type KnowledgeSpaceModelSelection, stableJson } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { ModelCapabilityCatalog, ModelCapabilitySnapshot } from "./model-capability-preflight";
import { createModelInputModalityResolver } from "./model-input-modality-resolver";

const selection: KnowledgeSpaceModelSelection = {
  model: "vision-model",
  pluginId: "langgenius/vision",
  provider: "vision",
};

describe("createModelInputModalityResolver", () => {
  it("uses frozen modalities without consulting the mutable model catalog", async () => {
    const resolve = vi.fn();
    const resolver = createModelInputModalityResolver({ catalog: catalog(resolve) });

    await expect(
      resolver.resolve({
        snapshot: snapshot({ inputModalities: ["text", "image"] }),
        tenantId: "t",
      }),
    ).resolves.toEqual(["text", "image"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("backfills legacy modalities only when the current catalog matches the frozen digest", async () => {
    const capabilities = { features: ["vision"] };
    const resolve = vi.fn(async () => entry(capabilities));
    const resolver = createModelInputModalityResolver({ catalog: catalog(resolve) });
    const legacy = snapshot({ capabilityDigest: legacyDigest(capabilities) });

    await expect(resolver.resolve({ snapshot: legacy, tenantId: "t" })).resolves.toEqual([
      "text",
      "image",
    ]);
    await expect(resolver.resolve({ snapshot: legacy, tenantId: "t" })).resolves.toEqual([
      "text",
      "image",
    ]);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("fails closed to text when a legacy model declaration drifted or is unavailable", async () => {
    const capabilities = { features: ["vision"] };
    const unavailableResolve = vi.fn(async () => {
      throw new Error("catalog unavailable");
    });
    const drifted = createModelInputModalityResolver({
      catalog: catalog(async () => entry({ features: ["vision", "new-feature"] })),
    });
    const unavailable = createModelInputModalityResolver({
      catalog: catalog(unavailableResolve),
    });
    const legacy = snapshot({ capabilityDigest: legacyDigest(capabilities) });

    await expect(drifted.resolve({ snapshot: legacy, tenantId: "t" })).resolves.toEqual(["text"]);
    await expect(unavailable.resolve({ snapshot: legacy, tenantId: "t" })).resolves.toEqual([
      "text",
    ]);
    await expect(unavailable.resolve({ snapshot: legacy, tenantId: "t" })).resolves.toEqual([
      "text",
    ]);
    expect(unavailableResolve).toHaveBeenCalledOnce();
  });

  it("fails closed without a catalog call when an older snapshot has no immutable identity", async () => {
    const resolve = vi.fn();
    const resolver = createModelInputModalityResolver({ catalog: catalog(resolve) });

    await expect(
      resolver.resolve({ snapshot: { source: "legacy-preflight" }, tenantId: "t" }),
    ).resolves.toEqual(["text"]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects caller cancellation and never converts it into a text-only cache entry", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const resolve = vi.fn(
      async (input: Parameters<ModelCapabilityCatalog["resolve"]>[0]) =>
        new Promise<never>((_resolve, reject) => {
          providerSignal = input.signal;
          const signal = input.signal;
          if (!signal) throw new Error("resolver did not forward cancellation");
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );
    const resolver = createModelInputModalityResolver({ catalog: catalog(resolve) });
    const canceled = new Error("lease lost");
    const pending = resolver.resolve({
      signal: controller.signal,
      snapshot: snapshot({ capabilityDigest: legacyDigest({ features: ["vision"] }) }),
      tenantId: "t",
    });
    await vi.waitFor(() => expect(providerSignal).toBeDefined());

    controller.abort(canceled);

    await expect(pending).rejects.toBe(canceled);
  });

  it("expires negative cache entries and keeps the LRU bounded", async () => {
    let now = 1_000;
    const resolve = vi.fn(async () => null);
    const resolver = createModelInputModalityResolver({
      catalog: catalog(resolve),
      maxEntries: 1,
      now: () => now,
      ttlMs: 10,
    });
    const first = snapshot({ capabilityDigest: legacyDigest({ features: [] }) });
    const second = snapshot({
      capabilityDigest: `sha256:${"c".repeat(64)}`,
      selection: { ...selection, model: "other-model" },
    });

    await resolver.resolve({ snapshot: first, tenantId: "t" });
    await resolver.resolve({ snapshot: second, tenantId: "t" });
    await resolver.resolve({ snapshot: first, tenantId: "t" });
    now += 11;
    await resolver.resolve({ snapshot: first, tenantId: "t" });

    expect(resolve).toHaveBeenCalledTimes(4);
  });

  it("validates cache bounds", () => {
    expect(() =>
      createModelInputModalityResolver({ catalog: catalog(vi.fn()), maxEntries: 0 }),
    ).toThrow("maxEntries must be a positive integer");
    expect(() => createModelInputModalityResolver({ catalog: catalog(vi.fn()), ttlMs: 0 })).toThrow(
      "ttlMs must be a positive integer",
    );
  });
});

function snapshot(override: Partial<ModelCapabilitySnapshot> = {}): ModelCapabilitySnapshot {
  return {
    capabilityDigest: `sha256:${"b".repeat(64)}`,
    checkedAt: "2026-09-01T12:00:00.000Z",
    kind: "reasoning",
    pluginUniqueIdentifier: "langgenius/vision:1.0.0@sha256:installed",
    pluginVersion: "1.0.0",
    schemaFingerprint: `sha256:${"a".repeat(64)}`,
    selection,
    ...override,
  };
}

function legacyDigest(capabilities: Readonly<Record<string, unknown>>): string {
  const value = snapshot();
  const {
    capabilityDigest: _digest,
    checkedAt: _checkedAt,
    inputModalities: _modalities,
    ...material
  } = value;
  return `sha256:${createHash("sha256")
    .update(stableJson({ ...material, capabilities }))
    .digest("hex")}`;
}

function entry(capabilities: Readonly<Record<string, unknown>>) {
  return {
    capabilities,
    kinds: ["reasoning" as const],
    model: selection.model,
    pluginId: selection.pluginId,
    pluginUniqueIdentifier: "langgenius/vision:1.0.0@sha256:installed",
    pluginVersion: "1.0.0",
    provider: selection.provider,
    schemaFingerprint: `sha256:${"a".repeat(64)}`,
  };
}

function catalog(resolve: ModelCapabilityCatalog["resolve"]): ModelCapabilityCatalog {
  return {
    list: async () => ({ items: [] }),
    resolve,
  };
}
