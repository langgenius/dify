'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import Slider from '@/app/components/base/slider'

type Props = {
  value: number
  defaultValue?: number
  min?: number
  max?: number
  readonly?: boolean
  onChange: (value: number) => void
}

const InputNumberWithSlider: FC<Props> = ({
  value,
  defaultValue = 0,
  min,
  max,
  readonly,
  onChange,
}) => {
  const handleBlur = useCallback(() => {
    if (value === undefined || value === null)
      onChange(defaultValue)
  }, [defaultValue, onChange, value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value))
  }, [onChange])

  return (
    <div className='flex justify-between items-center h-8 space-x-2'>
      <input
        value={value}
        className='shrink-0 block pl-3 w-12 h-8 appearance-none outline-none rounded-lg bg-gray-100 text-[13px] text-gra-900'
        type='number'
        min={min}
        max={max}
        step={1}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={readonly}
      />
      <Slider
        className='grow'
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={onChange}
        disabled={readonly}
      />
    </div>
  )
}
export default React.memo(InputNumberWithSlider)
