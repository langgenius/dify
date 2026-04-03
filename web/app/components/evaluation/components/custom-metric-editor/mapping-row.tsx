'use client'

import type { CustomMetricMapping, EvaluationResourceType } from '../../types'
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
import { getEvaluationMockConfig } from '../../mock'
import { groupFieldOptions } from '../../utils'

type MappingRowProps = {
  resourceType: EvaluationResourceType
  mapping: CustomMetricMapping
  targetOptions: Array<{ id: string, label: string }>
  onUpdate: (patch: { sourceFieldId?: string | null, targetVariableId?: string | null }) => void
  onRemove: () => void
}

const MappingRow = ({
  resourceType,
  mapping,
  targetOptions,
  onUpdate,
  onRemove,
}: MappingRowProps) => {
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

export default MappingRow
