import {
  type KnowledgeGatewayOptions,
  createLlmCommunitySummaryProvider,
  createLlmEntityExtractionProvider,
  createLlmRelationExtractionProvider,
} from "@knowledge/api";

import {
  type DifyModelRuntimeClientEnv,
  difyModelRuntimeRequired,
} from "./dify-model-runtime-options";
import {
  type ChatProviderDifyModelConfig,
  createChatProvider,
  positiveIntegerEnv,
  trimmed,
} from "./generation-provider";

export interface ApiSemanticEntityExtractionEnv extends DifyModelRuntimeClientEnv {
  readonly KNOWLEDGE_ENTITY_EXTRACTION_MAX_ENTITIES_PER_NODE?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_MODEL?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_ID?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER?: string | undefined;
  readonly KNOWLEDGE_RELATION_EXTRACTION_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE?: string | undefined;
  readonly KNOWLEDGE_RELATION_EXTRACTION_MODEL?: string | undefined;
  readonly KNOWLEDGE_COMMUNITY_SUMMARY_MAX_OUTPUT_TOKENS?: string | undefined;
  readonly KNOWLEDGE_COMMUNITY_SUMMARY_MODEL?: string | undefined;
}

export function createApiSemanticEntityExtractionOptions(
  env: ApiSemanticEntityExtractionEnv = process.env,
): Partial<KnowledgeGatewayOptions> {
  if (!semanticExtractionEnabled(env.KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER)) {
    return {};
  }

  const { provider, defaultModel } = createChatProvider(env, semanticDifyModelConfig(env));
  const model = trimmed(env.KNOWLEDGE_ENTITY_EXTRACTION_MODEL) ?? defaultModel;

  return {
    semanticEntityExtractionMaxEntitiesPerNode: positiveIntegerEnv(
      env.KNOWLEDGE_ENTITY_EXTRACTION_MAX_ENTITIES_PER_NODE,
      50,
      "KNOWLEDGE_ENTITY_EXTRACTION_MAX_ENTITIES_PER_NODE",
    ),
    semanticEntityExtractionMaxNodesPerRun: positiveIntegerEnv(
      env.KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN,
      100,
      "KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN",
    ),
    semanticCommunitySummaryModel: trimmed(env.KNOWLEDGE_COMMUNITY_SUMMARY_MODEL) ?? model,
    semanticEntityExtractionModel: model,
    semanticEntityExtractionProvider: createLlmEntityExtractionProvider({
      maxOutputTokens: positiveIntegerEnv(
        env.KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS,
        1_500,
        "KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS",
      ),
      provider,
    }),
    semanticRelationExtractionMaxRelationsPerNode: positiveIntegerEnv(
      env.KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE,
      50,
      "KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE",
    ),
    semanticRelationExtractionModel: trimmed(env.KNOWLEDGE_RELATION_EXTRACTION_MODEL) ?? model,
    semanticRelationExtractionProvider: createLlmRelationExtractionProvider({
      maxOutputTokens: positiveIntegerEnv(
        env.KNOWLEDGE_RELATION_EXTRACTION_MAX_OUTPUT_TOKENS,
        1_500,
        "KNOWLEDGE_RELATION_EXTRACTION_MAX_OUTPUT_TOKENS",
      ),
      provider,
    }),
    semanticCommunitySummaryProvider: createLlmCommunitySummaryProvider({
      maxOutputTokens: positiveIntegerEnv(
        env.KNOWLEDGE_COMMUNITY_SUMMARY_MAX_OUTPUT_TOKENS,
        800,
        "KNOWLEDGE_COMMUNITY_SUMMARY_MAX_OUTPUT_TOKENS",
      ),
      model: trimmed(env.KNOWLEDGE_COMMUNITY_SUMMARY_MODEL) ?? model,
      provider,
    }),
  };
}

function semanticDifyModelConfig(env: ApiSemanticEntityExtractionEnv): ChatProviderDifyModelConfig {
  return {
    model: difyModelRuntimeRequired(
      env.KNOWLEDGE_ENTITY_EXTRACTION_MODEL,
      "KNOWLEDGE_ENTITY_EXTRACTION_MODEL",
      "semantic entity extraction",
    ),
    pluginId: difyModelRuntimeRequired(
      env.KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_ID,
      "KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_ID",
      "semantic entity extraction",
    ),
    provider: difyModelRuntimeRequired(
      env.KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_PROVIDER,
      "KNOWLEDGE_ENTITY_EXTRACTION_PLUGIN_PROVIDER",
      "semantic entity extraction",
    ),
  };
}

function semanticExtractionEnabled(value: string | undefined): boolean {
  const normalized = trimmed(value)?.toLowerCase();

  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }

  if (normalized === "dify-model-runtime" || normalized === "plugin-daemon") {
    return true;
  }

  throw new Error(
    "KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER must be dify-model-runtime, plugin-daemon, or off",
  );
}
