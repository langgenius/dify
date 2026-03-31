'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import BuiltinMetricCard from './builtin-metric-card'
import CustomMetricCard from './custom-metric-card'

type MetricCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

const MetricCard = ({
  resourceType,
  resourceId,
  metric,
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
    />
  )
}

export default MetricCard
