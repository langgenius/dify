'use client'
import type { ChangeEventHandler, CSSProperties } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

export type InputNumberProps = {
  value?: number
  defaultValue?: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number | null) => void
  readOnly?: boolean
  disabled?: boolean
  className?: string
  style?: CSSProperties
  size?: 'regular' | 'large'
}

const InputNumber = React.forwardRef<HTMLInputElement, InputNumberProps>(({
  value,
  defaultValue,
  min,
  max,
  step = 1,
  onChange,
  readOnly,
  disabled,
  className,
  style,
  size = 'regular',
}, ref) => {
  const handleChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const val = e.target.value
    if (val === '') {
      onChange?.(null)
      return
    }
    const num = Number.parseFloat(val)
    if (!Number.isNaN(num))
      onChange?.(num)
  }

  return (
    <input
      ref={ref}
      type="number"
      value={value ?? ''}
      defaultValue={defaultValue}
      min={min}
      max={max}
      step={step}
      onChange={handleChange}
      readOnly={readOnly}
      disabled={disabled}
      style={style}
      className={cn(
        'w-full appearance-none bg-transparent text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder',
        size === 'regular' && 'text-[13px]',
        size === 'large' && 'text-[14px]',
        className,
      )}
    />
  )
})

InputNumber.displayName = 'InputNumber'

export default InputNumber
