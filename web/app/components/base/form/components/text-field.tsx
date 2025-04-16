import React from 'react'
import { useFieldContext } from '..'
import Input from '../../input'
import Label from './label'
import cn from '@/utils/classnames'

type TextFieldProps = {
  label: string
  className?: string
  labelClassName?: string
}

const TextField = ({
  label,
  className,
  labelClassName,
}: TextFieldProps) => {
  const field = useFieldContext<string>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        labelClassName={labelClassName}
      />
      <Input
        id={field.name}
        value={field.state.value}
        onChange={e => field.handleChange(e.target.value)}
        onBlur={field.handleBlur}
      />
    </div>
  )
}

export default TextField
