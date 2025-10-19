import type {
  CommonNodeType,
  ModelConfig,
  Node,
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import type { RETRIEVE_TYPE } from '@/types/app'
import type {
  DataSet,
  MetadataInDoc,
  RerankingModeEnum,
  WeightedScoreEnum,
} from '@/models/datasets'

export type MultipleRetrievalConfig = {
  top_k: number
  score_threshold: number | null | undefined
  reranking_model?: {
    provider: string
    model: string
  }
  reranking_mode?: RerankingModeEnum
  weights?: {
    weight_type: WeightedScoreEnum
    vector_setting: {
      vector_weight: number
      embedding_provider_name: string
      embedding_model_name: string
    }
    keyword_setting: {
      keyword_weight: number
    }
  }
  reranking_enable?: boolean
}

export type SingleRetrievalConfig = {
  model: ModelConfig
}

export enum LogicalOperator {
  and = 'and',
  or = 'or',
}

export enum ComparisonOperator {
  contains = 'contains',
  notContains = 'not contains',
  startWith = 'start with',
  endWith = 'end with',
  is = 'is',
  isNot = 'is not',
  empty = 'empty',
  notEmpty = 'not empty',
  equal = '=',
  notEqual = '≠',
  largerThan = '>',
  lessThan = '<',
  largerThanOrEqual = '≥',
  lessThanOrEqual = '≤',
  isNull = 'is null',
  isNotNull = 'is not null',
  in = 'in',
  notIn = 'not in',
  allOf = 'all of',
  exists = 'exists',
  notExists = 'not exists',
  before = 'before',
  after = 'after',
}

export enum MetadataFilteringModeEnum {
  disabled = 'disabled',
  automatic = 'automatic',
  manual = 'manual',
}

export enum MetadataFilteringVariableType {
  string = 'string',
  number = 'number',
  time = 'time',
  select = 'select',
}

export type MetadataFilteringCondition = {
  id: string
  name: string
  comparison_operator: ComparisonOperator
  value?: string | number
}

export type MetadataFilteringConditions = {
  logical_operator: LogicalOperator
  conditions: MetadataFilteringCondition[]
}

export type KnowledgeRetrievalNodeType = CommonNodeType & {
  query_variable_selector: ValueSelector
  dataset_ids: string[]
  retrieval_mode: RETRIEVE_TYPE
  multiple_retrieval_config?: MultipleRetrievalConfig
  single_retrieval_config?: SingleRetrievalConfig
  _datasets?: DataSet[]
  metadata_filtering_mode?: MetadataFilteringModeEnum
  metadata_filtering_conditions?: MetadataFilteringConditions
  metadata_model_config?: ModelConfig
}

export type HandleAddCondition = (metadataItem: MetadataInDoc) => void
export type HandleRemoveCondition = (id: string) => void
export type HandleUpdateCondition = (id: string, newCondition: MetadataFilteringCondition) => void
export type HandleToggleConditionLogicalOperator = () => void

export type MetadataShape = {
  metadataList?: MetadataInDoc[]
  selectedDatasetsLoaded?: boolean
  metadataFilteringConditions?: MetadataFilteringConditions
  handleAddCondition: HandleAddCondition
  handleRemoveCondition: HandleRemoveCondition
  handleToggleConditionLogicalOperator: HandleToggleConditionLogicalOperator
  handleUpdateCondition: HandleUpdateCondition
  metadataModelConfig?: ModelConfig
  handleMetadataModelChange?: (model: { modelId: string; provider: string; mode?: string; features?: string[] }) => void
  handleMetadataCompletionParamsChange?: (params: Record<string, any>) => void
  availableStringVars?: NodeOutPutVar[]
  availableStringNodesWithParent?: Node[]
  availableNumberVars?: NodeOutPutVar[]
  availableNumberNodesWithParent?: Node[]
  isCommonVariable?: boolean
  availableCommonStringVars?: { name: string; type: string; value: string }[]
  availableCommonNumberVars?: { name: string; type: string; value: string }[]
}
