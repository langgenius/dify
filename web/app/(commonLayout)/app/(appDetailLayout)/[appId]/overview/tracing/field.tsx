'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string) => void
  isRequired?: boolean
  placeholder?: string
}>

const Field: FC<Props> = ({
  className,
  label,
  labelClassName,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
}) => {
  const inputId = React.useId()

  return (
    <div className={cn(className)}>
      <div className="flex py-1.75">
        <label
          htmlFor={inputId}
          className={cn(
            labelClassName,
            'flex h-4.5 items-center text-[13px] font-medium text-text-primary',
          )}
        >
          {label}{' '}
        </label>
        {isRequired && <span className="ml-0.5 text-xs font-semibold text-[#D92D20]">*</span>}
      </div>
      <Input
        id={inputId}
        value={value}
        onValueChange={(nextValue) => onChange(nextValue)}
        className="h-9"
        placeholder={placeholder}
      />
    </div>
  )
}
export default React.memo(Field)
