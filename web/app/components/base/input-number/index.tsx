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
} & Omit<InputProps, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'defaultValue'>

export const InputNumber: FC<InputNumberProps> = (props) => {
  const { unit, className, onChange, amount = 1, value, size = 'md', max, min, defaultValue, ...rest } = props

  const isValidValue = (v: number) => {
    if (max && v > max)
      return false
    if (min && v < min)
      return false
    return true
  }

  const inc = () => {
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
    if (value === undefined) {
      onChange(defaultValue)
      return
    }
    const newValue = value - amount
    if (!isValidValue(newValue))
      return
    onChange(newValue)
  }

  return <div className='flex'>
    <Input {...rest}
      // disable default controller
      type='text'
      className={classNames('rounded-r-none', className)}
      value={value}
      max={max}
      min={min}
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
    <div className='bg-components-input-bg-normal border-divider-subtle text-text-tertiary focus:shadow-xs flex flex-col rounded-r-md border-l'>
      <button onClick={inc} className={classNames(
        size === 'sm' ? 'pt-1' : 'pt-1.5',
        'px-1.5 hover:bg-components-input-bg-hover',
      )}>
        <RiArrowUpSLine className='size-3' />
      </button>
      <button onClick={dec} className={classNames(
        size === 'sm' ? 'pb-1' : 'pb-1.5',
        'px-1.5 hover:bg-components-input-bg-hover',
      )}>
        <RiArrowDownSLine className='size-3' />
      </button>
    </div>
  </div>
}
