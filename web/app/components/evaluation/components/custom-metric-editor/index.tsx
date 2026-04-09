'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
import type { EndNodeType } from '@/app/components/workflow/nodes/end/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppWorkflow } from '@/service/use-workflow'
import { isCustomMetricConfigured, useEvaluationStore } from '../../store'
import MappingRow from './mapping-row'
import WorkflowSelector from './workflow-selector'

type CustomMetricEditorCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

const getWorkflowTargetVariables = (
  nodes?: Array<Node>,
) => {
  const startNode = nodes?.find(node => node.data.type === BlockEnum.Start) as Node<StartNodeType> | undefined
  if (!startNode || !Array.isArray(startNode.data.variables))
    return []

  return startNode.data.variables.map(variable => ({
    id: variable.variable,
    label: typeof variable.label === 'string' ? variable.label : variable.variable,
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
        .map(output => ({
          variable: output.variable,
          valueType: output.value_type,
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

const CustomMetricEditorCard = ({
  resourceType,
  resourceId,
  metric,
}: CustomMetricEditorCardProps) => {
  const { t } = useTranslation('evaluation')
  const setCustomMetricWorkflow = useEvaluationStore(state => state.setCustomMetricWorkflow)
  const addCustomMetricMapping = useEvaluationStore(state => state.addCustomMetricMapping)
  const updateCustomMetricMapping = useEvaluationStore(state => state.updateCustomMetricMapping)
  const removeCustomMetricMapping = useEvaluationStore(state => state.removeCustomMetricMapping)
  const { data: selectedWorkflow } = useAppWorkflow(metric.customConfig?.workflowAppId ?? '')
  const targetOptions = useMemo(() => {
    return getWorkflowTargetVariables(selectedWorkflow?.graph.nodes)
  }, [selectedWorkflow?.graph.nodes])
  const workflowOutputs = useMemo(() => {
    return getWorkflowOutputs(selectedWorkflow?.graph.nodes)
  }, [selectedWorkflow?.graph.nodes])
  const isConfigured = isCustomMetricConfigured(metric)

  if (!metric.customConfig)
    return null

  return (
    <div className="px-3 pt-1 pb-3">
      <WorkflowSelector
        value={metric.customConfig.workflowId}
        selectedWorkflowName={metric.customConfig.workflowName ?? (selectedWorkflow ? getWorkflowName(selectedWorkflow) : null)}
        onSelect={workflow => setCustomMetricWorkflow(resourceType, resourceId, metric.id, {
          workflowId: workflow.id,
          workflowAppId: workflow.app_id,
          workflowName: getWorkflowName(workflow),
        })}
      />

      {!!workflowOutputs.length && (
        <div className="mt-4 py-1">
          <div className="min-h-6 system-xs-medium-uppercase text-text-tertiary">
            {t('metrics.custom.outputTitle')}
          </div>
          <div className="flex flex-wrap items-center gap-y-1 px-2 py-2 system-xs-regular text-text-tertiary">
            {workflowOutputs.map((output, index) => (
              <div key={output.variable} className="flex items-center">
                <span className="px-1 system-xs-medium text-text-secondary">{output.variable}</span>
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

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="system-xs-medium-uppercase text-text-secondary">{t('metrics.custom.mappingTitle')}</div>
          <Button
            size="small"
            variant="ghost"
            className="text-text-accent"
            onClick={() => addCustomMetricMapping(resourceType, resourceId, metric.id)}
          >
            <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
            {t('metrics.custom.addMapping')}
          </Button>
        </div>
        <div className="space-y-2">
          {metric.customConfig.mappings.map(mapping => (
            <MappingRow
              key={mapping.id}
              resourceType={resourceType}
              mapping={mapping}
              targetOptions={targetOptions}
              onUpdate={patch => updateCustomMetricMapping(resourceType, resourceId, metric.id, mapping.id, patch)}
              onRemove={() => removeCustomMetricMapping(resourceType, resourceId, metric.id, mapping.id)}
            />
          ))}
        </div>
        {!isConfigured && (
          <div className="mt-3 rounded-lg bg-background-section px-3 py-2 system-xs-regular text-text-tertiary">
            {t('metrics.custom.mappingWarning')}
          </div>
        )}
      </div>
    </div>
  )
}

export default CustomMetricEditorCard
