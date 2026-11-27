import type { NodeInfo } from '@dify/contracts/api/console/evaluate-target-type/types.gen'
import type { MetricOption, NonPipelineEvaluationResourceType } from '../../types'
import type { BuiltinMetricMap, MetricSelectorSection } from './types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { getTranslatedMetricDescription } from '../../default-metric-descriptions'
import { useDefaultEvaluationMetrics } from '../../queries'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { isBuiltinMetricSupportedByFramework } from '../../store-utils'
import { buildMetricOption, dedupeNodeInfoList, getDefaultMetricNodeInfoMap } from './utils'

type UseMetricSelectorDataOptions = {
  open: boolean
  resourceType: NonPipelineEvaluationResourceType
  resourceId: string
}

type UseMetricSelectorDataResult = {
  builtinMetricMap: BuiltinMetricMap
  sections: MetricSelectorSection[]
  isRemoteLoading: boolean
  remoteLoadError: unknown
  isRemoteRetrying: boolean
  retryRemoteLoad: () => void
  toggleNodeSelection: (metric: MetricOption, nodeInfo: NodeInfo) => void
}

export const useMetricSelectorData = ({
  open,
  resourceType,
  resourceId,
}: UseMetricSelectorDataOptions): UseMetricSelectorDataResult => {
  const { t } = useTranslation(['evaluation'])
  const resource = useEvaluationResource(resourceType, resourceId)
  const metrics = resource.metrics
  const addBuiltinMetric = useEvaluationStore((state) => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore((state) => state.removeMetric)
  const defaultMetricsQuery = useDefaultEvaluationMetrics(
    resourceType,
    resourceId,
    resource.evaluationFramework,
    open,
  )
  const { data: defaultMetricsData, isLoading: isDefaultMetricsLoading } = defaultMetricsQuery

  const builtinMetrics = useMemo(() => {
    return metrics.filter((metric) => metric.kind === 'builtin')
  }, [metrics])

  const builtinMetricMap = useMemo(() => {
    return new Map(builtinMetrics.map((metric) => [metric.optionId, metric] as const))
  }, [builtinMetrics])

  const defaultMetrics = useMemo(
    () => defaultMetricsData?.default_metrics ?? [],
    [defaultMetricsData?.default_metrics],
  )
  const nodeInfoMap = useMemo(() => getDefaultMetricNodeInfoMap(defaultMetrics), [defaultMetrics])

  const resolvedMetrics = useMemo(() => {
    return defaultMetrics
      .filter((defaultMetric) =>
        isBuiltinMetricSupportedByFramework(defaultMetric.metric, resource.evaluationFramework),
      )
      .map((defaultMetric) => {
        if (!defaultMetric.metric) return null

        return buildMetricOption(defaultMetric.metric, defaultMetric.value_type)
      })
      .filter((metric): metric is MetricOption => !!metric)
  }, [defaultMetrics, resource.evaluationFramework])

  const sections = useMemo(
    () =>
      resolvedMetrics.map((metric) => {
        const nodes = nodeInfoMap[metric.id] ?? []

        return {
          metric: {
            ...metric,
            description: getTranslatedMetricDescription(t, metric.id, metric.description),
          },
          nodes,
        }
      }),
    [nodeInfoMap, resolvedMetrics, t],
  )

  const toggleNodeSelection = (metric: MetricOption, nodeInfo: NodeInfo) => {
    const metricId = metric.id
    const addedMetric = builtinMetricMap.get(metricId)
    const currentSelectedNodes = addedMetric?.nodeInfoList ?? []

    const nextSelectedNodes =
      addedMetric && currentSelectedNodes.length === 0
        ? [nodeInfo]
        : currentSelectedNodes.some((item) => item.node_id === nodeInfo.node_id)
          ? currentSelectedNodes.filter((item) => item.node_id !== nodeInfo.node_id)
          : dedupeNodeInfoList([...currentSelectedNodes, nodeInfo])

    if (addedMetric && nextSelectedNodes.length === 0) {
      removeMetric(resourceType, resourceId, addedMetric.id)
      return
    }

    addBuiltinMetric(resourceType, resourceId, metricId, nextSelectedNodes, metric)
  }

  // A failed first load is not an empty metric list. The open selector renders it in place of the
  // sections, so it is claimed here.
  const remoteLoad = useOwnedQueryErrors(open ? [defaultMetricsQuery] : [])

  return {
    builtinMetricMap,
    sections,
    isRemoteLoading: isDefaultMetricsLoading,
    remoteLoadError: remoteLoad?.error ?? null,
    isRemoteRetrying: remoteLoad?.retrying ?? false,
    retryRemoteLoad: () => {
      remoteLoad?.retry()
    },
    toggleNodeSelection,
  }
}
