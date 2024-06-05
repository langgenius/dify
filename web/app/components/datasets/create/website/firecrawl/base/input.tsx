'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'

type Props = {
  value: string | number
  onChange: (value: string | number) => void
  placeholder?: string
  isNumber?: boolean
}

const Input: FC<Props> = ({
  value,
  onChange,
  placeholder = '',
  isNumber = false,
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    if (isNumber) {
      onChange(parseFloat(value))
      return
    }
    onChange(value)
  }, [isNumber, onChange])
  return (
    <input
      type={isNumber ? 'number' : 'text'}
      value={value}
      onChange={handleChange}
      className='flex h-9 w-full py-1 px-2 rounded-lg text-xs leading-normal bg-gray-100 caret-primary-600 hover:bg-gray-100 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none focus:bg-gray-50 placeholder:text-gray-400'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
