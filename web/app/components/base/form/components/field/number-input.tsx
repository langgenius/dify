import React from 'react'
import { useFieldContext } from '../..'
import type { LabelProps } from '../label'
import Label from '../label'
import cn from '@/utils/classnames'
import type { InputNumberProps } from '../../../input-number'
import { InputNumber } from '../../../input-number'

type TextFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<InputNumberProps, 'id' | 'value' | 'onChange' | 'onBlur'>

const NumberInputField = ({
  label,
  labelOptions,
  className,
  ...inputProps
}: TextFieldProps) => {
  const field = useFieldContext<number>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <InputNumber
        id={field.name}
        value={field.state.value}
        onChange={value => field.handleChange(value)}
        onBlur={field.handleBlur}
        {...inputProps}
      />
    </div>
  )
}

export default NumberInputField
