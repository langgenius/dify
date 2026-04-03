'use client'

import type { EvaluationMetric, EvaluationResourceProps } from '../../types'
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
  const isConfigured = isCustomMetricConfigured(metric)

  if (!metric.customConfig)
    return null

  return (
    <div className="px-3 pb-3 pt-1">
      <WorkflowSelector
        value={metric.customConfig.workflowId}
        selectedWorkflowName={metric.customConfig.workflowName ?? (selectedWorkflow ? getWorkflowName(selectedWorkflow) : null)}
        onSelect={workflow => setCustomMetricWorkflow(resourceType, resourceId, metric.id, {
          workflowId: workflow.id,
          workflowAppId: workflow.app_id,
          workflowName: getWorkflowName(workflow),
        })}
      />

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-text-secondary system-xs-medium-uppercase">{t('metrics.custom.mappingTitle')}</div>
          <Button
            size="small"
            variant="ghost"
            className="text-text-accent"
            onClick={() => addCustomMetricMapping(resourceType, resourceId, metric.id)}
          >
            <span aria-hidden="true" className="i-ri-add-line mr-1 h-4 w-4" />
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
          <div className="mt-3 rounded-lg bg-background-section px-3 py-2 text-text-tertiary system-xs-regular">
            {t('metrics.custom.mappingWarning')}
          </div>
        )}
      </div>
    </div>
  )
}

export default CustomMetricEditorCard
