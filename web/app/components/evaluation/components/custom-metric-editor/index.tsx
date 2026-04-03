'use client'

import type { CustomMetricMapping, EvaluationMetric, EvaluationResourceProps, EvaluationResourceType } from '../../types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { Node } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppWorkflow } from '@/service/use-workflow'
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../../mock'
import { isCustomMetricConfigured, useEvaluationStore } from '../../store'
import { groupFieldOptions } from '../../utils'
import WorkflowSelector from './workflow-selector'

type CustomMetricEditorCardProps = EvaluationResourceProps & {
  metric: EvaluationMetric
}

type MappingRowProps = {
  resourceType: EvaluationResourceType
  mapping: CustomMetricMapping
  targetOptions: Array<{ id: string, label: string }>
  onUpdate: (patch: { sourceFieldId?: string | null, targetVariableId?: string | null }) => void
  onRemove: () => void
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

function MappingRow({
  resourceType,
  mapping,
  targetOptions,
  onUpdate,
  onRemove,
}: MappingRowProps) {
  const { t } = useTranslation('evaluation')
  const config = getEvaluationMockConfig(resourceType)

  return (
    <div className="grid gap-2 rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-card-bg p-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      <Select value={mapping.sourceFieldId ?? ''} onValueChange={value => onUpdate({ sourceFieldId: value })}>
        <SelectTrigger className="bg-transparent hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
          <SelectValue placeholder={t('metrics.custom.sourcePlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {groupFieldOptions(config.fieldOptions).map(([groupName, fields]) => (
            <SelectGroup key={groupName}>
              <SelectGroupLabel>{groupName}</SelectGroupLabel>
              {fields.map(field => (
                <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-center text-text-quaternary">
        <span aria-hidden="true" className="i-ri-arrow-down-s-line h-4 w-4 -rotate-90" />
      </div>
      <Select value={mapping.targetVariableId ?? ''} onValueChange={value => onUpdate({ targetVariableId: value })}>
        <SelectTrigger className="bg-transparent hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt">
          <SelectValue placeholder={t('metrics.custom.targetPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {targetOptions.map(option => (
            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="small" aria-label={t('metrics.remove')} onClick={onRemove}>
        <span aria-hidden="true" className="i-ri-delete-bin-line h-4 w-4" />
      </Button>
    </div>
  )
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
