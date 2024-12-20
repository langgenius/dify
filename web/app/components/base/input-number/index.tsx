import type { FC } from 'react'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import Input, { type InputProps } from '../input'
import classNames from '@/utils/classnames'

export type InputNumberProps = {
  unit?: string
  value?: number
  onChange: (value: number) => void
  amount?: number
  size?: 'sm' | 'md'
  max?: number
  min?: number
  defaultValue?: number
} & Omit<InputProps, 'value' | 'onChange' | 'size' | 'min' | 'max' | 'defaultValue'>

export const InputNumber: FC<InputNumberProps> = (props) => {
  const { unit, className, onChange, amount = 1, value, size = 'md', max, min, defaultValue = 0, ...rest } = props

  const onSubmit = (value?: number) => {
    onChange(value || defaultValue as number)
  }

  const isValidValue = (v: number) => {
    if (max && v > max)
      return false
    if (min && v < min)
      return false
    return true
  }

  const inc = () => {
    if (value === undefined) {
      onSubmit(defaultValue)
      return
    }
    const newValue = value + amount
    if (!isValidValue(newValue))
      return
    onSubmit(newValue)
  }
  const dec = () => {
    if (value === undefined) {
      onSubmit(defaultValue)
      return
    }
    const newValue = value - amount
    if (!isValidValue(newValue))
      return
    onSubmit(newValue)
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
          onSubmit(undefined)

        const parsed = Number(e.target.value)
        if (Number.isNaN(parsed))
          return

        if (!isValidValue(parsed))
          return
        onChange(parsed)
      }}
    />
    {unit && <div className='flex items-center bg-components-input-bg-normal text-[13px] text-text-placeholder pr-2'>{unit}</div>}
    <div className='flex flex-col bg-components-input-bg-normal rounded-r-md border-l border-divider-subtle text-text-tertiary focus:shadow-xs'>
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
