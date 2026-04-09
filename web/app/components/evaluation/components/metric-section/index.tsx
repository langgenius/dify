'use client'

import type { EvaluationResourceProps } from '../../types'
import type { NodeInfo } from '@/types/evaluation'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAvailableEvaluationMetrics, useEvaluationNodeInfoMutation } from '@/service/use-evaluation'
import { useEvaluationResource } from '../../store'
import MetricSelector from '../metric-selector'
import { toEvaluationTargetType } from '../metric-selector/utils'
import { InlineSectionHeader } from '../section-header'
import MetricCard from './metric-card'
import MetricSectionEmptyState from './metric-section-empty-state'

const MetricSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const resource = useEvaluationResource(resourceType, resourceId)
  const [nodeInfoMap, setNodeInfoMap] = useState<Record<string, NodeInfo[]>>({})
  const hasMetrics = resource.metrics.length > 0
  const hasBuiltinMetrics = resource.metrics.some(metric => metric.kind === 'builtin')
  const shouldLoadNodeInfo = resourceType !== 'datasets' && !!resourceId && hasBuiltinMetrics
  const { data: availableMetricsData } = useAvailableEvaluationMetrics(shouldLoadNodeInfo)
  const { mutate: loadNodeInfo } = useEvaluationNodeInfoMutation()
  const availableMetricIds = useMemo(() => availableMetricsData?.metrics ?? [], [availableMetricsData?.metrics])
  const availableMetricIdsKey = availableMetricIds.join(',')
  const resolvedNodeInfoMap = shouldLoadNodeInfo ? nodeInfoMap : {}

  useEffect(() => {
    if (!shouldLoadNodeInfo || availableMetricIds.length === 0)
      return

    let isActive = true

    loadNodeInfo(
      {
        params: {
          targetType: toEvaluationTargetType(resourceType),
          targetId: resourceId,
        },
        body: {
          metrics: availableMetricIds,
        },
      },
      {
        onSuccess: (data) => {
          if (!isActive)
            return

          setNodeInfoMap(data)
        },
        onError: () => {
          if (!isActive)
            return

          setNodeInfoMap({})
        },
      },
    )

    return () => {
      isActive = false
    }
  }, [availableMetricIds, availableMetricIdsKey, loadNodeInfo, resourceId, resourceType, shouldLoadNodeInfo])

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
            availableNodeInfoList={metric.kind === 'builtin' ? (resolvedNodeInfoMap[metric.optionId] ?? []) : undefined}
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
