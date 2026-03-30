'use client'

import type { CustomMetricMapping, EvaluationMetric, EvaluationResourceProps, EvaluationResourceType } from '../types'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
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
import { getEvaluationMockConfig } from '../mock'
import { isCustomMetricConfigured, useEvaluationStore } from '../store'
import { groupFieldOptions } from '../utils'

type CustomMetricEditorProps = EvaluationResourceProps & {
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
    <div className="grid gap-2 rounded-xl border border-divider-subtle bg-components-card-bg p-3 xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
      <Select value={mapping.sourceFieldId ?? ''} onValueChange={value => onUpdate({ sourceFieldId: value })}>
        <SelectTrigger>
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
        <SelectTrigger>
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

const CustomMetricEditor = ({
  resourceType,
  resourceId,
  metric,
}: CustomMetricEditorProps) => {
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
    <div className="mt-4 rounded-xl border border-divider-subtle bg-background-default-subtle p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-text-primary system-sm-semibold">{t('metrics.custom.title')}</div>
          <div className="mt-1 text-text-tertiary system-xs-regular">{t('metrics.custom.description')}</div>
        </div>
        {!isConfigured && <Badge className="badge-warning">{t('metrics.custom.warningBadge')}</Badge>}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="mb-2 text-text-secondary system-xs-medium-uppercase">{t('metrics.custom.workflowLabel')}</div>
          <Select value={metric.customConfig.workflowId ?? ''} onValueChange={value => value && setCustomMetricWorkflow(resourceType, resourceId, metric.id, value)}>
            <SelectTrigger>
              <SelectValue placeholder={t('metrics.custom.workflowPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {config.workflowOptions.map(option => (
                <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedWorkflow && <div className="mt-2 text-text-tertiary system-xs-regular">{selectedWorkflow.description}</div>}
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-text-secondary system-xs-medium-uppercase">{t('metrics.custom.mappingTitle')}</div>
            <Button size="small" variant="ghost" onClick={() => addCustomMetricMapping(resourceType, resourceId, metric.id)}>
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
            <div className="mt-3 rounded-xl border border-divider-subtle bg-background-default-subtle px-3 py-2 text-text-tertiary system-xs-regular">
              {t('metrics.custom.mappingWarning')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CustomMetricEditor
