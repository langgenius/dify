import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'
import type { ScheduleFrequency } from '../types'

type FrequencySelectorProps = {
  frequency: ScheduleFrequency
  onChange: (frequency: ScheduleFrequency) => void
}

const FrequencySelector = ({ frequency, onChange }: FrequencySelectorProps) => {
  const { t } = useTranslation()

  const frequencies = useMemo(() => [
    { value: 'frequency-header', name: t('workflow.nodes.triggerSchedule.frequency.label'), isGroup: true },
    { value: 'hourly', name: t('workflow.nodes.triggerSchedule.frequency.hourly') },
    { value: 'daily', name: t('workflow.nodes.triggerSchedule.frequency.daily') },
    { value: 'weekly', name: t('workflow.nodes.triggerSchedule.frequency.weekly') },
    { value: 'monthly', name: t('workflow.nodes.triggerSchedule.frequency.monthly') },
  ], [t])

  return (
    <SimpleSelect
      key={`${frequency}-${frequencies[0]?.name}`} // Include translation in key to force re-render
      items={frequencies}
      defaultValue={frequency}
      onSelect={item => onChange(item.value as ScheduleFrequency)}
      placeholder={t('workflow.nodes.triggerSchedule.selectFrequency')}
      className="w-full py-2"
      wrapperClassName="h-auto"
      optionWrapClassName="min-w-40"
      notClearable={true}
      allowSearch={false}
    />
  )
}

export default FrequencySelector
