'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import type { EndNodeType } from '@/app/components/workflow/nodes/end/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Edge, InputVar, Node } from '@/app/components/workflow/types'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { useAppDetail } from '@/service/use-apps'
import { useSnippetPublishedWorkflow } from '@/service/use-snippet-workflows'
import { useAppWorkflow } from '@/service/use-workflow'
import { isCustomMetricConfigured, useEvaluationStore } from '../../store'
import MappingRow from './mapping-row'
import WorkflowSelector from './workflow-selector'

type CustomMetricEditorCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

const getWorkflowInputVariables = (
  nodes?: Array<Node>,
) => {
  const startNode = nodes?.find(node => node.data.type === BlockEnum.Start) as Node<StartNodeType> | undefined
  if (!startNode || !Array.isArray(startNode.data.variables))
    return []

  return startNode.data.variables.map((variable: InputVar) => ({
    id: variable.variable,
    valueType: inputVarTypeToVarType(variable.type ?? InputVarType.textInput),
  }))
}

const getWorkflowOutputs = (nodes?: Array<Node>) => {
  return (nodes ?? [])
    .filter(node => node.data.type === BlockEnum.End)
    .flatMap((node) => {
      const endNode = node as Node<EndNodeType>
      if (!Array.isArray(endNode.data.outputs))
        return []

      return endNode.data.outputs
        .filter(output => typeof output.variable === 'string' && !!output.variable)
        .map(output => ({
          id: output.variable,
          valueType: typeof output.value_type === 'string' ? output.value_type : null,
          nodeId: endNode.id,
          nodeTitle: typeof endNode.data.title === 'string' && endNode.data.title ? endNode.data.title : 'End',
        }))
    })
}

const getWorkflowName = (workflow: {
  marked_name?: string
  app_name?: string
  id: string
}) => {
  return workflow.marked_name || workflow.app_name || workflow.id
}

const getGraphNodes = (graph?: Record<string, unknown>) => {
  return Array.isArray(graph?.nodes) ? graph.nodes as Node[] : []
}

const getGraphEdges = (graph?: Record<string, unknown>) => {
  return Array.isArray(graph?.edges) ? graph.edges as Edge[] : []
}

