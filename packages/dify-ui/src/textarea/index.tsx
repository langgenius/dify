'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { Field as BaseField } from '@base-ui/react/field'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { textControlFocusClassName } from '../form-control-shared'

const textareaVariants = cva(
  [
    'min-h-20 w-full appearance-none overflow-auto border border-transparent bg-components-input-bg-normal text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color,box-shadow]',
    'placeholder:text-components-input-text-placeholder',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    textControlFocusClassName,
    'data-invalid:border-components-input-border-destructive data-invalid:bg-components-input-bg-destructive',
    'read-only:cursor-default read-only:shadow-none read-only:hover:border-transparent read-only:hover:bg-components-input-bg-normal read-only:focus:border-transparent read-only:focus:bg-components-input-bg-normal read-only:focus:shadow-none',
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled',
    'disabled:hover:border-transparent disabled:hover:bg-components-input-bg-disabled',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'rounded-md px-2 py-1 system-xs-regular',
        medium: 'rounded-lg px-3 py-2 system-sm-regular',
        large: 'rounded-[10px] px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type TextareaValue = string | number
export type TextareaSize = NonNullable<VariantProps<typeof textareaVariants>['size']>
export type TextareaChangeEventDetails = BaseFieldNS.Control.ChangeEventDetails
type TextareaOnValueChange = (value: string, eventDetails: TextareaChangeEventDetails) => void

type ControlledTextareaProps = {
  value: TextareaValue
  defaultValue?: never
  onValueChange: TextareaOnValueChange
}

type UncontrolledTextareaProps = {
  value?: never
  defaultValue?: TextareaValue
  onValueChange?: TextareaOnValueChange
}

type TextareaNativeProps = React.ComponentPropsWithRef<'textarea'>
type TextareaOnlyProps = Pick<TextareaNativeProps, 'cols' | 'rows' | 'wrap'>
type TextareaElementProps = Omit<
  TextareaNativeProps,
  'children' | 'className' | 'cols' | 'defaultValue' | 'onChange' | 'rows' | 'size' | 'value' | 'wrap'
>

type TextareaControlProps = ControlledTextareaProps | UncontrolledTextareaProps
type TextareaVariantProps = VariantProps<typeof textareaVariants>
type FieldControlTextareaProps = Omit<
  BaseFieldNS.Control.Props,
  'className' | 'defaultValue' | 'onValueChange' | 'render' | 'value'
>

export type TextareaProps
  = TextareaElementProps
    & TextareaOnlyProps
    & TextareaControlProps
    & TextareaVariantProps
    & {
      children?: never
      className?: string
    }

export function Textarea({
  className,
  cols,
  defaultValue,
  onValueChange,
  ref,
  rows,
  size = 'medium',
  value,
  wrap,
  ...controlProps
}: TextareaProps) {
  // Base UI types Field.Control as an input even when render replaces it with a textarea.
  const fieldControlProps = controlProps as FieldControlTextareaProps

  return (
    <BaseField.Control
      {...fieldControlProps}
      className={cn(textareaVariants({ size }), className)}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      ref={ref}
      render={<textarea cols={cols} rows={rows} wrap={wrap} />}
      value={value}
    />
  )
}
