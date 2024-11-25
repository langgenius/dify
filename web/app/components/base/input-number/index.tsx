import { useState } from 'react'
import type { FC, SetStateAction } from 'react'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import Input, { type InputProps } from '../input'
import classNames from '@/utils/classnames'

export type InputNumberProps = {
  unit?: string
  onChange: (value: number) => void
  amount?: number
  size?: 'sm' | 'md'
} & Omit<InputProps, 'value' | 'onChange' | 'size'>

export const InputNumber: FC<InputNumberProps> = (props) => {
  const { unit, className, onChange, defaultValue = 0, amount = 1, size = 'sm', max, min, ...rest } = props
  const [val, setVal] = useState<number>(defaultValue as number)
  const update = (value: SetStateAction<number>) => {
    const current = typeof value === 'function' ? value(val) : value as number
    if (max && current >= (max as number))
      return
    if (min && current <= (min as number))
      return
    setVal(value)
  }
  const inc = () => update(val => val + amount)
  const dec = () => update(val => val - amount)
  return <div className='flex'>
    <Input {...rest}
      className={classNames('rounded-r-none', className)}
      value={val}
      max={max}
      min={min}
      onChange={(e) => {
        const parsed = Number(e.target.value)
        if (Number.isNaN(parsed))
          return
        setVal(parsed)
        onChange(parsed)
      }}
    />
    {unit && <div className='flex items-center bg-components-input-bg-normal text-[13px] text-text-placeholder pr-2'>{unit}</div>}
    <div className='flex flex-col bg-components-input-bg-normal rounded-r-md border-l text-text-tertiary'>
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
