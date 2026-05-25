'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import * as React from 'react'
import Datepicker from '../base/date-picker'
import { DataType } from '../types'

type Props = {
  className?: string
  label: string
  type: DataType
  value: any
  onChange: (value: any) => void
  readOnly?: boolean
}

const InputCombined: FC<Props> = ({
  className: configClassName,
  label,
  type,
  value,
  onChange,
  readOnly,
}) => {
  const className = cn('h-6 grow p-0.5 text-xs')
  if (type === DataType.time) {
    return (
      <Datepicker
        label={label}
        className={className}
        value={value}
        onChange={onChange}
      />
    )
  }

  if (type === DataType.number) {
    return (
      <div className="grow text-[0]">
        <NumberField
          className="min-w-0"
          value={value}
          readOnly={readOnly}
          onValueChange={value => onChange(value ?? 0)}
        >
          <NumberFieldGroup>
            <NumberFieldInput
              aria-label={label}
              className={cn(className, 'rounded-l-md')}
            />
            <NumberFieldControls className="overflow-hidden">
              <NumberFieldIncrement className="py-0" />
              <NumberFieldDecrement className="py-0" />
            </NumberFieldControls>
          </NumberFieldGroup>
        </NumberField>
      </div>
    )
  }
  return (
    <Input
      aria-label={label}
      className={cn(configClassName, className, 'rounded-md')}
      value={value}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
    />
  )
}
export default React.memo(InputCombined)
