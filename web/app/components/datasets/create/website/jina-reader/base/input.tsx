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
      let numberValue = parseInt(value, 10) // integer only
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
      className='flex h-9 w-full py-1 px-2 rounded-lg text-xs leading-normal bg-gray-100 caret-primary-600 hover:bg-gray-100 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none focus:bg-gray-50 placeholder:text-gray-400'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
