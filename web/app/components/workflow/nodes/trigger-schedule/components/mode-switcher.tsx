import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCalendarLine, RiCodeLine } from '@remixicon/react'
import { SegmentedControl } from '@/app/components/base/segmented-control'
import type { ScheduleMode } from '../types'

type ModeSwitcherProps = {
  mode: ScheduleMode
  onChange: (mode: ScheduleMode) => void
}

const ModeSwitcher = ({ mode, onChange }: ModeSwitcherProps) => {
  const { t } = useTranslation()

  const options = [
    {
      Icon: RiCalendarLine,
      text: t('workflow.nodes.triggerSchedule.mode.visual'),
      value: 'visual' as const,
    },
    {
      Icon: RiCodeLine,
      text: t('workflow.nodes.triggerSchedule.mode.cron'),
      value: 'cron' as const,
    },
  ]

  return (
    <SegmentedControl
      options={options}
      value={mode}
      onChange={onChange}
    />
  )
}

export default ModeSwitcher
