import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { cn } from '@/utils/classnames'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  timeout: number
  unit: 'day' | 'hour'
  onChange: (state: { timeout: number, unit: 'day' | 'hour' }) => void
  readonly?: boolean
}

const TimeoutInput: FC<Props> = ({
  timeout,
  unit,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (/^\d*$/.test(value))
      onChange({ timeout: Number(value) || 1, unit })
    else
      onChange({ timeout: 1, unit })
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        wrapperClassName="w-16"
        type="number"
        value={timeout}
        min={1}
        onChange={handleValueChange}
        disabled={readonly}
      />
      <div className="flex items-center gap-0.5 rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
        <div
          className={cn(
            'rounded-lg px-2 py-1 text-text-tertiary',
            !readonly && 'cursor-pointer hover:bg-state-base-hover hover:text-text-secondary',
            unit === 'day' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm',
            !readonly && unit === 'day' && 'hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
          )}
          onClick={() => !readonly && onChange({ timeout, unit: 'day' })}
        >
          <div className="system-sm-medium p-0.5">{t(`${i18nPrefix}.timeout.days`, { ns: 'workflow' })}</div>
        </div>
        <div
          className={cn(
            'rounded-lg px-2 py-1 text-text-tertiary',
            !readonly && 'cursor-pointer hover:bg-state-base-hover hover:text-text-secondary',
            unit === 'hour' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm',
            !readonly && unit === 'hour' && 'hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
          )}
          onClick={() => !readonly && onChange({ timeout, unit: 'hour' })}
        >
          <div className="system-sm-medium p-0.5">{t(`${i18nPrefix}.timeout.hours`, { ns: 'workflow' })}</div>
        </div>
      </div>
    </div>
  )
}

export default TimeoutInput
