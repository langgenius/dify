'use client'
import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type Props = {
  isChecked: boolean
  disabled?: boolean
  onCheck?: (event: React.MouseEvent<HTMLDivElement>) => void
  className?: string
}

const RadioUI: FC<Props> = ({
  isChecked,
  disabled = false,
  onCheck,
  className,
}) => {
  return (
    <div
      role="radio"
      aria-checked={isChecked}
      aria-disabled={disabled}
      className={cn(
        'size-4 rounded-full',
        isChecked && !disabled && 'border-[5px] border-components-radio-border-checked hover:border-components-radio-border-checked-hover',
        !isChecked && !disabled && 'border border-components-radio-border hover:border-components-radio-border-hover',
        isChecked && disabled && 'border-[5px] border-components-radio-border-checked-disabled',
        !isChecked && disabled && 'border border-components-radio-border-disabled bg-components-radio-bg-disabled',
        !disabled && 'bg-components-radio-bg shadow-xs shadow-shadow-shadow-3 hover:bg-components-radio-bg-hover',
        className,
      )}
      onClick={(event) => {
        if (disabled)
          return
        onCheck?.(event)
      }}
    />
  )
}
export default React.memo(RadioUI)
