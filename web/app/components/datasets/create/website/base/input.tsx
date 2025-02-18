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
      className='caret-primary-600 flex h-9 w-full rounded-lg bg-gray-100 px-2 py-1 text-xs leading-normal placeholder:text-gray-400 hover:bg-gray-100 focus:bg-gray-50 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
