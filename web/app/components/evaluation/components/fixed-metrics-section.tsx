'use client'

import type { MetricOption } from '../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDatasetEvaluationMetrics, useDefaultEvaluationMetrics } from '../queries'
import { useEvaluationResource, useEvaluationStore } from '../store'
import { isBuiltinMetricSupportedByFramework } from '../store-utils'
import { useSyncNodeTitles } from '../use-sync-node-titles'
import FixedMetricItem from './fixed-metric-item'
import CustomMetricCard from './metric-section/custom-metric-card'
import { buildMetricOption, getDefaultMetricNodeInfoMap } from './metric-selector/utils'
import { InlineSectionHeader } from './section-header'
import UnsupportedMetricsWarning from './unsupported-metrics-warning'

type FixedMetricsSectionProps = {
  resourceType: 'agents' | 'datasets'
  resourceId: string
}

const FixedMetricsSection = ({ resourceType, resourceId }: FixedMetricsSectionProps) => {
  const { t } = useTranslation(['evaluation'])
  const addBuiltinMetric = useEvaluationStore((state) => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore((state) => state.removeMetric)
  const resource = useEvaluationResource(resourceType, resourceId)
  const { data: datasetMetricsData } = useDatasetEvaluationMetrics(
    resourceId,
    resource.evaluationFramework,
    resourceType === 'datasets',
  )
  const { data: agentMetricsData } = useDefaultEvaluationMetrics(
    'agents',
    resourceId,
    resource.evaluationFramework,
    resourceType === 'agents',
  )
  const builtinMetricMap = useMemo(
    () =>
      new Map(
        resource.metrics
          .filter((metric) => metric.kind === 'builtin')
          .map((metric) => [metric.optionId, metric]),
      ),
    [resource.metrics],
  )
  // Agent node titles are the agent's name, which can change after the config is saved.
  useSyncNodeTitles(resourceType, resourceId, agentMetricsData?.default_metrics)
  const agentNodeInfoMap = useMemo(
    () => getDefaultMetricNodeInfoMap(agentMetricsData?.default_metrics ?? []),
    [agentMetricsData?.default_metrics],
  )
  const availableBuiltinMetrics = useMemo(() => {
    const options = new Map<string, MetricOption>()

    if (resourceType === 'datasets') {
      const responseMetrics = Array.isArray(datasetMetricsData?.metrics)
        ? datasetMetricsData.metrics
        : Object.values(datasetMetricsData?.metrics ?? {}).flat()
      responseMetrics.forEach((metricId) => {
        if (isBuiltinMetricSupportedByFramework(metricId, resource.evaluationFramework))
          options.set(metricId, buildMetricOption(metricId))
      })
    } else {
      agentMetricsData?.default_metrics.forEach((metric) => {
        if (
          isBuiltinMetricSupportedByFramework(metric.metric, resource.evaluationFramework) &&
          agentNodeInfoMap[metric.metric]?.some(
            (node) => node.node_id === resourceId && node.type === 'agent',
          )
        )
          options.set(metric.metric, buildMetricOption(metric.metric, metric.value_type))
      })
    }

    builtinMetricMap.forEach((metric) => {
      if (!options.has(metric.optionId)) {
        options.set(metric.optionId, {
          id: metric.optionId,
          label: metric.label,
          description: metric.description,
          valueType: metric.valueType,
        })
      }
    })

    return Array.from(options.values())
  }, [
    resourceType,
    resource.evaluationFramework,
    datasetMetricsData?.metrics,
    agentMetricsData?.default_metrics,
    agentNodeInfoMap,
    builtinMetricMap,
    resourceId,
  ])
  const customMetric =
    resourceType === 'agents'
      ? resource.metrics.find((metric) => metric.kind === 'custom-workflow')
      : undefined

  const handleToggleMetric = (metricId: string) => {
    const selectedMetric = builtinMetricMap.get(metricId)
    if (selectedMetric) {
      removeMetric(resourceType, resourceId, selectedMetric.id)
      return
    }

    const metricOption = availableBuiltinMetrics.find((metric) => metric.id === metricId)
    const nodeInfoList =
      resourceType === 'agents'
        ? (agentNodeInfoMap[metricId] ?? []).filter(
            (node) => node.node_id === resourceId && node.type === 'agent',
          )
        : []
    if (resourceType === 'agents' && nodeInfoList.length !== 1) return

    addBuiltinMetric(resourceType, resourceId, metricId, nodeInfoList, metricOption)
  }

  return (
    <section className="max-w-[700px] py-4">
      <InlineSectionHeader
        title={t(($) => $['metrics.title'])}
        tooltip={t(($) => $['metrics.description'])}
      />
      <div className="mt-1 space-y-1">
        <UnsupportedMetricsWarning resourceType={resourceType} resourceId={resourceId} />
        {availableBuiltinMetrics.map((metric) => {
          const selectedMetric = builtinMetricMap.get(metric.id)

          return (
            <FixedMetricItem
              key={metric.id}
              metric={metric}
              selected={!!selectedMetric}
              onToggle={() => handleToggleMetric(metric.id)}
            />
          )
        })}
        {resourceType === 'agents' && customMetric && (
          <div className="pt-2">
            <CustomMetricCard
              resourceType={resourceType}
              resourceId={resourceId}
              metric={customMetric}
            />
          </div>
        )}
      </div>
    </section>
  )
}

export default FixedMetricsSection
