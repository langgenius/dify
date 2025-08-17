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

  const handleDayToggle = (dayKey: string) => {
    const newDays = selectedDays.includes(dayKey)
      ? selectedDays.filter(d => d !== dayKey)
      : [...selectedDays, dayKey]
    onChange(newDays)
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-gray-700">
        {t('workflow.nodes.triggerSchedule.weekdays')}
      </label>
      <div className="flex gap-1">
        {weekdays.map(day => (
          <button
            key={day.key}
            type="button"
            className={`rounded border px-3 py-1 text-xs ${
              selectedDays.includes(day.key)
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
            onClick={() => handleDayToggle(day.key)}
          >
            {day.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default WeekdaySelector
