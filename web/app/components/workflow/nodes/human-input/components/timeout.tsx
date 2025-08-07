import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import cn from '@/utils/classnames'

const i18nPrefix = 'workflow.nodes.humanInput'

type Props = {
  timeout: number
  unit: 'day' | 'hour'
  onChange: (state: { timeout: number; unit: 'day' | 'hour' }) => void
}

const TimeoutInput: FC<Props> = ({
  timeout,
  unit,
  onChange,
}) => {
  const { t } = useTranslation()
  return (
    <div className='flex items-center gap-1'>
      <Input
        wrapperClassName='w-16'
        type='number'
        value={timeout}
        min={1}
        onChange={e => onChange({ timeout: Number(e.target.value), unit })}
      />
      <div className='flex items-center gap-0.5 rounded-[10px] bg-components-segmented-control-bg-normal p-0.5'>
        <div
          className={cn(
            'cursor-pointer rounded-lg px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            unit === 'day' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
          )}
          onClick={() => onChange({ timeout, unit: 'day' })}
        >
          <div className='system-sm-medium p-0.5'>{t(`${i18nPrefix}.timeout.days`)}</div>
        </div>
        <div
          className={cn(
            'cursor-pointer rounded-lg px-2 py-1 text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            unit === 'hour' && 'bg-components-segmented-control-item-active-bg text-text-accent-light-mode-only shadow-sm hover:bg-components-segmented-control-item-active-bg hover:text-text-accent-light-mode-only',
          )}
          onClick={() => onChange({ timeout, unit: 'hour' })}
        >
          <div className='system-sm-medium p-0.5'>{t(`${i18nPrefix}.timeout.hours`)}</div>
        </div>
      </div>
    </div>
  )
}

export default TimeoutInput
