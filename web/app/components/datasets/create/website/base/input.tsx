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
      if (isNaN(numberValue)) {
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
      className='flex h-8 w-full p-2 rounded-lg system-xs-regular text-components-input-text-filled bg-components-input-bg-normal
      caret-[#295eff] border border-transparent
        hover:bg-components-input-bg-hover hover:border hover:border-components-input-border-hover
        focus-visible:outline-none focus:bg-components-inout-border-active focus:border focus:border-components-input-border-active
        focus:shadow-xs focus:shadow-shadow-shadow-3
        placeholder:text-components-input-text-placeholder'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
