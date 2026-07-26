'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '../cn'
import { formLabelClassName, textControlVariants } from '../form-control-shared'

export type FieldProps = Omit<BaseFieldNS.Root.Props, 'className'> & {
  className?: string
}

export type FieldActions = BaseFieldNS.Root.Actions

export function Field({ className, ...props }: FieldProps) {
  return <BaseField.Root className={cn('group/field grid min-w-0 gap-1', className)} {...props} />
}

export type FieldItemProps = Omit<BaseFieldNS.Item.Props, 'className'> & {
  className?: string
}

export function FieldItem({ className, ...props }: FieldItemProps) {
  return <BaseField.Item className={cn('grid min-w-0 gap-1', className)} {...props} />
}

export type FieldLabelProps = Omit<BaseFieldNS.Label.Props, 'className'> & {
  className?: string
}

export function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <BaseField.Label className={cn(formLabelClassName, className)} {...props} />
}

export type FieldControlSize = NonNullable<VariantProps<typeof textControlVariants>['size']>

export type FieldControlProps = Omit<BaseFieldNS.Control.Props, 'className' | 'size'> &
  VariantProps<typeof textControlVariants> & {
    className?: string
  }

export type FieldControlChangeEventDetails = BaseFieldNS.Control.ChangeEventDetails

export function FieldControl({ className, size = 'medium', ...props }: FieldControlProps) {
  return <BaseField.Control className={cn(textControlVariants({ size }), className)} {...props} />
}

export type FieldDescriptionProps = Omit<BaseFieldNS.Description.Props, 'className'> & {
  className?: string
}

export function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <BaseField.Description
      className={cn('py-0.5 body-xs-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

export type FieldErrorProps = Omit<BaseFieldNS.Error.Props, 'className'> & {
  className?: string
}

export function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <BaseField.Error
      className={cn('py-0.5 body-xs-regular text-text-destructive', className)}
      {...props}
    />
  )
}

export type FieldValidityProps = BaseFieldNS.Validity.Props
export type FieldValidityState = BaseFieldNS.Validity.State

export const FieldValidity = BaseField.Validity
