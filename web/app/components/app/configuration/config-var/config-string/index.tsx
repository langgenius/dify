'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { getMaxToken } from '@/config'

export type IConfigStringProps = {
  value: number | undefined
  modelId: string
  isParagraph: boolean
  onChange: (value: number | undefined) => void
}

const ConfigString: FC<IConfigStringProps> = ({
  value,
  modelId,
  isParagraph,
  onChange,
}) => {
  const MAX_LENGTH = isParagraph ? (getMaxToken(modelId) / 2) : 64
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
