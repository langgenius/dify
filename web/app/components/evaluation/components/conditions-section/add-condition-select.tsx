'use client'

import type { ConditionMetricOptionGroup, EvaluationResourceProps } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
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
  const [open, setOpen] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled)
      return

    setOpen(nextOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={(
          <Button
            variant="ghost-accent"
            aria-label={t('conditions.addCondition')}
            disabled={disabled}
          >
            <span aria-hidden="true" className="mr-1 i-ri-add-line h-4 w-4" />
            {t('conditions.addCondition')}
          </Button>
        )}
      />
      <PopoverContent
        placement="bottom-start"
        popupClassName="w-[320px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border p-0 shadow-[0px_12px_16px_-4px_rgba(9,9,11,0.08),0px_4px_6px_-2px_rgba(9,9,11,0.03)]"
      >
        <div className="max-h-[360px] overflow-y-auto bg-components-panel-bg p-1" role="menu">
          {metricOptionGroups.map(group => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="px-3 pt-2 pb-1 system-xs-medium-uppercase text-text-tertiary">{group.label}</div>
              {group.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  role="menuitem"
                  className="flex h-auto w-full items-center gap-3 overflow-hidden rounded-lg px-3 py-2 text-left hover:bg-components-panel-on-panel-item-bg-hover"
                  onClick={() => {
                    addCondition(resourceType, resourceId, option.variableSelector)
                    setOpen(false)
                  }}
                >
                  <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">{option.itemLabel}</span>
                  <span className="ml-auto shrink-0 system-xs-medium text-text-tertiary">
                    {t(getConditionMetricValueTypeTranslationKey(option.valueType))}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default AddConditionSelect
