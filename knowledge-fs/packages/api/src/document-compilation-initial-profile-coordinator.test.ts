import { type KnowledgeSpaceManifest, createDefaultKnowledgeSpaceManifest } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  DocumentCompilationAttempt,
  DocumentCompilationProfileReference,
} from "./document-compilation-attempt-repository";
import { createDocumentCompilationInitialProfileCoordinator } from "./document-compilation-initial-profile-coordinator";
import type {
  DocumentCompilationExecutionContext,
  DocumentCompilationProcessingError,
} from "./document-compilation-runtime";
import type { KnowledgeSpaceProfileHead } from "./knowledge-space-profile-repository";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import {
  ModelCapabilityPreflightError,
  type ModelCapabilitySnapshot,
} from "./model-capability-preflight";

const timestamp = "2026-07-15T12:00:00.000Z";
const tenantId = "tenant-a";
const knowledgeSpaceId = "10000000-0000-4000-8000-000000000001";
const subjectId = "subject-owner";
const embeddingSelection = {
  model: "embedding-dynamic",
  pluginId: "plugin-embedding",
  provider: "plugin-daemon",
};
const reasoningSelection = {
  model: "reasoning-model",
  pluginId: "plugin-reasoning",
  provider: "plugin-daemon",
};
const rerankSelection = {
  model: "rerank-model",
  pluginId: "plugin-rerank",
  provider: "plugin-daemon",
};

describe("first-document model profile activation", () => {
  it("observes the selected embedding dimension and binds the verified tuple before work", async () => {
    const harness = createHarness("fast");

    await harness.coordinator.ensureReady(harness.execution);

    expect(harness.preflight.verify).toHaveBeenCalledTimes(3);
    expect(harness.activations.activate).not.toHaveBeenCalled();
    expect(harness.activations.activateInitialTuple).toHaveBeenCalledTimes(1);
    expect(harness.activations.activateInitialTuple).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPendingConfiguration: { digest: "a".repeat(64), revision: 1 },
        embedding: expect.objectContaining({
          snapshot: expect.objectContaining({ dimension: 3_072 }),
        }),
        requiredAccess: "write",
        retrieval: expect.objectContaining({
          snapshot: expect.objectContaining({ defaultMode: "fast" }),
        }),
      }),
    );
    expect(harness.bound?.embeddingProfile?.kind).toBe("embedding");
    expect(harness.bound?.retrievalProfile.kind).toBe("retrieval");
    expect(harness.manifest.pendingModelConfiguration).toBeUndefined();
  });

  it("activates Research with reasoning only and never probes embedding, rerank, or graph", async () => {
    const harness = createHarness("research");

    await harness.coordinator.ensureReady(harness.execution);

    expect(harness.preflight.verify).toHaveBeenCalledTimes(1);
    expect(harness.preflight.verify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reasoning" }),
    );
    expect(harness.activations.activateInitialTuple).toHaveBeenCalledTimes(1);
    expect(harness.activations.activateInitialTuple).toHaveBeenCalledWith(
      expect.objectContaining({
        retrieval: expect.objectContaining({
          snapshot: expect.objectContaining({ defaultMode: "research" }),
        }),
      }),
    );
    expect(harness.activations.activateInitialTuple.mock.calls[0]?.[0].embedding).toBeUndefined();
    expect(harness.bound?.embeddingProfile).toBeUndefined();
  });

  it("persists a safe terminal validation state without creating a profile head", async () => {
    const harness = createHarness("fast");
    harness.preflight.verify.mockRejectedValueOnce(
      new ModelCapabilityPreflightError(
        "MODEL_SELECTION_NOT_FOUND",
        "daemon endpoint and credential detail must not escape",
      ),
    );

    await expect(harness.coordinator.ensureReady(harness.execution)).rejects.toMatchObject({
      code: "MODEL_SELECTION_NOT_FOUND",
      message: "The selected model could not be validated",
      retryable: false,
    } satisfies Partial<DocumentCompilationProcessingError>);

    expect(harness.activations.activateInitialTuple).not.toHaveBeenCalled();
    expect(harness.manifest.pendingModelConfiguration).toMatchObject({
      failure: {
        code: "MODEL_SELECTION_NOT_FOUND",
        retryable: false,
      },
      state: "validation-failed",
    });
    expect(JSON.stringify(harness.manifest.pendingModelConfiguration)).not.toContain("credential");
  });

  it("retries a validation-failure manifest CAS before ending the attempt", async () => {
    const harness = createHarness("fast");
    harness.preflight.verify.mockRejectedValueOnce(
      new ModelCapabilityPreflightError("MODEL_SELECTION_NOT_FOUND", "missing model"),
    );
    harness.manifests.update.mockResolvedValueOnce(null as unknown as KnowledgeSpaceManifest);

    await expect(harness.coordinator.ensureReady(harness.execution)).rejects.toMatchObject({
      code: "MODEL_SELECTION_NOT_FOUND",
      retryable: false,
    });

    expect(harness.manifests.update).toHaveBeenCalledTimes(2);
    expect(harness.manifest.pendingModelConfiguration?.state).toBe("validation-failed");
  });

  it("retries compilation instead of recording a failure for a superseded pending revision", async () => {
    const harness = createHarness("fast");
    harness.preflight.verify.mockImplementationOnce(async () => {
      harness.replacePendingRevision(2);
      throw new ModelCapabilityPreflightError("MODEL_SELECTION_NOT_FOUND", "old model missing");
    });

    await expect(harness.coordinator.ensureReady(harness.execution)).rejects.toMatchObject({
      code: "MODEL_CONFIGURATION_STALE",
      retryable: true,
    });

    expect(harness.manifest.pendingModelConfiguration).toMatchObject({
      revision: 2,
      state: "pending-validation",
    });
  });

  it("classifies transient profile-state reads as retryable compilation failures", async () => {
    const harness = createHarness("fast");
    harness.profiles.getHead.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(harness.coordinator.ensureReady(harness.execution)).rejects.toMatchObject({
      code: "MODEL_PROFILE_STATE_READ_FAILED",
      retryable: true,
    });

    expect(harness.preflight.verify).not.toHaveBeenCalled();
  });

  it("retries when the activated tuple cannot be fenced onto the leased attempt", async () => {
    const harness = createHarness("fast");
    harness.execution.bindInitialProfiles = vi.fn(async () => {
      throw new Error("database unavailable");
    });

    await expect(harness.coordinator.ensureReady(harness.execution)).rejects.toMatchObject({
      code: "MODEL_PROFILE_BIND_FAILED",
      retryable: true,
    });
  });
});

