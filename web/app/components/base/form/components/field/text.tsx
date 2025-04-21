import React from 'react'
import { useFieldContext } from '../..'
import Input, { type InputProps } from '../../../input'
import Label from '../label'
import cn from '@/utils/classnames'

type TextFieldProps = {
  label: string
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
  className?: string
  labelClassName?: string
} & Omit<InputProps, 'className' | 'onChange' | 'onBlur' | 'value' | 'id'>

const TextField = ({
  label,
  isRequired,
  showOptional,
  tooltip,
  className,
  labelClassName,
  ...inputProps
}: TextFieldProps) => {
  const field = useFieldContext<string>()

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
      <Input
        id={field.name}
        value={field.state.value}
        onChange={e => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        {...inputProps}
      />
    </div>
  )
}

export default TextField
