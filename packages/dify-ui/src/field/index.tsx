'use client'

import type { Field as BaseFieldNS } from '@base-ui/react/field'
import { Field as BaseField } from '@base-ui/react/field'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'
import { resolveClassName } from '../internals/resolve-class-name'

type FieldProps = BaseFieldNS.Root.Props

function Field({ className, ...props }: FieldProps) {
  return (
    <BaseField.Root
      className={(state) =>
        cn('group/field grid min-w-0 gap-1', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type FieldItemProps = BaseFieldNS.Item.Props

function FieldItem({ className, ...props }: FieldItemProps) {
  return (
    <BaseField.Item
      className={(state) => cn('grid min-w-0 gap-1', resolveClassName(className, state))}
      {...props}
    />
  )
}

type FieldLabelProps = BaseFieldNS.Label.Props

function FieldLabel({ className, ...props }: FieldLabelProps) {
  return (
    <BaseField.Label
      className={(state) => cn(formLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type FieldDescriptionProps = BaseFieldNS.Description.Props

function FieldDescription({ className, ...props }: FieldDescriptionProps) {
  return (
    <BaseField.Description
      className={(state) =>
        cn('py-0.5 body-xs-regular text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type FieldErrorProps = BaseFieldNS.Error.Props

function FieldError({ className, ...props }: FieldErrorProps) {
  return (
    <BaseField.Error
      className={(state) =>
        cn('py-0.5 body-xs-regular text-text-destructive', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type FieldValidityProps = BaseFieldNS.Validity.Props

const FieldValidity = BaseField.Validity

export { Field, FieldDescription, FieldError, FieldItem, FieldLabel, FieldValidity }

export type {
  FieldDescriptionProps,
  FieldErrorProps,
  FieldItemProps,
  FieldLabelProps,
  FieldProps,
  FieldValidityProps,
}
