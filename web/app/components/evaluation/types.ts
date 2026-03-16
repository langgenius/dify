export type EvaluationResourceType = 'workflow' | 'pipeline' | 'snippet'

export type MetricKind = 'builtin' | 'custom-workflow'

export type BatchTestTab = 'input-fields' | 'history'

export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'time'

export type ComparisonOperator
  = | 'contains'
    | 'not_contains'
    | 'is'
    | 'is_not'
    | 'is_empty'
    | 'is_not_empty'
    | 'greater_than'
    | 'less_than'
    | 'greater_or_equal'
    | 'less_or_equal'
    | 'before'
    | 'after'

export type JudgeModelOption = {
  id: string
  label: string
  provider: string
}

export type MetricOption = {
  id: string
  label: string
  description: string
  group: string
  badges: string[]
}

export type EvaluationWorkflowOption = {
  id: string
  label: string
  description: string
  targetVariables: Array<{
    id: string
    label: string
  }>
}

export type EvaluationFieldOption = {
  id: string
  label: string
  group: string
  type: FieldType
  options?: Array<{
    value: string
    label: string
  }>
}

export type CustomMetricMapping = {
  id: string
  sourceFieldId: string | null
  targetVariableId: string | null
}

export type CustomMetricConfig = {
  workflowId: string | null
  mappings: CustomMetricMapping[]
}

export type EvaluationMetric = {
  id: string
  optionId: string
  kind: MetricKind
  label: string
  description: string
  badges: string[]
  customConfig?: CustomMetricConfig
}

export type JudgmentConditionItem = {
  id: string
  fieldId: string | null
  operator: ComparisonOperator
  value: string | number | boolean | null
}

export type JudgmentConditionGroup = {
  id: string
  logicalOperator: 'and' | 'or'
  items: JudgmentConditionItem[]
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
  conditions: JudgmentConditionGroup[]
  activeBatchTab: BatchTestTab
  uploadedFileName: string | null
  batchRecords: BatchTestRecord[]
}

export type EvaluationMockConfig = {
  judgeModels: JudgeModelOption[]
  builtinMetrics: MetricOption[]
  workflowOptions: EvaluationWorkflowOption[]
  fieldOptions: EvaluationFieldOption[]
  templateFileName: string
  batchRequirements: string[]
  historySummaryLabel: string
}
