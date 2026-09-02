import {
  type ConcurrencyGate,
  type ImageBytesVisualEmbeddingProvider,
  type KnowledgeGatewayOptions,
  type VisualEmbeddingProvider,
  createConcurrencyGate,
  createObjectStorageVisualEmbeddingProvider,
} from "@knowledge/api";
import type { KnowledgeSpaceEmbeddingProfile, KnowledgeSpaceModelSelection } from "@knowledge/core";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
} from "./dify-model-runtime-options";
import { createDifyImageBytesVisualEmbeddingProvider } from "./visual-embedding-options";

export interface ApiProfileVisualEmbeddingEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_VISUAL_EMBEDDING_PREFERRED_VARIANT?: string | undefined;
}

export interface ApiProfileVisualEmbeddingOptions {
  readonly imageEmbeddingProviderFactory: (
    selection: KnowledgeSpaceModelSelection,
  ) => ImageBytesVisualEmbeddingProvider;
  readonly provider: VisualEmbeddingProvider;
  readonly queryMode: "primary";
}

/**
 * Creates the deployment's bounded visual data plane. Model identity is deliberately absent from
 * environment configuration: every invocation is routed through the immutable embedding profile
 * frozen for the document publication or query.
 */
export function createApiProfileVisualEmbeddingOptions({
  env = process.env,
  modelRequestGate,
  objectStorage,
}: {
  readonly env?: ApiProfileVisualEmbeddingEnv | undefined;
  readonly modelRequestGate?: ConcurrencyGate | undefined;
  readonly objectStorage: KnowledgeGatewayOptions["adapter"]["objectStorage"];
}): ApiProfileVisualEmbeddingOptions {
  const client = createApiDifyModelRuntimeClient(env);
  const lifecycleGate = createConcurrencyGate(
    boundedInteger(
      env.KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY,
      2,
      1,
      8,
      "KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY",
    ),
  );
  const imageEmbeddingProviderFactory = (selection: KnowledgeSpaceModelSelection) =>
    createDifyImageBytesVisualEmbeddingProvider({
      client,
      modelRequestGate,
      pluginId: selection.pluginId,
      provider: selection.provider,
    });
  const provider: VisualEmbeddingProvider = {
    embedAssets: async (input) => {
      const profile = input.embeddingProfile;
      if (!profile) {
        throw new Error("Profile visual embedding embeddingProfile is required");
      }
      assertProfileModel(profile, input.model);
      const objectProvider = createObjectStorageVisualEmbeddingProvider({
        maxAssetBytes: positiveInteger(
          env.KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES,
          20 * 1024 * 1024,
          "KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES",
        ),
        maxBatchAssetCount: positiveInteger(
          env.KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS,
          8,
          "KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS",
        ),
        maxBatchBytes: positiveInteger(
          env.KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES,
          32 * 1024 * 1024,
          "KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES",
        ),
        objectStorage,
        preferredVariant: env.KNOWLEDGE_VISUAL_EMBEDDING_PREFERRED_VARIANT?.trim() || "thumbnail",
        provider: imageEmbeddingProviderFactory(profile),
      });
      return lifecycleGate.run(() => objectProvider.embedAssets(input), { signal: input.signal });
    },
    providerCallAdmission: "per-provider-call",
  };

  return {
    imageEmbeddingProviderFactory,
    provider,
    queryMode: "primary",
  };
}

function assertProfileModel(profile: KnowledgeSpaceEmbeddingProfile, model: string): void {
  if (profile.model !== model.trim()) {
    throw new Error("Profile visual embedding model does not match embeddingProfile");
  }
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  return boundedInteger(value, fallback, 1, Number.MAX_SAFE_INTEGER, name);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const normalized = value?.trim();
  const parsed = normalized ? Number(normalized) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}
