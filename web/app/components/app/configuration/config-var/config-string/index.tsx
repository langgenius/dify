'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import Input from '@/app/components/base/input'

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
      <Input
        type="number"
        max={maxLength}
        min={1}
        value={value || ''}
        onChange={(e) => {
          let value = Number.parseInt(e.target.value, 10)
          if (value > maxLength)
            value = maxLength

          else if (value < 1)
            value = 1

          onChange(value)
        }}
      />
    </div>
  )
}

export default React.memo(ConfigString)
