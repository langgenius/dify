import type { ScheduleMode } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

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

  const currentText =
    mode === 'visual'
      ? t(($) => $['nodes.triggerSchedule.useCronExpression'], { ns: 'workflow' })
      : t(($) => $['nodes.triggerSchedule.useVisualPicker'], { ns: 'workflow' })

  const iconClassName =
    mode === 'visual'
      ? 'i-custom-vender-workflow-asterisk'
      : 'i-custom-vender-workflow-calendar-check-line'

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-sm text-text-secondary hover:bg-state-base-hover"
    >
      <span aria-hidden className={cn(iconClassName, 'size-4')} />
      <span>{currentText}</span>
    </button>
  )
}

export default ModeToggle
