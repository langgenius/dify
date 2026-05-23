'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef } from 'react'
import { Field as BaseField } from '@base-ui/react/field'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const textareaVariants = cva(
  [
    'min-h-20 w-full appearance-none border border-transparent bg-components-input-bg-normal text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color,box-shadow]',
    'placeholder:text-components-input-text-placeholder',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    'focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
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

type NativeTextareaProps = Omit<
  ComponentPropsWithRef<'textarea'>,
  'children' | 'className' | 'defaultValue' | 'onChange' | 'size' | 'value'
>

type TextareaControlProps = ControlledTextareaProps | UncontrolledTextareaProps
type TextareaVariantProps = VariantProps<typeof textareaVariants>

export type TextareaProps
  = NativeTextareaProps
    & TextareaControlProps
    & TextareaVariantProps
    & {
      children?: never
      className?: string
    }

export function Textarea({
  className,
  defaultValue,
  onValueChange,
  ref,
  size = 'medium',
  value,
  ...props
}: TextareaProps) {
  return (
    <BaseField.Control
      className={cn(textareaVariants({ size }), className)}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      ref={ref}
      render={<textarea {...props} />}
      value={value}
    />
  )
}
