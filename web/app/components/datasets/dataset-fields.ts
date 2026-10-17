import type {
  DatasetGraphIndexSettingResponse,
  DatasetIconInfoResponse,
  DatasetRetrievalModelResponse,
  DatasetSummaryIndexSettingResponse,
} from '@dify/contracts/api/console/datasets/types.gen'
import type { GraphIndexSetting, IconInfo, SummaryIndexSetting } from '@/models/datasets'
import type { AppIconType, RetrievalConfig } from '@/types/app'
import {
  ChunkingMode,
  DataSourceType,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'

const isOneOf = <T extends string>(values: Record<string, T>, value: unknown): value is T =>
  typeof value === 'string' && Object.values<string>(values).includes(value)

/** A dataset's chunk structure, when it is one the console can render. */
export const toChunkingMode = (docForm: string | null | undefined) =>
  isOneOf(ChunkingMode, docForm) ? docForm : undefined

/** The data sources of the classic document creation flow. */
export const toCreationDataSourceType = (dataSourceType: string | null | undefined) =>
  isOneOf(DataSourceType, dataSourceType) ? dataSourceType : undefined

const APP_ICON_TYPES = { image: 'image', emoji: 'emoji', link: 'link' } satisfies Record<
  AppIconType,
  AppIconType
>

/** The dataset icon, when one was chosen. */
export const toIconInfo = (iconInfo: DatasetIconInfoResponse | undefined): IconInfo | undefined => {
  if (!iconInfo?.icon || !isOneOf(APP_ICON_TYPES, iconInfo.icon_type)) return undefined
  return {
    icon: iconInfo.icon,
    icon_type: iconInfo.icon_type,
    icon_background: iconInfo.icon_background ?? undefined,
    icon_url: iconInfo.icon_url ?? undefined,
  }
}

/** The summary index settings form state; unset fields stay unset. */
export const toSummaryIndexSetting = ({
  enable,
  model_name,
  model_provider_name,
  summary_prompt,
}: DatasetSummaryIndexSettingResponse): SummaryIndexSetting => ({
  enable: enable ?? undefined,
  model_name: model_name ?? undefined,
  model_provider_name: model_provider_name ?? undefined,
  summary_prompt: summary_prompt ?? undefined,
})

/**
 * The graph settings form state for a stored graph setting. Unset fields stay absent rather than
 * null, so saving the form never writes a null over a server-side default.
 */
export const toGraphIndexSetting = (
  setting: DatasetGraphIndexSettingResponse,
): GraphIndexSetting => ({
  enabled: setting.enabled ?? undefined,
  model_name: setting.model_name ?? undefined,
  model_provider_name: setting.model_provider_name ?? undefined,
  entity_types: setting.entity_types ?? undefined,
  max_entities_per_chunk: setting.max_entities_per_chunk ?? undefined,
  extract_prompt: setting.extract_prompt ?? undefined,
  max_depth: setting.max_depth ?? undefined,
  max_seed_entities: setting.max_seed_entities ?? undefined,
  max_neighbors_per_hop: setting.max_neighbors_per_hop ?? undefined,
  hop_decay: setting.hop_decay ?? undefined,
  llm_query_fallback: setting.llm_query_fallback ?? undefined,
})

/**
 * The retrieval settings form state for a stored retrieval model. Unset model names stay empty,
 * as in the backend's default retrieval model, which the form reads as no model selected.
 */
export const toRetrievalConfig = (retrieval: DatasetRetrievalModelResponse): RetrievalConfig => {
  const weights = retrieval.weights
  const vectorWeight = weights?.vector_setting?.vector_weight
  const keywordWeight = weights?.keyword_setting?.keyword_weight
  return {
    search_method: retrieval.search_method,
    reranking_enable: retrieval.reranking_enable,
    reranking_model: {
      reranking_provider_name: retrieval.reranking_model?.reranking_provider_name ?? '',
      reranking_model_name: retrieval.reranking_model?.reranking_model_name ?? '',
    },
    top_k: retrieval.top_k,
    score_threshold_enabled: retrieval.score_threshold_enabled,
    score_threshold: retrieval.score_threshold ?? undefined,
    reranking_mode: isOneOf(RerankingModeEnum, retrieval.reranking_mode)
      ? retrieval.reranking_mode
      : undefined,
    // Weighted scores are kept only when both weights were stored. The backend ignores the weight
    // type, and the console writes customized weights.
    weights:
      weights && vectorWeight != null && keywordWeight != null
        ? {
            weight_type: isOneOf(WeightedScoreEnum, weights.weight_type)
              ? weights.weight_type
              : WeightedScoreEnum.Customized,
            vector_setting: {
              vector_weight: vectorWeight,
              embedding_provider_name: weights.vector_setting?.embedding_provider_name ?? '',
              embedding_model_name: weights.vector_setting?.embedding_model_name ?? '',
            },
            keyword_setting: { keyword_weight: keywordWeight },
          }
        : undefined,
  }
}
