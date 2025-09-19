import React from 'react'
import { useFieldContext } from '../..'
import type { LabelProps } from '../label'
import Label from '../label'
import cn from '@/utils/classnames'
import type { TextareaProps } from '../../../textarea'
import Textarea from '../../../textarea'

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
