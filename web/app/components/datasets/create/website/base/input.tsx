'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'

type Props = {
  value: string | number
  onChange: (value: string | number) => void
  placeholder?: string
  isNumber?: boolean
}

const MIN_VALUE = 0

const Input: FC<Props> = ({
  value,
  onChange,
  placeholder = '',
  isNumber = false,
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (isNumber) {
      let numberValue = Number.parseInt(value, 10) // integer only
      if (Number.isNaN(numberValue)) {
        onChange('')
        return
      }
      if (numberValue < MIN_VALUE)
        numberValue = MIN_VALUE

      onChange(numberValue)
      return
    }
    onChange(value)
  }, [isNumber, onChange])

  const otherOption = (() => {
    if (isNumber) {
      return {
        min: MIN_VALUE,
      }
    }
    return {

    }
  })()
  return (
    <input
      type={isNumber ? 'number' : 'text'}
      {...otherOption}
      value={value}
      onChange={handleChange}
      className='system-xs-regular focus:bg-components-inout-border-active flex h-8 w-full rounded-lg border border-transparent
      bg-components-input-bg-normal p-2 text-components-input-text-filled
        caret-[#295eff] placeholder:text-components-input-text-placeholder hover:border
        hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border focus:border-components-input-border-active
        focus:shadow-xs focus:shadow-shadow-shadow-3
        focus-visible:outline-none'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
