import type { ScheduleFrequency } from '../types'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SimpleSelect } from '@/app/components/base/select'

type FrequencySelectorProps = {
  frequency: ScheduleFrequency
  onChange: (frequency: ScheduleFrequency) => void
}

const FrequencySelector = ({ frequency, onChange }: FrequencySelectorProps) => {
  const { t } = useTranslation()

  const frequencies = useMemo(() => [
    { value: 'frequency-header', name: t('nodes.triggerSchedule.frequency.label', { ns: 'workflow' }), isGroup: true },
    { value: 'hourly', name: t('nodes.triggerSchedule.frequency.hourly', { ns: 'workflow' }) },
    { value: 'daily', name: t('nodes.triggerSchedule.frequency.daily', { ns: 'workflow' }) },
    { value: 'weekly', name: t('nodes.triggerSchedule.frequency.weekly', { ns: 'workflow' }) },
    { value: 'monthly', name: t('nodes.triggerSchedule.frequency.monthly', { ns: 'workflow' }) },
  ], [t])

  return (
    <SimpleSelect
      key={`${frequency}-${frequencies[0]?.name}`} // Include translation in key to force re-render
      items={frequencies}
      defaultValue={frequency}
      onSelect={item => onChange(item.value as ScheduleFrequency)}
      placeholder={t('nodes.triggerSchedule.selectFrequency', { ns: 'workflow' })}
      className="w-full py-2"
      wrapperClassName="h-auto"
      optionWrapClassName="min-w-40"
      notClearable={true}
      allowSearch={false}
    />
  )
}

export default FrequencySelector