const CustomMetricEditorCard = ({
  resourceType,
  resourceId,
  metric,
}: CustomMetricEditorCardProps) => {
  const { t } = useTranslation('evaluation')
  const setCustomMetricWorkflow = useEvaluationStore(state => state.setCustomMetricWorkflow)
  const syncCustomMetricMappings = useEvaluationStore(state => state.syncCustomMetricMappings)
  const syncCustomMetricOutputs = useEvaluationStore(state => state.syncCustomMetricOutputs)
  const updateCustomMetricMapping = useEvaluationStore(state => state.updateCustomMetricMapping)
  const selectedWorkflowAppId = metric.customConfig?.workflowAppId ?? metric.customConfig?.workflowId ?? ''
  const { data: selectedWorkflowApp } = useAppDetail(selectedWorkflowAppId)
  const { data: selectedWorkflow } = useAppWorkflow(selectedWorkflowAppId)
  const { data: currentAppWorkflow } = useAppWorkflow(resourceType === 'apps' ? resourceId : '')
  const { data: currentSnippetWorkflow } = useSnippetPublishedWorkflow(resourceType === 'snippets' ? resourceId : '')
  const inputVariables = useMemo(() => {
    return getWorkflowInputVariables(selectedWorkflow?.graph.nodes)
  }, [selectedWorkflow?.graph.nodes])
  const workflowOutputs = useMemo(() => {
    return getWorkflowOutputs(selectedWorkflow?.graph.nodes)
  }, [selectedWorkflow?.graph.nodes])
  const publishedGraph = useMemo(() => {
    if (resourceType === 'apps') {
      return {
        nodes: currentAppWorkflow?.graph.nodes ?? [],
        edges: currentAppWorkflow?.graph.edges ?? [],
        environmentVariables: currentAppWorkflow?.environment_variables ?? [],
        conversationVariables: currentAppWorkflow?.conversation_variables ?? [],
      }
    }

    return {
      nodes: getGraphNodes(currentSnippetWorkflow?.graph),
      edges: getGraphEdges(currentSnippetWorkflow?.graph),
      environmentVariables: [],
      conversationVariables: [],
    }
  }, [
    currentAppWorkflow?.conversation_variables,
    currentAppWorkflow?.environment_variables,
    currentAppWorkflow?.graph.edges,
    currentAppWorkflow?.graph.nodes,
    currentSnippetWorkflow?.graph,
    resourceType,
  ])
  const inputVariableIds = useMemo(() => inputVariables.map(variable => variable.id), [inputVariables])
  const isConfigured = isCustomMetricConfigured(metric)
  const isSelectedWorkflowLoaded = !!selectedWorkflow

  useEffect(() => {
    if (!metric.customConfig?.workflowId || !isSelectedWorkflowLoaded)
      return

    const currentInputVariableIds = metric.customConfig.mappings
      .map(mapping => mapping.inputVariableId)
      .filter((value): value is string => !!value)

    if (currentInputVariableIds.length === inputVariableIds.length
      && currentInputVariableIds.every((value, index) => value === inputVariableIds[index])) {
      return
    }

    syncCustomMetricMappings(resourceType, resourceId, metric.id, inputVariableIds)
  }, [inputVariableIds, isSelectedWorkflowLoaded, metric.customConfig?.mappings, metric.customConfig?.workflowId, metric.id, resourceId, resourceType, syncCustomMetricMappings])

  useEffect(() => {
    if (!metric.customConfig?.workflowId || !isSelectedWorkflowLoaded)
      return

    const currentOutputs = metric.customConfig.outputs
    if (
      currentOutputs.length === workflowOutputs.length
      && currentOutputs.every((output, index) =>
        output.id === workflowOutputs[index]?.id && output.valueType === workflowOutputs[index]?.valueType,
      )
    ) {
      return
    }

    syncCustomMetricOutputs(resourceType, resourceId, metric.id, workflowOutputs)
  }, [isSelectedWorkflowLoaded, metric.customConfig?.outputs, metric.customConfig?.workflowId, metric.id, resourceId, resourceType, syncCustomMetricOutputs, workflowOutputs])

  if (!metric.customConfig)
    return null

  return (
    <div className="px-3 pt-1 pb-3">
      <WorkflowSelector
        value={metric.customConfig.workflowId}
        selectedWorkflowName={metric.customConfig.workflowName ?? selectedWorkflowApp?.name ?? null}
        onSelect={workflow => setCustomMetricWorkflow(resourceType, resourceId, metric.id, {
          workflowId: workflow.app_id,
          workflowAppId: workflow.app_id,
          workflowName: getWorkflowName(workflow),
        })}
      />

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('metrics.custom.mappingTitle')}</div>
        </div>
        <div className="space-y-2">
          {inputVariables.map((inputVariable) => {
            const mapping = metric.customConfig?.mappings.find(item => item.inputVariableId === inputVariable.id)

            return (
              <MappingRow
                key={inputVariable.id}
                inputVariable={inputVariable}
                publishedGraph={publishedGraph}
                value={mapping?.outputVariableId ?? null}
                onUpdate={(outputVariableId) => {
                  if (!mapping)
                    return

                  updateCustomMetricMapping(resourceType, resourceId, metric.id, mapping.id, { outputVariableId })
                }}
              />
            )
          })}
        </div>
        {!isConfigured && (
          <div className="mt-3 rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
            {t('metrics.custom.mappingWarning')}
          </div>
        )}
      </div>

      {!!workflowOutputs.length && (
        <div className="mt-4 py-1">
          <div className="min-h-6 system-xs-medium-uppercase text-text-tertiary">
            {t('metrics.custom.outputTitle')}
          </div>
          <div className="flex flex-wrap items-center gap-y-1 px-2 py-2 system-xs-regular text-text-tertiary">
            {workflowOutputs.map((output, index) => (
              <div key={`${output.nodeId}-${output.id}`} className="flex items-center">
                <span className="px-1 system-xs-medium text-text-secondary">{output.id}</span>
                {output.valueType && (
                  <span>{output.valueType}</span>
                )}
                {index < workflowOutputs.length - 1 && (
                  <span className="pl-0.5">,</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default CustomMetricEditorCard
