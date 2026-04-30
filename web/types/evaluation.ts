export type EvaluationTargetType = 'apps' | 'snippets' | 'datasets'
export type EvaluationDefaultMetricsTargetType = 'apps' | 'snippets'

export type EvaluationJudgmentConditionValue = string | string[] | boolean

export type EvaluationJudgmentCondition = {
  variable_selector?: string[]
  comparison_operator?: string
  value?: EvaluationJudgmentConditionValue
}

export type EvaluationJudgmentConfig = {
  logical_operator?: 'and' | 'or'
  conditions?: EvaluationJudgmentCondition[]
}

export type EvaluationConfig = {
  evaluation_model: string | null
  evaluation_model_provider: string | null
  default_metrics?: EvaluationDefaultMetric[] | null
  customized_metrics?: EvaluationCustomizedMetric | null
  judgment_config?: EvaluationJudgmentConfig | null
}

export type NodeInfo = {
  node_id: string
  type: string
  title: string
}

export type EvaluationDefaultMetric = {
  metric?: string
  value_type?: string
  node_info_list?: NodeInfo[]
}

export type EvaluationDefaultMetricsResponse = {
  default_metrics: EvaluationDefaultMetric[]
}

export type EvaluationCustomizedMetric = {
  evaluation_workflow_id?: string
  input_fields?: Record<string, string | null | undefined>
  output_fields?: Array<{
    variable?: string
    value_type?: string
  }>
}

export type EvaluationConfigData = {
  evaluation_model?: string
  evaluation_model_provider?: string
  default_metrics?: EvaluationDefaultMetric[] | null
  customized_metrics?: EvaluationCustomizedMetric | null
  judgment_config?: EvaluationJudgmentConfig | null
}

export type EvaluationRunRequest = EvaluationConfigData & {
  file_id: string
}

export type EvaluationRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type EvaluationJudgmentMetricsSummary = {
  enabled: boolean
  logical_operator: 'and' | 'or'
  configured_conditions: number
  evaluated_items: number
  passed_items: number
  failed_items: number
  pass_rate: number
}

export type EvaluationMetricsSummary = Record<string, unknown> & {
  _judgment?: EvaluationJudgmentMetricsSummary
}

export type EvaluationRun = {
  id: string
  tenant_id: string
  target_type: string
  target_id: string
  evaluation_config_id: string
  status: EvaluationRunStatus
  dataset_file_id: string | null
  result_file_id: string | null
  total_items: number
  completed_items: number
  failed_items: number
  progress: number
  metrics_summary: EvaluationMetricsSummary
  error: string | null
  created_by: string
  started_at: number | null
  completed_at: number | null
  created_at: number
}

export type EvaluationLog = EvaluationRun

export type EvaluationRunMetric = {
  name?: string
  value?: unknown
  details?: Record<string, unknown>
}

export type EvaluationRunItem = {
  id: string
  item_index: number
  inputs: Record<string, unknown>
  expected_output: string | null
  actual_output: string | null
  metrics: EvaluationRunMetric[]
  judgment: Record<string, unknown>
  metadata: Record<string, unknown>
  error: string | null
  overall_score: number | null
}

export type EvaluationLogsResponse = {
  data: EvaluationLog[]
  total: number
  page: number
  page_size: number
}

export type EvaluationRunItemsPagination = {
  data: EvaluationRunItem[]
  total: number
  page: number
  page_size: number
}

export type EvaluationRunDetailResponse = {
  run: EvaluationRun
  items: EvaluationRunItemsPagination
}

export type EvaluationMetricsMapResponse = {
  metrics: Record<string, string[]>
}

export type EvaluationMetricsListResponse = {
  metrics: string[]
}

export type EvaluationWorkflowOperator = {
  id: string
  name: string
  email: string
}

export type AvailableEvaluationWorkflow = {
  id: string
  app_id: string
  app_name: string
  type: string
  version: string
  marked_name: string
  marked_comment: string
  hash: string
  created_by: EvaluationWorkflowOperator
  created_at: number
  updated_by: EvaluationWorkflowOperator | null
  updated_at: number
}

export type AvailableEvaluationWorkflowsResponse = {
  items: AvailableEvaluationWorkflow[]
  page: number
  limit: number
  has_more: boolean
}

export type EvaluationWorkflowAssociatedTargetType = 'app' | 'snippets' | 'knowledge_base'

export type EvaluationWorkflowAssociatedTarget = {
  target_type: EvaluationWorkflowAssociatedTargetType
  target_id: string
  target_name: string
}

export type EvaluationWorkflowAssociatedTargetsResponse = {
  items: EvaluationWorkflowAssociatedTarget[]
}

export type EvaluationNodeInfoRequest = {
  metrics?: string[]
}

export type EvaluationNodeInfoResponse = Record<string, NodeInfo[]>

export type EvaluationFileInfo = {
  id: string
  name: string
  size: number
  extension: string
  mime_type: string
  created_at: number
  download_url: string
}

export type EvaluationVersionDetailResponse = {
  graph: Record<string, unknown>
}
