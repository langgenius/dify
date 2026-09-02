import type {
  MetadataFilteringCondition,
  MetadataFilteringConditions,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { CommonNodeType, ModelConfig, ValueSelector } from '@/app/components/workflow/types'

export type KnowledgeRetrievalV2Mode = 'fast' | 'deep' | 'research'
export type KnowledgeRetrievalV2NodeKind = 'chunk' | 'section' | 'table' | 'image' | 'summary'

export type KnowledgeRetrievalV2RerankingModel = {
  model: string
  provider: string
}

export type KnowledgeRetrievalV2MetadataFilters = {
  created_after?: string
  created_before?: string
  document_types?: string[]
  entities?: string[]
  freshness_statuses?: string[]
  languages?: string[]
  node_kinds?: KnowledgeRetrievalV2NodeKind[]
  source_ids?: string[]
  tags?: string[]
}

export type KnowledgeRetrievalV2SpaceSummary = {
  control_space_id: string
  default_mode?: KnowledgeRetrievalV2Mode
  icon?: string | null
  name: string
  rerank_enabled?: boolean
  top_k?: number
}

export type KnowledgeRetrievalV2MetadataFilteringConditions = Omit<
  MetadataFilteringConditions,
  'conditions'
> & {
  conditions: Array<
    MetadataFilteringCondition & {
      metadata_type?: MetadataFilteringVariableType
    }
  >
}

export type KnowledgeRetrievalV2NodeType = CommonNodeType & {
  control_space_ids: string[]
  query_attachment_selector?: ValueSelector
  query_variable_selector: ValueSelector
  mode?: KnowledgeRetrievalV2Mode
  reranking_model?: KnowledgeRetrievalV2RerankingModel
  score_threshold?: number | null
  top_n: number
  metadata_filtering_mode?: MetadataFilteringModeEnum
  metadata_model_config?: ModelConfig
  metadata_filtering_conditions?: KnowledgeRetrievalV2MetadataFilteringConditions
  metadata_filters?: KnowledgeRetrievalV2MetadataFilters
  _control_spaces?: KnowledgeRetrievalV2SpaceSummary[]
}