function createHarness(mode: "fast" | "research") {
  let manifest = createDefaultKnowledgeSpaceManifest({
    createdAt: timestamp,
    id: "10000000-0000-4000-8000-000000000002",
    knowledgeSpaceId,
    pendingModelConfiguration: {
      digest: "a".repeat(64),
      ...(mode === "fast" ? { embeddingSelection } : {}),
      retrievalProfile: {
        defaultMode: mode,
        reasoningModel: reasoningSelection,
        rerank: mode === "fast" ? { enabled: true, model: rerankSelection } : { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 10,
      },
      revision: 1,
      state: "pending-validation",
    },
    tenantId,
    updatedAt: timestamp,
  });
  const heads = new Map<"embedding" | "retrieval", KnowledgeSpaceProfileHead>();
  const preflight = {
    verify: vi.fn(async (input: { kind: "embedding" | "reasoning" | "rerank" }) =>
      capability(input.kind),
    ),
  };
  const profiles = {
    getHead: vi.fn(
      async (input: { kind: "embedding" | "retrieval" }) => heads.get(input.kind) ?? null,
    ),
  };
  const manifests = {
    get: vi.fn(async () => manifest),
    update: vi.fn(async (input: { patch: Partial<KnowledgeSpaceManifest> }) => {
      manifest = { ...manifest, ...input.patch } as KnowledgeSpaceManifest;
      return manifest;
    }),
  };
  const activations = {
    activate: vi.fn(async () => {
      throw new Error("single-profile activation is not used by initial compilation");
    }),
    activateInitialTuple: vi.fn(
      async (
        input: Parameters<
          Parameters<
            typeof createDocumentCompilationInitialProfileCoordinator
          >[0]["activations"]["activateInitialTuple"]
        >[0],
      ) => {
        const createHead = (
          kind: "embedding" | "retrieval",
          snapshot: KnowledgeSpaceProfileHead["profile"]["snapshot"],
          capabilitySnapshot: Readonly<Record<string, unknown>>,
        ): KnowledgeSpaceProfileHead => {
          const revisionId =
            kind === "embedding"
              ? "10000000-0000-4000-8000-000000000010"
              : "10000000-0000-4000-8000-000000000011";
          return {
            activeRevision: snapshot.revision,
            createdAt: timestamp,
            id:
              kind === "embedding"
                ? "10000000-0000-4000-8000-000000000012"
                : "10000000-0000-4000-8000-000000000013",
            kind,
            knowledgeSpaceId,
            profile: {
              activatedAt: timestamp,
              capabilitySnapshot,
              capabilitySnapshotDigest: "b".repeat(64),
              createdAt: timestamp,
              createdBySubjectId: subjectId,
              id: revisionId,
              kind,
              knowledgeSpaceId,
              model: kind === "embedding" ? embeddingSelection.model : reasoningSelection.model,
              pluginId:
                kind === "embedding" ? embeddingSelection.pluginId : reasoningSelection.pluginId,
              provider: "plugin-daemon",
              revision: snapshot.revision,
              snapshot,
              snapshotDigest: knowledgeSpaceProfileSnapshotDigest(snapshot),
              state: "active",
              tenantId,
              updatedAt: timestamp,
            },
            profileRevisionId: revisionId,
            rowVersion: 1,
            tenantId,
            updatedAt: timestamp,
          };
        };
        const embeddingHead = input.embedding
          ? createHead("embedding", input.embedding.snapshot, input.embedding.capabilitySnapshot)
          : undefined;
        const retrievalHead = createHead(
          "retrieval",
          input.retrieval.snapshot,
          input.retrieval.capabilitySnapshot,
        );
        if (embeddingHead) heads.set("embedding", embeddingHead);
        heads.set("retrieval", retrievalHead);
        manifest = {
          ...manifest,
          ...(input.embedding ? { embeddingProfile: input.embedding.snapshot } : {}),
          manifestVersion: manifest.manifestVersion + 1,
          pendingModelConfiguration: undefined,
          retrievalProfile: input.retrieval.snapshot,
        };
        return {
          ...(embeddingHead ? { embeddingHead } : {}),
          manifestVersion: manifest.manifestVersion,
          replayed: false,
          retrievalHead,
        };
      },
    ),
  };
  const attempt = compilationAttempt();
  let bound:
    | {
        readonly embeddingProfile?: DocumentCompilationProfileReference | undefined;
        readonly retrievalProfile: DocumentCompilationProfileReference;
      }
    | undefined;
  const execution: DocumentCompilationExecutionContext = {
    advance: vi.fn(),
    attempt,
    bindInitialProfiles: vi.fn(async (input) => {
      bound = input;
      return { ...attempt, ...input };
    }),
    heartbeat: vi.fn(),
    signal: new AbortController().signal,
    withLeaseSnapshot: vi.fn(async (operation) => operation(attempt)),
  };
  const coordinator = createDocumentCompilationInitialProfileCoordinator({
    activations,
    manifests,
    now: () => timestamp,
    preflight,
    profiles,
  });

  return {
    activations,
    get bound() {
      return bound;
    },
    coordinator,
    execution,
    get manifest() {
      return manifest;
    },
    manifests,
    preflight,
    profiles,
    replacePendingRevision(revision: number) {
      if (!manifest.pendingModelConfiguration) throw new Error("test pending config missing");
      manifest = {
        ...manifest,
        manifestVersion: manifest.manifestVersion + 1,
        pendingModelConfiguration: {
          ...manifest.pendingModelConfiguration,
          digest: revision === 2 ? "e".repeat(64) : manifest.pendingModelConfiguration.digest,
          revision,
        },
      };
    },
  };
}

function capability(kind: "embedding" | "reasoning" | "rerank"): ModelCapabilitySnapshot {
  const selection =
    kind === "embedding"
      ? embeddingSelection
      : kind === "reasoning"
        ? reasoningSelection
        : rerankSelection;
  return {
    capabilityDigest: `sha256:${"c".repeat(64)}`,
    checkedAt: timestamp,
    ...(kind === "embedding" ? { dimension: 3_072, distanceMetric: "cosine" as const } : {}),
    kind,
    pluginUniqueIdentifier: `${selection.pluginId}:installed`,
    schemaFingerprint: `sha256:${"d".repeat(64)}`,
    selection,
  };
}

function compilationAttempt(): DocumentCompilationAttempt {
  return {
    activeSlot: 1,
    baseHeadRevision: 0,
    checkpoint: "queued",
    createdAt: timestamp,
    documentAssetId: "10000000-0000-4000-8000-000000000020",
    documentVersion: 1,
    executionAttempts: 1,
    id: "10000000-0000-4000-8000-000000000021",
    knowledgeSpaceId,
    maxExecutionAttempts: 5,
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "10000000-0000-4000-8000-000000000022",
      revision: 1,
    },
    publicationGenerationId: "10000000-0000-4000-8000-000000000023",
    requestedBySubjectId: subjectId,
    rowVersion: 2,
    runState: "running",
    tenantId,
    updatedAt: timestamp,
  };
}
