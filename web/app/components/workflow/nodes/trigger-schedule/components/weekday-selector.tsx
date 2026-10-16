import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Toggle } from '@langgenius/dify-ui/toggle'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type WeekdaySelectorProps = {
  selectedDays: string[]
  onChange: (days: string[]) => void
}

const WeekdaySelector = ({ selectedDays, onChange }: WeekdaySelectorProps) => {
  const { t } = useTranslation(['workflow'])

  const weekdays = [
    { key: 'sun', label: 'Sun' },
    { key: 'mon', label: 'Mon' },
    { key: 'tue', label: 'Tue' },
    { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' },
    { key: 'fri', label: 'Fri' },
    { key: 'sat', label: 'Sat' },
  ]

  const handleDaySelect = (dayKey: string) => {
    const current = selectedDays || []
    const newSelected = current.includes(dayKey)
      ? current.filter((d) => d !== dayKey)
      : [...current, dayKey]
    onChange(newSelected.length > 0 ? newSelected : [dayKey])
  }

  const isDaySelected = (dayKey: string) => selectedDays.includes(dayKey)

  return (
    <Fieldset className="space-y-2">
      <FieldsetLegend className="mb-2 py-0 text-xs font-medium text-text-tertiary">
        {t(($) => $['nodes.triggerSchedule.weekdays'], { ns: 'workflow' })}
      </FieldsetLegend>
      <div className="flex gap-1.5">
        {weekdays.map((day) => (
          <Toggle
            key={day.key}
            pressed={isDaySelected(day.key)}
            onPressedChange={() => handleDaySelect(day.key)}
            className="flex-1 rounded-lg border border-divider-subtle bg-components-option-card-option-bg py-1 text-xs text-text-tertiary outline-state-accent-solid transition-colors hover:border-divider-regular hover:text-text-secondary focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid data-pressed:border-util-colors-blue-brand-blue-brand-600 data-pressed:text-text-secondary data-pressed:hover:border-util-colors-blue-brand-blue-brand-600"
          >
            {day.label}
          </Toggle>
        ))}
      </div>
    </Fieldset>
  )
}

export default WeekdaySelector
