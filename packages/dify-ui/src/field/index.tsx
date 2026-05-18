'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import { Field as BaseField } from '@base-ui/react/field'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

export type FieldRootProps
  = Omit<BaseFieldNS.Root.Props, 'className'>
    & {
      className?: string
    }

export type FieldRootActions = BaseFieldNS.Root.Actions

export function FieldRoot({
  className,
  ...props
}: FieldRootProps) {
  return (
    <BaseField.Root
      className={cn('group/field grid min-w-0 gap-1', className)}
      {...props}
    />
  )
}

export type FieldItemProps
  = Omit<BaseFieldNS.Item.Props, 'className'>
    & {
      className?: string
    }

export function FieldItem({
  className,
  ...props
}: FieldItemProps) {
  return (
    <BaseField.Item
      className={cn('grid min-w-0 gap-1', className)}
      {...props}
    />
  )
}

export type FieldLabelProps
  = Omit<BaseFieldNS.Label.Props, 'className'>
    & {
      className?: string
    }

export function FieldLabel({
  className,
  ...props
}: FieldLabelProps) {
  return (
    <BaseField.Label
      className={cn('w-fit py-1 text-text-secondary system-sm-medium data-disabled:cursor-not-allowed', className)}
      {...props}
    />
  )
}

const fieldControlVariants = cva(
  [
    'w-full appearance-none border border-transparent bg-components-input-bg-normal text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color,box-shadow]',
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
        small: 'rounded-md px-2 py-[3px] system-xs-regular',
        medium: 'rounded-lg px-3 py-[7px] system-sm-regular',
        large: 'rounded-[10px] px-4 py-[7px] system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type FieldControlSize = NonNullable<VariantProps<typeof fieldControlVariants>['size']>

export type FieldControlProps
  = Omit<BaseFieldNS.Control.Props, 'className' | 'size'>
    & VariantProps<typeof fieldControlVariants>
    & {
      className?: string
    }

export type FieldControlChangeEventDetails = BaseFieldNS.Control.ChangeEventDetails

export function FieldControl({
  className,
  size = 'medium',
  ...props
}: FieldControlProps) {
  return (
    <BaseField.Control
      className={cn(fieldControlVariants({ size }), className)}
      {...props}
    />
  )
}

export type FieldDescriptionProps
  = Omit<BaseFieldNS.Description.Props, 'className'>
    & {
      className?: string
    }

export function FieldDescription({
  className,
  ...props
}: FieldDescriptionProps) {
  return (
    <BaseField.Description
      className={cn('py-0.5 text-text-tertiary body-xs-regular', className)}
      {...props}
    />
  )
}

export type FieldErrorProps
  = Omit<BaseFieldNS.Error.Props, 'className'>
    & {
      className?: string
    }

export function FieldError({
  className,
  ...props
}: FieldErrorProps) {
  return (
    <BaseField.Error
      className={cn('py-0.5 text-text-destructive body-xs-regular', className)}
      {...props}
    />
  )
}

export type FieldValidityProps = BaseFieldNS.Validity.Props
export type FieldValidityState = BaseFieldNS.Validity.State

export const FieldValidity = BaseField.Validity
