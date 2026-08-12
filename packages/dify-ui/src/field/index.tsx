'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import type { VariantProps } from 'class-variance-authority'
import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '../cn'
import { formLabelClassName, textControlVariants } from '../form-control-shared'

type FieldProps = Omit<BaseFieldNS.Root.Props, 'className'> & {
  className?: string
}

function Field({ className, ...props }: FieldProps) {
  return <BaseField.Root className={cn('group/field grid min-w-0 gap-1', className)} {...props} />
}

type FieldItemProps = Omit<BaseFieldNS.Item.Props, 'className'> & {
  className?: string
}

function FieldItem({ className, ...props }: FieldItemProps) {
  return <BaseField.Item className={cn('grid min-w-0 gap-1', className)} {...props} />
}

type FieldLabelProps = Omit<BaseFieldNS.Label.Props, 'className'> & {
  className?: string
}

function FieldLabel({ className, ...props }: FieldLabelProps) {
  return <BaseField.Label className={cn(formLabelClassName, className)} {...props} />
}

type FieldControlProps = Omit<BaseFieldNS.Control.Props, 'className' | 'size'> &
  VariantProps<typeof textControlVariants> & {
    className?: string
  }

function FieldControl({ className, size = 'medium', ...props }: FieldControlProps) {
  return <BaseField.Control className={cn(textControlVariants({ size }), className)} {...props} />
}

type FieldDescriptionProps = Omit<BaseFieldNS.Description.Props, 'className'> & {
  className?: string
}

function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <BaseField.Description
      className={cn('py-0.5 body-xs-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

type FieldErrorProps = Omit<BaseFieldNS.Error.Props, 'className'> & {
  className?: string
}

function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <BaseField.Error
      className={cn('py-0.5 body-xs-regular text-text-destructive', className)}
      {...props}
    />
  )
}

type FieldValidityProps = BaseFieldNS.Validity.Props

const FieldValidity = BaseField.Validity

export { Field, FieldControl, FieldDescription, FieldError, FieldItem, FieldLabel, FieldValidity }

export type {
  FieldControlProps,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldItemProps,
  FieldLabelProps,
  FieldProps,
  FieldValidityProps,
}
