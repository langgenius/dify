import type { FC } from 'react'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import Input, { type InputProps } from '../input'
import classNames from '@/utils/classnames'

export type InputNumberProps = {
  unit?: string
  value?: number
  onChange: (value?: number) => void
  amount?: number
  size?: 'sm' | 'md'
  max?: number
  min?: number
  defaultValue?: number
  disabled?: boolean
  wrapClassName?: string
  controlWrapClassName?: string
  controlClassName?: string
} & Omit<InputProps, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'defaultValue'>

export const InputNumber: FC<InputNumberProps> = (props) => {
  const { unit, className, onChange, amount = 1, value, size = 'md', max, min, defaultValue, wrapClassName, controlWrapClassName, controlClassName, disabled, ...rest } = props

  const isValidValue = (v: number) => {
    if (max && v > max)
      return false
    if (min && v < min)
      return false
    return true
  }

  const inc = () => {
    if (disabled) return

    if (value === undefined) {
      onChange(defaultValue)
      return
    }
    const newValue = value + amount
    if (!isValidValue(newValue))
      return
    onChange(newValue)
  }
  const dec = () => {
    if (disabled) return

    if (value === undefined) {
      onChange(defaultValue)
      return
    }
    const newValue = value - amount
    if (!isValidValue(newValue))
      return
    onChange(newValue)
  }

  return <div className={classNames('flex', wrapClassName)}>
    <Input {...rest}
      // disable default controller
      type='text'
      className={classNames('rounded-r-none', className)}
      value={value}
      max={max}
      min={min}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === '')
          onChange(undefined)

        const parsed = Number(e.target.value)
        if (Number.isNaN(parsed))
          return

        if (!isValidValue(parsed))
          return
        onChange(parsed)
      }}
      unit={unit}
    />
    <div className={classNames(
      'flex flex-col bg-components-input-bg-normal rounded-r-md border-l border-divider-subtle text-text-tertiary focus:shadow-xs',
      disabled && 'opacity-50 cursor-not-allowed',
      controlWrapClassName)}
    >
      <button onClick={inc} disabled={disabled} className={classNames(
        size === 'sm' ? 'pt-1' : 'pt-1.5',
        'px-1.5 hover:bg-components-input-bg-hover',
        disabled && 'cursor-not-allowed hover:bg-transparent',
        controlClassName,
      )}>
        <RiArrowUpSLine className='size-3' />
      </button>
      <button
        onClick={dec}
        disabled={disabled}
        className={classNames(
          size === 'sm' ? 'pb-1' : 'pb-1.5',
          'px-1.5 hover:bg-components-input-bg-hover',
          disabled && 'cursor-not-allowed hover:bg-transparent',
          controlClassName,
        )}>
        <RiArrowDownSLine className='size-3' />
      </button>
    </div>
  </div>
}
