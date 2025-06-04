import React from 'react'
import { useFieldContext } from '../..'
import Input, { type InputProps } from '../../../input'
import type { LabelProps } from '../label'
import Label from '../label'
import cn from '@/utils/classnames'

type TextFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<InputProps, 'className' | 'onChange' | 'onBlur' | 'value' | 'id'>

const TextField = ({
  label,
  labelOptions,
  className,
  ...inputProps
}: TextFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
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
