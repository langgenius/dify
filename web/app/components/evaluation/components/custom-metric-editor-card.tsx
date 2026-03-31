'use client'

import type { CustomMetricMapping, EvaluationMetric, EvaluationResourceProps, EvaluationResourceType } from '../types'
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
import { cn } from '@/utils/classnames'
import { getEvaluationMockConfig } from '../mock'
import { isCustomMetricConfigured, useEvaluationStore } from '../store'
import { groupFieldOptions } from '../utils'

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
  const config = getEvaluationMockConfig(resourceType)
  const setCustomMetricWorkflow = useEvaluationStore(state => state.setCustomMetricWorkflow)
  const addCustomMetricMapping = useEvaluationStore(state => state.addCustomMetricMapping)
  const updateCustomMetricMapping = useEvaluationStore(state => state.updateCustomMetricMapping)
  const removeCustomMetricMapping = useEvaluationStore(state => state.removeCustomMetricMapping)
  const selectedWorkflow = config.workflowOptions.find(option => option.id === metric.customConfig?.workflowId)
  const isConfigured = isCustomMetricConfigured(metric)

  if (!metric.customConfig)
    return null

  return (
    <div className="px-3 pb-3 pt-1">
      <Select value={metric.customConfig.workflowId ?? ''} onValueChange={value => value && setCustomMetricWorkflow(resourceType, resourceId, metric.id, value)}>
        <SelectTrigger className="h-auto rounded-lg bg-components-input-bg-normal p-1 hover:bg-components-input-bg-normal focus-visible:bg-components-input-bg-normal">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center">
              <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                <span aria-hidden="true" className="i-ri-equalizer-2-line h-3.5 w-3.5 text-text-tertiary" />
              </div>
            </div>
            <div className="min-w-0 flex-1 px-1 py-1 text-left">
              <div className={cn('truncate system-sm-regular', selectedWorkflow ? 'text-text-secondary' : 'text-components-input-text-placeholder')}>
                {selectedWorkflow?.label ?? t('metrics.custom.workflowPlaceholder')}
              </div>
            </div>
          </div>
        </SelectTrigger>
        <SelectContent>
          {config.workflowOptions.map(option => (
            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

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
              targetOptions={selectedWorkflow?.targetVariables ?? []}
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
