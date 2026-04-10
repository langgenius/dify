'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAvailableEvaluationMetrics } from '@/service/use-evaluation'
import { getEvaluationMockConfig } from '../../mock'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { InlineSectionHeader } from '../section-header'
import PipelineMetricItem from './pipeline-metric-item'

const PipelineMetricsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const updateMetricThreshold = useEvaluationStore(state => state.updateMetricThreshold)
  const { data: availableMetricsData } = useAvailableEvaluationMetrics()
  const resource = useEvaluationResource(resourceType, resourceId)
  const config = getEvaluationMockConfig(resourceType)
  const builtinMetricMap = useMemo(() => new Map(
    resource.metrics
      .filter(metric => metric.kind === 'builtin')
      .map(metric => [metric.optionId, metric]),
  ), [resource.metrics])
  const availableMetricIds = useMemo(() => new Set(availableMetricsData?.metrics ?? []), [availableMetricsData?.metrics])
  const availableBuiltinMetrics = useMemo(() => {
    return config.builtinMetrics.filter(metric =>
      availableMetricIds.has(metric.id) || builtinMetricMap.has(metric.id),
    )
  }, [availableMetricIds, builtinMetricMap, config.builtinMetrics])

  const handleToggleMetric = (metricId: string) => {
    const selectedMetric = builtinMetricMap.get(metricId)
    if (selectedMetric) {
      removeMetric(resourceType, resourceId, selectedMetric.id)
      return
    }

    addBuiltinMetric(resourceType, resourceId, metricId)
  }

  return (
    <section>
      <InlineSectionHeader title={t('metrics.title')} tooltip={t('metrics.description')} />
      <div className="mt-1 space-y-0.5">
        {availableBuiltinMetrics.map((metric) => {
          const selectedMetric = builtinMetricMap.get(metric.id)

          return (
            <PipelineMetricItem
              key={metric.id}
              metric={metric}
              selected={!!selectedMetric}
              threshold={selectedMetric?.threshold}
              disabledCondition
              onToggle={() => handleToggleMetric(metric.id)}
              onThresholdChange={value => updateMetricThreshold(resourceType, resourceId, selectedMetric?.id ?? '', value)}
            />
          )
        })}
      </div>
    </section>
  )
}

export default PipelineMetricsSection
