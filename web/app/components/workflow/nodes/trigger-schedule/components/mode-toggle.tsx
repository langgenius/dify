import React from 'react'
import { useTranslation } from 'react-i18next'
import { Asterisk, CalendarCheckLine } from '@/app/components/base/icons/src/vender/workflow'
import type { ScheduleMode } from '../types'

type ModeToggleProps = {
  mode: ScheduleMode
  onChange: (mode: ScheduleMode) => void
}

const ModeToggle = ({ mode, onChange }: ModeToggleProps) => {
  const { t } = useTranslation()

  const handleToggle = () => {
    const newMode = mode === 'visual' ? 'cron' : 'visual'
    onChange(newMode)
  }

  const currentText = mode === 'visual'
    ? t('workflow.nodes.triggerSchedule.useCronExpression')
    : t('workflow.nodes.triggerSchedule.useVisualPicker')

  const currentIcon = mode === 'visual' ? Asterisk : CalendarCheckLine

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-text-secondary hover:bg-state-base-hover"
    >
      {React.createElement(currentIcon, { className: 'w-4 h-4' })}
      <span>{currentText}</span>
    </button>
  )
}

export default ModeToggle
