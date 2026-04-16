import type { EvaluationMetric, EvaluationResourceProps, MetricOption } from '../../types'
import type { NodeInfo } from '@/types/evaluation'

export type MetricSelectorProps = EvaluationResourceProps & {
  triggerClassName?: string
  triggerStyle?: 'button' | 'text'
}

export type MetricVisualTone = 'indigo' | 'green'

export type MetricSelectorSection = {
  metric: MetricOption
  hasNoNodeInfo: boolean
  visibleNodes: NodeInfo[]
}

export type BuiltinMetricMap = Map<string, EvaluationMetric>
