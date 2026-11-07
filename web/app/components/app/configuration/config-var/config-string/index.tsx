'use client'
import type { FC } from 'react'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import * as React from 'react'
import { useEffect } from 'react'

type IConfigStringProps = {
  id?: string
  value: number | undefined
  maxLength: number
  modelId: string
  onChange: (value: number | undefined) => void
}

const ConfigString: FC<IConfigStringProps> = ({ id, value, onChange, maxLength }) => {
  useEffect(() => {
    if (value && value > maxLength) onChange(maxLength)
  }, [value, maxLength, onChange])

  return (
    <NumberField
      id={id}
      min={1}
      max={maxLength}
      step={1}
      format={{ maximumFractionDigits: 0, useGrouping: false }}
      value={value ?? null}
      onValueChange={(value) => onChange(value ?? undefined)}
    >
      <NumberFieldGroup>
        <NumberFieldInput />
      </NumberFieldGroup>
    </NumberField>
  )
}

export default React.memo(ConfigString)
