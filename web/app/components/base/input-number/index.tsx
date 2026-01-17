import type { FC } from 'react'
import type { InputProps } from '../input'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import { useCallback } from 'react'
import { cn } from '@/utils/classnames'
import Input from '../input'

export type InputNumberProps = {
  unit?: string
  value?: number
  onChange: (value: number) => void
  amount?: number
  size?: 'regular' | 'large'
  max?: number
  min?: number
  defaultValue?: number
  disabled?: boolean
  wrapClassName?: string
  controlWrapClassName?: string
  controlClassName?: string
} & Omit<InputProps, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'defaultValue'>

export const InputNumber: FC<InputNumberProps> = (props) => {
  const {
    unit,
    className,
    onChange,
    amount = 1,
    value,
    size = 'regular',
    max,
    min,
    defaultValue,
    wrapClassName,
    controlWrapClassName,
    controlClassName,
    disabled,
    ...rest
  } = props

  const isValidValue = useCallback((v: number) => {
    if (typeof max === 'number' && v > max)
      return false
    return !(typeof min === 'number' && v < min)
  }, [max, min])

  const inc = () => {
    if (disabled)
      return

    if (value === undefined) {
      onChange(defaultValue ?? 0)
      return
    }
    const newValue = value + amount
    if (!isValidValue(newValue))
      return
    onChange(newValue)
  }
  const dec = () => {
    if (disabled)
      return

    if (value === undefined) {
      onChange(defaultValue ?? 0)
      return
    }
    const newValue = value - amount
    if (!isValidValue(newValue))
      return
    onChange(newValue)
  }

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value === '') {
      onChange(0)
      return
    }
    const parsed = Number(e.target.value)
    if (Number.isNaN(parsed))
      return

    if (!isValidValue(parsed))
      return
    onChange(parsed)
  }, [isValidValue, onChange])

  return (
    <div className={cn('flex', wrapClassName)}>
      <Input
        {...rest}
        // disable default controller
        type="number"
        className={cn('no-spinner rounded-r-none', className)}
        value={value ?? 0}
        max={max}
        min={min}
        disabled={disabled}
        onChange={handleInputChange}
        unit={unit}
        size={size}
      />
      <div className={cn('flex flex-col rounded-r-md border-l border-divider-subtle bg-components-input-bg-normal text-text-tertiary focus:shadow-xs', disabled && 'cursor-not-allowed opacity-50', controlWrapClassName)}>
        <button
          type="button"
          onClick={inc}
          disabled={disabled}
          aria-label="increment"
          className={cn(size === 'regular' ? 'pt-1' : 'pt-1.5', 'px-1.5 hover:bg-components-input-bg-hover', disabled && 'cursor-not-allowed hover:bg-transparent', controlClassName)}
        >
          <RiArrowUpSLine className="size-3" />
        </button>
        <button
          type="button"
          onClick={dec}
          disabled={disabled}
          aria-label="decrement"
          className={cn(size === 'regular' ? 'pb-1' : 'pb-1.5', 'px-1.5 hover:bg-components-input-bg-hover', disabled && 'cursor-not-allowed hover:bg-transparent', controlClassName)}
        >
          <RiArrowDownSLine className="size-3" />
        </button>
      </div>
    </div>
  )
}
