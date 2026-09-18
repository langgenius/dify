import type { InputProps } from '@langgenius/dify-ui/input'
import type { LabelProps } from '../label'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useFieldContext } from '../..'
import Label from '../label'

type TextFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<
  InputProps,
  'className' | 'onChange' | 'onValueChange' | 'onBlur' | 'value' | 'defaultValue' | 'id' | 'name'
>

const TextField = ({ label, labelOptions, className, ...inputProps }: TextFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label htmlFor={field.name} label={label} {...(labelOptions ?? {})} />
      <Input
        id={field.name}
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
        onBlur={field.handleBlur}
        {...inputProps}
      />
    </div>
  )
}

export default TextField
