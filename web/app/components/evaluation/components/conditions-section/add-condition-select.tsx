'use client'

import type { ConditionMetricOptionGroup, EvaluationResourceProps } from '../../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEvaluationStore } from '../../store'
import { getConditionMetricValueTypeTranslationKey } from '../../utils'

type AddConditionSelectProps = EvaluationResourceProps & {
  metricOptionGroups: ConditionMetricOptionGroup[]
  disabled: boolean
}

const AddConditionSelect = ({
  resourceType,
  resourceId,
  metricOptionGroups,
  disabled,
}: AddConditionSelectProps) => {
  const { t } = useTranslation('evaluation')
  const addCondition = useEvaluationStore(state => state.addCondition)
  const [selectKey, setSelectKey] = useState(0)

  return (
    <Select key={selectKey}>
      <SelectTrigger
        aria-label={t('conditions.addCondition')}
        className={cn(
          'inline-flex w-auto min-w-0 border-none bg-transparent px-0 py-0 text-text-accent shadow-none hover:bg-transparent focus-visible:bg-transparent',
          disabled && 'cursor-not-allowed text-components-button-secondary-accent-text-disabled',
        )}
        disabled={disabled}
      >
        <span aria-hidden="true" className="i-ri-add-line h-4 w-4" />
        {t('conditions.addCondition')}
      </SelectTrigger>
      <SelectContent placement="bottom-start" popupClassName="w-[320px]">
        {metricOptionGroups.map(group => (
          <SelectGroup key={group.label}>
            <SelectLabel className="px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary">{group.label}</SelectLabel>
            {group.options.map(option => (
              <SelectItem
                key={option.id}
                value={option.id}
                className="h-auto gap-0 px-3 py-2"
                onClick={() => {
                  addCondition(resourceType, resourceId, option.variableSelector)
                  setSelectKey(current => current + 1)
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="truncate system-sm-medium text-text-secondary">{option.itemLabel}</span>
                  <span className="ml-auto shrink-0 system-xs-medium text-text-tertiary">
                    {t(getConditionMetricValueTypeTranslationKey(option.valueType))}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

export default AddConditionSelect
