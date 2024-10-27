'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'

export type IConfigStringProps = {
  value: number | undefined
  maxLength: number
  modelId: string
  onChange: (value: number | undefined) => void
}

const ConfigString: FC<IConfigStringProps> = ({
  value,
  onChange,
  maxLength,
}) => {
  useEffect(() => {
    if (value && value > maxLength)
      onChange(maxLength)
  }, [value, maxLength, onChange])

  return (
    <div>
      <input
        type="number"
        max={maxLength}
        min={1}
        value={value || ''}
        onChange={(e) => {
          let value = parseInt(e.target.value, 10)
          if (value > maxLength)
            value = maxLength

          else if (value < 1)
            value = 1

          onChange(value)
        }}
        className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
      />
    </div>
  )
}

export default React.memo(ConfigString)
