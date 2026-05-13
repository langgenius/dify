import type { ScheduleFrequency } from '../types'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

type FrequencyOption = {
  value: ScheduleFrequency
  name: string
}

type FrequencySelectorProps = {
  frequency: ScheduleFrequency
  onChange: (frequency: ScheduleFrequency) => void
}

const FrequencySelector = ({ frequency, onChange }: FrequencySelectorProps) => {
  const { t } = useTranslation()
  const groupLabel = t('nodes.triggerSchedule.frequency.label', { ns: 'workflow' })

  const frequencies = useMemo<FrequencyOption[]>(() => [
    { value: 'hourly', name: t('nodes.triggerSchedule.frequency.hourly', { ns: 'workflow' }) },
    { value: 'daily', name: t('nodes.triggerSchedule.frequency.daily', { ns: 'workflow' }) },
    { value: 'weekly', name: t('nodes.triggerSchedule.frequency.weekly', { ns: 'workflow' }) },
    { value: 'monthly', name: t('nodes.triggerSchedule.frequency.monthly', { ns: 'workflow' }) },
  ], [t])
  const selectedFrequency = frequencies.find(item => item.value === frequency)

  return (
    <Select
      key={`${frequency}-${groupLabel}`}
      value={frequency}
      onValueChange={value => value && onChange(value as ScheduleFrequency)}
    >
      <SelectTrigger className="w-full py-2">
        {selectedFrequency?.name ?? t('nodes.triggerSchedule.selectFrequency', { ns: 'workflow' })}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{groupLabel}</SelectLabel>
          {frequencies.map(item => (
            <SelectItem key={item.value} value={item.value}>
              <SelectItemText>{item.name}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export default FrequencySelector
