import React from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'
import type { ScheduleFrequency } from '../types'

type FrequencySelectorProps = {
  frequency: ScheduleFrequency
  onChange: (frequency: ScheduleFrequency) => void
}

const FrequencySelector = ({ frequency, onChange }: FrequencySelectorProps) => {
  const { t } = useTranslation()

  const frequencies = [
    { value: 'hourly', name: t('workflow.nodes.triggerSchedule.frequency.hourly') },
    { value: 'daily', name: t('workflow.nodes.triggerSchedule.frequency.daily') },
    { value: 'weekly', name: t('workflow.nodes.triggerSchedule.frequency.weekly') },
    { value: 'monthly', name: t('workflow.nodes.triggerSchedule.frequency.monthly') },
    { value: 'once', name: t('workflow.nodes.triggerSchedule.frequency.once') },
  ]

  return (
    <SimpleSelect
      items={frequencies}
      defaultValue={frequency}
      onSelect={item => onChange(item.value as ScheduleFrequency)}
      placeholder={t('workflow.nodes.triggerSchedule.selectFrequency')}
      className="w-full"
      optionWrapClassName="min-w-40"
      notClearable={true}
    />
  )
}

export default FrequencySelector
