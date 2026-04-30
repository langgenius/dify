'use client'

import type { NonPipelineEvaluationResourceProps } from '../../types'
import { useTranslation } from 'react-i18next'
import { useDefaultEvaluationMetrics } from '@/service/use-evaluation'
import { useEvaluationResource } from '../../store'
import MetricSelector from '../metric-selector'
import { getDefaultMetricNodeInfoMap } from '../metric-selector/utils'
import { InlineSectionHeader } from '../section-header'
import MetricCard from './metric-card'
import MetricSectionEmptyState from './metric-section-empty-state'

const MetricSection = ({
  resourceType,
  resourceId,
}: NonPipelineEvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const hasMetrics = resource.metrics.length > 0
  const hasBuiltinMetrics = resource.metrics.some(metric => metric.kind === 'builtin')
  const { data: defaultMetricsData } = useDefaultEvaluationMetrics(resourceType, resourceId, hasBuiltinMetrics)
  const nodeInfoMap = getDefaultMetricNodeInfoMap(defaultMetricsData?.default_metrics ?? [])

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t('metrics.title')}
        tooltip={t('metrics.description')}
      />
      <div className="mt-1 space-y-1">
        {!hasMetrics && <MetricSectionEmptyState description={t('metrics.description')} />}
        {resource.metrics.map(metric => (
          <MetricCard
            key={metric.id}
            resourceType={resourceType}
            resourceId={resourceId}
            metric={metric}
            availableNodeInfoList={metric.kind === 'builtin' ? (nodeInfoMap[metric.optionId] ?? []) : undefined}
          />
        ))}
        <MetricSelector
          resourceType={resourceType}
          resourceId={resourceId}
          triggerClassName="rounded-md px-3 py-2"
        />
      </div>
    </section>
  )
}

export default MetricSection
