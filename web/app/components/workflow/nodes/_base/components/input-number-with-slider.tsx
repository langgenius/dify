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
    if (value === undefined || value === null) {
      onChange(defaultValue)
      return
    }
    if (max !== undefined && value > max) {
      onChange(max)
      return
    }
    if (min !== undefined && value < min)
      onChange(min)
  }, [defaultValue, max, min, onChange, value])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number.parseFloat(e.target.value))
  }, [onChange])

  return (
    <div className='flex h-8 items-center justify-between space-x-2'>
      <input
        value={value}
        className='bg-components-input-bg-normal text-components-input-text-filled block h-8 w-12 shrink-0 appearance-none rounded-lg pl-3 text-[13px] outline-none'
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
