'use client'

import type { EvaluationResourceProps } from '../../types'
import type { Node } from '@/app/components/workflow/types'
import type { NodeInfo } from '@/types/evaluation'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BlockEnum } from '@/app/components/workflow/types'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useDatasetEvaluationMetrics } from '@/service/use-evaluation'
import { usePublishedPipelineInfo } from '@/service/use-pipeline'
import { useEvaluationResource, useEvaluationStore } from '../../store'
import { buildMetricOption } from '../metric-selector/utils'
import { InlineSectionHeader } from '../section-header'
import PipelineMetricItem from './pipeline-metric-item'

const getKnowledgeIndexNodeInfo = (nodes: Node[] | undefined): NodeInfo[] => {
  const knowledgeIndexNode = nodes?.find(node => node.data.type === BlockEnum.KnowledgeBase)
  if (!knowledgeIndexNode?.id)
    return []

  return [{
    node_id: knowledgeIndexNode.id,
    title: typeof knowledgeIndexNode.data?.title === 'string' && knowledgeIndexNode.data.title
      ? knowledgeIndexNode.data.title
      : knowledgeIndexNode.id,
    type: 'knowledge-index',
  }]
}

const isSameNodeInfoList = (left: NodeInfo[] | undefined, right: NodeInfo[]) => {
  if ((left?.length ?? 0) !== right.length)
    return false

  return (left ?? []).every((nodeInfo, index) => {
    const target = right[index]
    return nodeInfo.node_id === target?.node_id
      && nodeInfo.title === target?.title
      && nodeInfo.type === target?.type
  })
}

const PipelineMetricsSection = ({
  resourceType,
  resourceId,
}: EvaluationResourceProps) => {
  const { t } = useTranslation('evaluation')
  const pipelineId = useDatasetDetailContextWithSelector(state => state.dataset?.pipeline_id)
  const addBuiltinMetric = useEvaluationStore(state => state.addBuiltinMetric)
  const removeMetric = useEvaluationStore(state => state.removeMetric)
  const updateMetricThreshold = useEvaluationStore(state => state.updateMetricThreshold)
  const { data: datasetMetricsData } = useDatasetEvaluationMetrics(resourceId)
  const { data: publishedPipeline } = usePublishedPipelineInfo(pipelineId || '')
  const resource = useEvaluationResource(resourceType, resourceId)
  const knowledgeIndexNodeInfoList = useMemo(
    () => getKnowledgeIndexNodeInfo(publishedPipeline?.graph.nodes),
    [publishedPipeline?.graph.nodes],
  )
  const builtinMetricMap = useMemo(() => new Map(
    resource.metrics
      .filter(metric => metric.kind === 'builtin')
      .map(metric => [metric.optionId, metric]),
  ), [resource.metrics])
  const availableBuiltinMetrics = useMemo(() => {
    const metricIds = new Set([
      ...(datasetMetricsData?.metrics ?? []),
      ...builtinMetricMap.keys(),
    ])

    return Array.from(metricIds).map(metricId => buildMetricOption(metricId))
  }, [datasetMetricsData?.metrics, builtinMetricMap])

  useEffect(() => {
    if (!knowledgeIndexNodeInfoList.length)
      return

    resource.metrics.forEach((metric) => {
      if (metric.kind !== 'builtin' || isSameNodeInfoList(metric.nodeInfoList, knowledgeIndexNodeInfoList))
        return

      addBuiltinMetric(resourceType, resourceId, metric.optionId, knowledgeIndexNodeInfoList, metric)
    })
  }, [addBuiltinMetric, knowledgeIndexNodeInfoList, resource.metrics, resourceId, resourceType])

  const handleToggleMetric = (metricId: string) => {
    const selectedMetric = builtinMetricMap.get(metricId)
    if (selectedMetric) {
      removeMetric(resourceType, resourceId, selectedMetric.id)
      return
    }

    const metricOption = availableBuiltinMetrics.find(metric => metric.id === metricId)
    addBuiltinMetric(resourceType, resourceId, metricId, knowledgeIndexNodeInfoList, metricOption)
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
