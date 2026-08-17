import {
  type ConcurrencyGate,
  type IngestionModelCallOperationalMetrics,
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

export function createApiKnowledgeSpaceSemanticIngestionOptions({
  env = process.env,
  providerFactory,
}: {
  readonly env?: ApiSemanticEntityExtractionEnv | undefined;
  readonly providerFactory: NonNullable<
    KnowledgeGatewayOptions["semanticReasoningProviderFactory"]
  >;
}): Pick<
  KnowledgeGatewayOptions,
  | "semanticEntityExtractionMaxEntitiesPerNode"
  | "semanticEntityExtractionMaxNodesPerRun"
  | "semanticReasoningMaxOutputTokens"
  | "semanticReasoningProviderFactory"
  | "semanticRelationExtractionMaxRelationsPerNode"
> {
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
    semanticReasoningMaxOutputTokens: positiveIntegerEnv(
      env.KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS,
      1_500,
      "KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS",
    ),
    semanticReasoningProviderFactory: providerFactory,
    semanticRelationExtractionMaxRelationsPerNode: positiveIntegerEnv(
      env.KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE,
      50,
      "KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE",
    ),
  };
}

/**
 * Legacy fixed-provider wiring retained for explicit compatibility. Automatic document graph
 * ingestion and repair actions resolve the owning knowledge space's reasoning model instead.
 */
export function createApiSemanticEntityExtractionOptions(
  env: ApiSemanticEntityExtractionEnv = process.env,
  options: {
    readonly metrics?: IngestionModelCallOperationalMetrics | undefined;
    readonly modelRequestGate?: ConcurrencyGate | undefined;
  } = {},
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
      ...(options.modelRequestGate ? { modelRequestGate: options.modelRequestGate } : {}),
      ...(options.metrics ? { metrics: options.metrics } : {}),
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
      ...(options.modelRequestGate ? { modelRequestGate: options.modelRequestGate } : {}),
      ...(options.metrics ? { metrics: options.metrics } : {}),
      provider,
    }),
    semanticCommunitySummaryProvider: createLlmCommunitySummaryProvider({
      maxOutputTokens: positiveIntegerEnv(
        env.KNOWLEDGE_COMMUNITY_SUMMARY_MAX_OUTPUT_TOKENS,
        800,
        "KNOWLEDGE_COMMUNITY_SUMMARY_MAX_OUTPUT_TOKENS",
      ),
      model: trimmed(env.KNOWLEDGE_COMMUNITY_SUMMARY_MODEL) ?? model,
      ...(options.metrics ? { metrics: options.metrics } : {}),
      ...(options.modelRequestGate ? { modelRequestGate: options.modelRequestGate } : {}),
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

  if (normalized === "dify-model-runtime") {
    return true;
  }

  throw new Error("KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER must be dify-model-runtime or off");
}
