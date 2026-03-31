'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import type { NodeInfo } from '@/types/evaluation'
import BuiltinMetricCard from './builtin-metric-card'
import CustomMetricCard from './custom-metric-card'

type MetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
  availableNodeInfoList?: NodeInfo[]
}

const MetricCard = ({
  resourceType,
  resourceId,
  metric,
  availableNodeInfoList,
}: MetricCardProps) => {
  if (metric.kind === 'custom-workflow') {
    return (
      <CustomMetricCard
        resourceType={resourceType}
        resourceId={resourceId}
        metric={metric}
      />
    )
  }

  return (
    <BuiltinMetricCard
      resourceType={resourceType}
      resourceId={resourceId}
      metric={metric}
      availableNodeInfoList={availableNodeInfoList}
    />
  )
}

export default MetricCard
