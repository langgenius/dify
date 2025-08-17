import React from 'react'
import { useTranslation } from 'react-i18next'

type WeekdaySelectorProps = {
  selectedDays: string[]
  onChange: (days: string[]) => void
}

const WeekdaySelector = ({ selectedDays, onChange }: WeekdaySelectorProps) => {
  const { t } = useTranslation()

  const weekdays = [
    { key: 'sun', label: 'Sun' },
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
  ]

  const selectedDay = selectedDays.length > 0 ? selectedDays[0] : 'sun'

  const handleDaySelect = (dayKey: string) => {
    onChange([dayKey])
  }

  return (
    <div className="space-y-2">
      <label className="mb-2 block text-xs font-medium text-gray-500">
        {t('workflow.nodes.triggerSchedule.weekdays')}
      </label>
      <div className="flex gap-1.5">
        {weekdays.map(day => (
          <button
            key={day.key}
            type="button"
            className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
              selectedDay === day.key
                ? 'border-2 border-util-colors-blue-brand-blue-brand-600 text-util-colors-blue-brand-blue-brand-600'
                : 'border-components-input-border-normal border text-text-tertiary hover:border-components-input-border-hover hover:text-text-secondary'
            }`}
            onClick={() => handleDaySelect(day.key)}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default WeekdaySelector
