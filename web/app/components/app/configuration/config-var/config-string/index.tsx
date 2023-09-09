'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'

export type IConfigStringProps = {
  value: number | undefined
  modelId: string
  onChange: (value: number | undefined) => void
}

const MAX_LENGTH = 256

const ConfigString: FC<IConfigStringProps> = ({
  value,
  onChange,
}) => {
  useEffect(() => {
    if (value && value > MAX_LENGTH)
      onChange(MAX_LENGTH)
  }, [value, MAX_LENGTH])

  return (
    <div>
      <input
        type="number"
        max={MAX_LENGTH}
        min={1}
        value={value || ''}
        onChange={(e) => {
          let value = parseInt(e.target.value, 10)
          if (value > MAX_LENGTH)
            value = MAX_LENGTH

          else if (value < 1)
            value = 1

          onChange(value)
        }}
        className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
      />
    </div>
  )
}

export default React.memo(ConfigString)
