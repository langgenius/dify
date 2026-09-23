import type { NodeInfo } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type {
  EvaluationMetric,
  MetricOption,
  NonPipelineEvaluationResourceProps,
} from '../../types'

export type MetricSelectorProps = NonPipelineEvaluationResourceProps & {
  triggerClassName?: string
}

export type MetricVisualTone = 'indigo' | 'green'

export type MetricSelectorSection = {
  metric: MetricOption
  hasNoNodeInfo: boolean
  visibleNodes: NodeInfo[]
}

export type BuiltinMetricMap = Map<string, EvaluationMetric>
