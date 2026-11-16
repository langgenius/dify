'use client'

import type { NonPipelineEvaluationResourceProps } from '../../types'
import { useTranslation } from 'react-i18next'
import { useDefaultEvaluationMetrics } from '../../queries'
import { useEvaluationResource } from '../../store'
import { useSyncNodeTitles } from '../../use-sync-node-titles'
import MetricSelector from '../metric-selector'
import { getDefaultMetricNodeInfoMap } from '../metric-selector/utils'
import { InlineSectionHeader } from '../section-header'
import UnsupportedMetricsWarning from '../unsupported-metrics-warning'
import MetricCard from './metric-card'
import MetricSectionEmptyState from './metric-section-empty-state'

const MetricSection = ({ resourceType, resourceId }: NonPipelineEvaluationResourceProps) => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const hasMetrics = resource.metrics.length > 0
  const hasBuiltinMetrics = resource.metrics.some((metric) => metric.kind === 'builtin')
  const { data: defaultMetricsData } = useDefaultEvaluationMetrics(
    resourceType,
    resourceId,
    resource.evaluationFramework,
    hasBuiltinMetrics,
  )
  const nodeInfoMap = getDefaultMetricNodeInfoMap(defaultMetricsData?.default_metrics ?? [])
  useSyncNodeTitles(resourceType, resourceId, defaultMetricsData?.default_metrics)

  return (
    <section className="py-4 xl:max-w-[700px]">
      <InlineSectionHeader
        title={t(($) => $['metrics.title'])}
        tooltip={t(($) => $['metrics.description'])}
      />
      <div className="mt-1 space-y-1">
        <UnsupportedMetricsWarning resourceType={resourceType} resourceId={resourceId} />
        {!hasMetrics && (
          <MetricSectionEmptyState description={t(($) => $['metrics.description'])} />
        )}
        {resource.metrics.map((metric) => (
          <MetricCard
            key={metric.id}
            resourceType={resourceType}
            resourceId={resourceId}
            metric={metric}
            availableNodeInfoList={
              metric.kind === 'builtin' ? (nodeInfoMap[metric.optionId] ?? []) : undefined
            }
          />
        ))}
        {/* Own wrapper: an open popup inserts focus guards beside its trigger, which would shift space-y margins. */}
        <div>
          <MetricSelector
            resourceType={resourceType}
            resourceId={resourceId}
            triggerClassName="rounded-md px-3 py-2"
          />
        </div>
      </div>
    </section>
  )
}

export default MetricSection
