import type { TextareaProps } from '../../../textarea'
import type { LabelProps } from '../label'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import { useFieldContext } from '../..'
import Textarea from '../../../textarea'
import Label from '../label'

type TextAreaFieldProps = {
  label: string
  labelOptions?: Omit<LabelProps, 'htmlFor' | 'label'>
  className?: string
} & Omit<TextareaProps, 'className' | 'onChange' | 'onBlur' | 'value' | 'id'>

const TextAreaField = ({
  label,
  labelOptions,
  className,
  ...inputProps
}: TextAreaFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        {...(labelOptions ?? {})}
      />
      <Textarea
        id={field.name}
        value={field.state.value}
        onChange={e => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
        {...inputProps}
      />
    </div>
  )
}

export default TextAreaField
