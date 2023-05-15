'use client'
import React, { FC, } from 'react'

export interface IConfigStringProps {
  value: number | undefined
  onChange: (value: number | undefined) => void
}

const MAX_LENGTH = 64

const ConfigString: FC<IConfigStringProps> = ({
  value,
  onChange,
}) => {

  return (
    <div>
      <input
        type="number"
        max={MAX_LENGTH}
        min={1}
        value={value || ''}
        onChange={e => {
          let value = parseInt(e.target.value, 10)
          if (value > MAX_LENGTH) {
            value = MAX_LENGTH
          } else if (value < 1) {
            value = 1
          }
          onChange(value)
        }}
        className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
      />
    </div>
  )
}

export default React.memo(ConfigString)
