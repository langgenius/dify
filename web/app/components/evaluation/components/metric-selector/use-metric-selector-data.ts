import type { MetricOption, NonPipelineEvaluationResourceType } from '../../types'
import type { BuiltinMetricMap, MetricSelectorSection } from './types'
import type { NodeInfo } from '@/types/evaluation'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDefaultEvaluationMetrics } from '@/service/use-evaluation'
import { getTranslatedMetricDescription } from '../../default-metric-descriptions'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import {
  buildMetricOption,
  dedupeNodeInfoList,
  getDefaultMetricNodeInfoMap,
} from './utils'

type UseMetricSelectorDataOptions = {
  open: boolean
  query: string
  resourceType: NonPipelineEvaluationResourceType
  resourceId: string
}

type UseMetricSelectorDataResult = {
  builtinMetricMap: BuiltinMetricMap
  filteredSections: MetricSelectorSection[]
  isRemoteLoading: boolean
  toggleNodeSelection: (metric: MetricOption, nodeInfo: NodeInfo) => void
}

export const useMetricSelectorData = ({
  open,
  query,
  resourceType,
  resourceId,
}: UseMetricSelectorDataOptions): UseMetricSelectorDataResult => {
  const { t } = useTranslation('evaluation')
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const { data: defaultMetricsData, isLoading: isDefaultMetricsLoading } = useDefaultEvaluationMetrics(resourceType, resourceId, open)

  const builtinMetrics = useMemo(() => {
    return metrics.filter(metric => metric.kind === 'builtin')
  }, [metrics])

  const builtinMetricMap = useMemo(() => {
    return new Map(builtinMetrics.map(metric => [metric.optionId, metric] as const))
  }, [builtinMetrics])

  const defaultMetrics = useMemo(() => defaultMetricsData?.default_metrics ?? [], [defaultMetricsData?.default_metrics])
  const nodeInfoMap = useMemo(() => getDefaultMetricNodeInfoMap(defaultMetrics), [defaultMetrics])

  const resolvedMetrics = useMemo(() => {
    return defaultMetrics
      .map((defaultMetric) => {
        if (!defaultMetric.metric)
          return null

        return buildMetricOption(defaultMetric.metric, defaultMetric.value_type)
      })
      .filter((metric): metric is MetricOption => !!metric)
  }, [defaultMetrics])

  const filteredSections = useMemo(() => {
    const keyword = query.trim().toLowerCase()

    return resolvedMetrics.map((metric) => {
      const metricDescription = getTranslatedMetricDescription(t, metric.id, metric.description)
      const metricMatches = !keyword
        || metric.label.toLowerCase().includes(keyword)
        || metricDescription.toLowerCase().includes(keyword)
      const metricNodes = nodeInfoMap[metric.id] ?? []
      const hasNoNodeInfo = metricNodes.length === 0

      if (hasNoNodeInfo) {
        if (!metricMatches)
          return null

        return {
          metric: {
            ...metric,
            description: metricDescription,
          },
          hasNoNodeInfo: true,
          visibleNodes: [] as NodeInfo[],
        }
      }

      const visibleNodes = metricMatches
        ? metricNodes
        : metricNodes.filter((nodeInfo) => {
            return nodeInfo.title.toLowerCase().includes(keyword)
              || nodeInfo.type.toLowerCase().includes(keyword)
              || nodeInfo.node_id.toLowerCase().includes(keyword)
          })

      if (!metricMatches && visibleNodes.length === 0)
        return null

      return {
        metric: {
          ...metric,
          description: metricDescription,
        },
        hasNoNodeInfo: false,
        visibleNodes,
      }
    }).filter((section): section is MetricSelectorSection => !!section)
  }, [nodeInfoMap, query, resolvedMetrics, t])

  const toggleNodeSelection = (metric: MetricOption, nodeInfo: NodeInfo) => {
    const metricId = metric.id
    const addedMetric = builtinMetricMap.get(metricId)
    const currentSelectedNodes = addedMetric?.nodeInfoList ?? []

    const nextSelectedNodes = addedMetric && currentSelectedNodes.length === 0
      ? [nodeInfo]
      : currentSelectedNodes.some(item => item.node_id === nodeInfo.node_id)
        ? currentSelectedNodes.filter(item => item.node_id !== nodeInfo.node_id)
        : dedupeNodeInfoList([...currentSelectedNodes, nodeInfo])

    if (addedMetric && nextSelectedNodes.length === 0) {
      removeMetric(resourceType, resourceId, addedMetric.id)
      return
    }

    addBuiltinMetric(resourceType, resourceId, metricId, nextSelectedNodes, metric)
  }

  return {
    builtinMetricMap,
    filteredSections,
    isRemoteLoading: isDefaultMetricsLoading,
    toggleNodeSelection,
  }
}
