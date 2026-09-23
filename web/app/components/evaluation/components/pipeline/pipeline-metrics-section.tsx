'use client'

import type { EvaluationResourceProps } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetEvaluationMetrics } from '../../queries'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { buildMetricOption } from '../metric-selector/utils'
import { InlineSectionHeader } from '../section-header'
import PipelineMetricItem from './pipeline-metric-item'

const PipelineMetricsSection = ({ resourceType, resourceId }: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const addBuiltinMetric = useEvaluationStore((state) => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore((state) => state.removeMetric)
  const updateMetricThreshold = useEvaluationStore((state) => state.updateMetricThreshold)
  const { data: datasetMetricsData } = useDatasetEvaluationMetrics(resourceId)
  const resource = useEvaluationResource(resourceType, resourceId)
  const builtinMetricMap = useMemo(
    () =>
      new Map(
        resource.metrics
          .filter((metric) => metric.kind === 'builtin')
          .map((metric) => [metric.optionId, metric]),
      ),
    [resource.metrics],
  )
  const availableBuiltinMetrics = useMemo(() => {
    const responseMetrics = Array.isArray(datasetMetricsData?.metrics)
      ? datasetMetricsData.metrics
      : Object.values(datasetMetricsData?.metrics ?? {}).flat()
    const metricIds = new Set([...responseMetrics, ...builtinMetricMap.keys()])

    return Array.from(metricIds).map((metricId) => buildMetricOption(metricId))
  }, [datasetMetricsData?.metrics, builtinMetricMap])

  const handleToggleMetric = (metricId: string) => {
    const selectedMetric = builtinMetricMap.get(metricId)
    if (selectedMetric) {
      removeMetric(resourceType, resourceId, selectedMetric.id)
      return
    }

    const metricOption = availableBuiltinMetrics.find((metric) => metric.id === metricId)
    addBuiltinMetric(resourceType, resourceId, metricId, [], metricOption)
  }

  return (
    <section>
      <InlineSectionHeader
        title={t(($) => $['metrics.title'])}
        tooltip={t(($) => $['metrics.description'])}
      />
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
              onThresholdChange={(value) =>
                updateMetricThreshold(resourceType, resourceId, selectedMetric?.id ?? '', value)
              }
            />
          )
        })}
      </div>
    </section>
  )
}

export default PipelineMetricsSection
