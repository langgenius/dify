import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiQuestionLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'

type MonthlyDaysSelectorProps = {
  selectedDay: number | 'last'
  onChange: (day: number | 'last') => void
}

const MonthlyDaysSelector = ({ selectedDay, onChange }: MonthlyDaysSelectorProps) => {
  const { t } = useTranslation()

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
      <label className="mb-2 block text-xs font-medium text-gray-500">
        {t('workflow.nodes.triggerSchedule.days')}
      </label>

      <div className="space-y-1.5">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="grid grid-cols-7 gap-1.5">
            {row.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => onChange(day)}
                className={`rounded-lg py-1.5 text-xs transition-colors ${
                  day === 'last' ? 'col-span-2 min-w-0' : ''
                } ${
                  selectedDay === day
                    ? 'border-2 border-util-colors-blue-brand-blue-brand-600 text-text-secondary'
                    : 'border-components-input-border-normal border text-text-tertiary hover:border-components-input-border-hover hover:text-text-secondary'
                }`}
              >
                {day === 'last' ? (
                  <div className="flex items-center justify-center gap-1">
                    <span>{t('workflow.nodes.triggerSchedule.lastDay')}</span>
                    <Tooltip
                      popupContent={t('workflow.nodes.triggerSchedule.lastDayTooltip')}
                    >
                      <RiQuestionLine className="h-3 w-3 text-text-quaternary" />
                    </Tooltip>
                  </div>
                ) : (
                  day
                )}
              </button>
            ))}
            {/* Fill empty cells in the last row (Last day takes 2 cols, so need 1 less) */}
            {rowIndex === rows.length - 1 && Array.from({ length: 7 - row.length - 1 }, (_, i) => (
              <div key={`empty-${i}`} className="invisible"></div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MonthlyDaysSelector
