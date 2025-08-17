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
    <div className="space-y-3">
      <div className="text-sm font-medium text-text-secondary">
        {t('workflow.nodes.triggerSchedule.days')}
      </div>

      <div className="space-y-2">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-2">
            {row.map(day => (
              <div key={day} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onChange(day)}
                  className={`h-8 min-w-[32px] rounded-lg border px-2 text-sm font-medium transition-all ${
                    selectedDay === day
                      ? 'border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text'
                      : 'border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text hover:bg-components-button-secondary-bg-hover'
                  }`}
                >
                  {day === 'last' ? t('workflow.nodes.triggerSchedule.lastDay') : day}
                </button>

                {day === 'last' && (
                  <Tooltip
                    popupContent={t('workflow.nodes.triggerSchedule.lastDayTooltip')}
                    triggerClassName="ml-1"
                  >
                    <RiQuestionLine className="h-3 w-3 text-text-quaternary" />
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MonthlyDaysSelector
