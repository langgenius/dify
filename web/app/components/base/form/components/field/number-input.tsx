import React from 'react'
import { useFieldContext } from '../..'
import Label from '../label'
import cn from '@/utils/classnames'
import type { InputNumberProps } from '../../../input-number'
import { InputNumber } from '../../../input-number'

type TextFieldProps = {
  label: string
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
} & Omit<InputNumberProps, 'id' | 'value' | 'onChange' | 'onBlur'>

const NumberInputField = ({
  label,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
  ...inputProps
}: TextFieldProps) => {
  const field = useFieldContext<number | undefined>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        isRequired={isRequired}
        showOptional={showOptional}
        tooltip={tooltip}
        className={labelClassName}
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
