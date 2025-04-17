import React from 'react'
import { useFieldContext } from '../..'
import Label from '../label'
import cn from '@/utils/classnames'
import { InputNumber } from '../../../input-number'

type TextFieldProps = {
  label: string
  className?: string
  labelClassName?: string
}

const NumberInputField = ({
  label,
  className,
  labelClassName,
}: TextFieldProps) => {
  const field = useFieldContext<number | undefined>()

  return (
    <div className={cn('flex flex-col gap-y-0.5', className)}>
      <Label
        htmlFor={field.name}
        label={label}
        labelClassName={labelClassName}
      />
      <InputNumber
        id={field.name}
        value={field.state.value}
        onChange={value => field.handleChange(value)}
        onBlur={field.handleBlur}
      />
    </div>
  )
}

export default NumberInputField
