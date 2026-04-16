import type { BuiltinMetricMap, MetricSelectorSection } from './types'
import type { NodeInfo } from '@/types/evaluation'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAvailableEvaluationMetrics, useEvaluationNodeInfoMutation } from '@/service/use-evaluation'
import { getTranslatedMetricDescription } from '../../default-metric-descriptions'
import { getEvaluationMockConfig } from '../../mock'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import {
  buildMetricOption,
  dedupeNodeInfoList,
  toEvaluationTargetType,
} from './utils'

type UseMetricSelectorDataOptions = {
  open: boolean
  query: string
  resourceType: 'apps' | 'datasets' | 'snippets'
  resourceId: string
  nodeInfoMap: Record<string, NodeInfo[]>
  setNodeInfoMap: (value: Record<string, NodeInfo[]>) => void
}

type UseMetricSelectorDataResult = {
  builtinMetricMap: BuiltinMetricMap
  filteredSections: MetricSelectorSection[]
  isRemoteLoading: boolean
  toggleNodeSelection: (metricId: string, nodeInfo: NodeInfo) => void
}

export const useMetricSelectorData = ({
  open,
  query,
  resourceType,
  resourceId,
  nodeInfoMap,
  setNodeInfoMap,
}: UseMetricSelectorDataOptions): UseMetricSelectorDataResult => {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)
  const metrics = useEvaluationResource(resourceType, resourceId).metrics
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const { data: availableMetricsData, isLoading: isAvailableMetricsLoading } = useAvailableEvaluationMetrics(open)
  const { mutate: loadNodeInfo, isPending: isNodeInfoLoading } = useEvaluationNodeInfoMutation()

  const builtinMetrics = useMemo(() => {
    return metrics.filter(metric => metric.kind === 'builtin')
  }, [metrics])

  const builtinMetricMap = useMemo(() => {
    return new Map(builtinMetrics.map(metric => [metric.optionId, metric] as const))
  }, [builtinMetrics])

  const availableMetricIds = useMemo(() => availableMetricsData?.metrics ?? [], [availableMetricsData?.metrics])
  const availableMetricIdsKey = availableMetricIds.join(',')

  const resolvedMetrics = useMemo(() => {
    const metricsMap = new Map(config.builtinMetrics.map(metric => [metric.id, metric] as const))

    return availableMetricIds.map(metricId => metricsMap.get(metricId) ?? buildMetricOption(metricId))
  }, [availableMetricIds, config.builtinMetrics])

  useEffect(() => {
    if (!open)
      return

    if (resourceType === 'datasets' || !resourceId || availableMetricIds.length === 0)
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
  }, [availableMetricIds, availableMetricIdsKey, loadNodeInfo, open, resourceId, resourceType, setNodeInfoMap])

  const filteredSections = useMemo(() => {
    const keyword = query.trim().toLowerCase()

    return resolvedMetrics.map((metric) => {
      const metricDescription = getTranslatedMetricDescription(t, metric.id, metric.description)
      const metricMatches = !keyword
        || metric.label.toLowerCase().includes(keyword)
        || metricDescription.toLowerCase().includes(keyword)
      const metricNodes = nodeInfoMap[metric.id] ?? []
      const supportsNodeSelection = resourceType !== 'datasets'
      const hasNoNodeInfo = supportsNodeSelection && metricNodes.length === 0

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
    }).filter(section => !!section)
  }, [nodeInfoMap, query, resolvedMetrics, resourceType, t])

  const toggleNodeSelection = (metricId: string, nodeInfo: NodeInfo) => {
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

    addBuiltinMetric(resourceType, resourceId, metricId, nextSelectedNodes)
  }

  return {
    builtinMetricMap,
    filteredSections,
    isRemoteLoading: isAvailableMetricsLoading || isNodeInfoLoading,
    toggleNodeSelection,
  }
}
