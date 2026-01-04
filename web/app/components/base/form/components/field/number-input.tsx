import type { InputNumberProps } from '../../../input-number'
import type { LabelProps } from '../label'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import { useFieldContext } from '../..'
import { InputNumber } from '../../../input-number'
import Label from '../label'

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
