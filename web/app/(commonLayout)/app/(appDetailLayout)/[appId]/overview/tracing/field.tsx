'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string) => void
  isRequired?: boolean
  placeholder?: string
  /** Render a textarea instead of a single-line input, for multi-line values such as JSON. */
  multiline?: boolean
  description?: string
}>

const Field: FC<Props> = ({
  className,
  label,
  labelClassName,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
  multiline = false,
  description,
}) => {
  const inputId = React.useId()
  const Control = multiline ? Textarea : Input

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
      <Control
        id={inputId}
        value={value}
        onValueChange={(nextValue: string) => onChange(nextValue)}
        className={multiline ? 'min-h-20 font-mono text-xs' : 'h-9'}
        placeholder={placeholder}
      />
      {description && <div className="mt-1 text-xs text-text-tertiary">{description}</div>}
    </div>
  )
}
export default React.memo(Field)
