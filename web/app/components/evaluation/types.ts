import type { NodeInfo } from '@/types/evaluation'

export type EvaluationResourceType = 'apps' | 'datasets' | 'snippets'
export type NonPipelineEvaluationResourceType = Exclude<EvaluationResourceType, 'datasets'>

export type EvaluationResourceProps = {
  resourceType: EvaluationResourceType
  resourceId: string
}

export type NonPipelineEvaluationResourceProps = {
  resourceType: NonPipelineEvaluationResourceType
  resourceId: string
}

export type MetricKind = 'builtin' | 'custom-workflow'

export type BatchTestTab = 'input-fields' | 'history'

export type ConditionMetricValueType = 'string' | 'number' | 'boolean'

export type ComparisonOperator
  = | 'contains'
    | 'not contains'
    | 'start with'
    | 'end with'
    | 'is'
    | 'is not'
    | 'empty'
    | 'not empty'
    | 'in'
    | 'not in'
    | '='
    | '≠'
    | '>'
    | '<'
    | '≥'
    | '≤'
    | 'is null'
    | 'is not null'

export type MetricOption = {
  id: string
  label: string
  description: string
  valueType: ConditionMetricValueType
}

export type CustomMetricMapping = {
  id: string
  inputVariableId: string | null
  outputVariableId: string | null
}

export type CustomMetricConfig = {
  workflowId: string | null
  workflowAppId: string | null
  workflowName: string | null
  mappings: CustomMetricMapping[]
  outputs: Array<{
    id: string
    valueType: string | null
  }>
}

export type EvaluationMetric = {
  id: string
  optionId: string
  kind: MetricKind
  label: string
  description: string
  valueType: ConditionMetricValueType
  threshold?: number
  nodeInfoList?: NodeInfo[]
  customConfig?: CustomMetricConfig
}

export type JudgmentConditionItem = {
  id: string
  variableSelector: [string, string] | null
  comparisonOperator: ComparisonOperator
  value: string | string[] | boolean | null
}

export type JudgmentConfig = {
  logicalOperator: 'and' | 'or'
  conditions: JudgmentConditionItem[]
}

export type ConditionMetricOption = {
  id: string
  kind: MetricKind
  groupLabel: string
  itemLabel: string
  valueType: ConditionMetricValueType
  variableSelector: [string, string]
  nodeInfo?: NodeInfo
}

export type ConditionMetricOptionGroup = {
  label: string
  options: ConditionMetricOption[]
}

export type BatchTestRecord = {
  id: string
  fileName: string
  status: 'running' | 'success' | 'failed'
  startedAt: string
  summary: string
}

export type EvaluationResourceState = {
  judgeModelId: string | null
  metrics: EvaluationMetric[]
  judgmentConfig: JudgmentConfig
  activeBatchTab: BatchTestTab
  uploadedFileId: string | null
  uploadedFileName: string | null
  selectedRunId: string | null
  batchRecords: BatchTestRecord[]
}
