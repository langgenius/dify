import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'

type MonthlyDaysSelectorProps = {
  selectedDays: (number | 'last')[]
  onChange: (days: (number | 'last')[]) => void
}

const MonthlyDaysSelector = ({ selectedDays, onChange }: MonthlyDaysSelectorProps) => {
  const { t } = useTranslation()

  const handleDayClick = (day: number | 'last') => {
    const current = selectedDays || []
    const newSelected = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day]
    // Ensure at least one day is selected (consistent with WeekdaySelector)
    onChange(newSelected.length > 0 ? newSelected : [day])
  }

  const isDaySelected = (day: number | 'last') => selectedDays?.includes(day) || false

  const days = Array.from({ length: 31 }, (_, i) => i + 1)
  const rows = [
    days.slice(0, 7),
    days.slice(7, 14),
    days.slice(14, 21),
    days.slice(21, 28),
    [29, 30, 31, 'last' as const],
  ]

  return (
    <div className="space-y-2">
      <label className="mb-2 block text-xs font-medium text-text-tertiary">
        {t('nodes.triggerSchedule.days', { ns: 'workflow' })}
      </label>

      <div className="space-y-1.5">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-7 gap-1.5">
            {row.map(day => (
              day === 'last'
                ? (
                    <div
                      key={day}
                      className={`col-span-2 flex min-w-0 items-center rounded-lg border bg-components-option-card-option-bg text-xs transition-colors ${
                        isDaySelected(day)
                          ? 'border-util-colors-blue-brand-blue-brand-600 text-text-secondary'
                          : 'border-divider-subtle text-text-tertiary hover:border-divider-regular hover:text-text-secondary'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDayClick(day)}
                        className="min-w-0 flex-1 py-1"
                      >
                        {t('nodes.triggerSchedule.lastDay', { ns: 'workflow' })}
                      </button>
                      <Infotip
                        aria-label={t('nodes.triggerSchedule.lastDayTooltip', { ns: 'workflow' })}
                        className="mr-1 h-3 w-3"
                        iconClassName="h-3 w-3"
                      >
                        {t('nodes.triggerSchedule.lastDayTooltip', { ns: 'workflow' })}
                      </Infotip>
                    </div>
                  )
                : (
                    <button
                      key={day}
                      type="button"
                      onClick={() => handleDayClick(day)}
                      className={`rounded-lg border bg-components-option-card-option-bg py-1 text-xs transition-colors ${
                        isDaySelected(day)
                          ? 'border-util-colors-blue-brand-blue-brand-600 text-text-secondary'
                          : 'border-divider-subtle text-text-tertiary hover:border-divider-regular hover:text-text-secondary'
                      }`}
                    >
                      {day}
                    </button>
                  )
            ))}
            {/* Fill empty cells in the last row (Last day takes 2 cols, so need 1 less) */}
            {rowIndex === rows.length - 1 && Array.from({ length: 7 - row.length - 1 }, (_, i) => (
              <div key={`empty-${i}`} className="invisible"></div>
            ))}
          </div>
        ))}
      </div>

      {/* Warning message for day 31 - aligned with grid */}
      {selectedDays?.includes(31) && (
        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
          <div className="col-span-7 text-xs text-gray-500">
            {t('nodes.triggerSchedule.lastDayTooltip', { ns: 'workflow' })}
          </div>
        </div>
      )}
    </div>
  )
}

export default MonthlyDaysSelector
