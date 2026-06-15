import type { TextareaProps } from '@langgenius/dify-ui/textarea'
import type { LabelProps } from '../label'
import { cn } from '@langgenius/dify-ui/cn'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useFieldContext } from '../..'
import Label from '../label'

type TextAreaFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<TextareaProps, 'className' | 'defaultValue' | 'onBlur' | 'onValueChange' | 'value' | 'id'>

const TextAreaField = ({ label, labelOptions, className, ...inputProps }: TextAreaFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label htmlFor={field.name} label={label} {...(labelOptions ?? {})} />
      <Textarea
        {...inputProps}
        id={field.name}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
        onBlur={field.handleBlur}
      />
    </div>
  )
}

export default TextAreaField
