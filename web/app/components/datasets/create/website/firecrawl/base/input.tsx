'use client'
import type { FC } from 'react'
import React from 'react'

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

const Input: FC<Props> = ({
  value,
  onChange,
  placeholder = '',
}) => {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      className='flex h-9 w-full py-1 px-2 rounded-lg text-xs leading-normal bg-gray-100 caret-primary-600 hover:bg-gray-100 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none focus:bg-gray-50 placeholder:text-gray-400'
      placeholder={placeholder}
    />
  )
}
export default React.memo(Input)
