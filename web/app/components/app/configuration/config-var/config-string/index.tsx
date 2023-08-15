'use client'
import type { FC } from 'react'
import React from 'react'

export type IConfigStringProps = {
  value: number | undefined
  onChange: (value: number | undefined) => void
}

const MAX_LENGTH = 256

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
        onChange={(e) => {
          const value = Math.max(1, Math.min(MAX_LENGTH, parseInt(e.target.value))) || 1
          onChange(value)
        }}
        className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
      />
    </div>
  )
}

export default React.memo(ConfigString)
