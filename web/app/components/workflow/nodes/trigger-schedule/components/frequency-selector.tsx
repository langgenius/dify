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

  const frequencies: FrequencyOption[] = [
    { value: 'hourly', name: t('nodes.triggerSchedule.frequency.hourly', { ns: 'workflow' }) },
    { value: 'daily', name: t('nodes.triggerSchedule.frequency.daily', { ns: 'workflow' }) },
    { value: 'weekly', name: t('nodes.triggerSchedule.frequency.weekly', { ns: 'workflow' }) },
    { value: 'monthly', name: t('nodes.triggerSchedule.frequency.monthly', { ns: 'workflow' }) },
  ]
  const selectedFrequency = frequencies.find(item => item.value === frequency)

  const handleFrequencyChange = (value: string | null) => {
    const selected = frequencies.find(item => item.value === value)
    if (selected)
      onChange(selected.value)
  }

  return (
    <Select
      key={`${frequency}-${groupLabel}`}
      value={frequency}
      onValueChange={handleFrequencyChange}
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
