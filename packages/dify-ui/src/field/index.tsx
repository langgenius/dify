'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '../cn'
import { formLabelClassName, textControlVariants } from '../form-control-shared'

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
      className={cn(formLabelClassName, className)}
      {...props}
    />
  )
}

export type FieldControlSize = NonNullable<VariantProps<typeof textControlVariants>['size']>

export type FieldControlProps
  = Omit<BaseFieldNS.Control.Props, 'className' | 'size'>
    & VariantProps<typeof textControlVariants>
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
      className={cn(textControlVariants({ size }), className)}
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
