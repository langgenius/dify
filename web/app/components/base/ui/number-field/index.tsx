'use client'

import type { VariantProps } from 'class-variance-authority'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

export const NumberField = BaseNumberField.Root
export type NumberFieldRootProps = React.ComponentPropsWithoutRef<typeof BaseNumberField.Root>

export const numberFieldGroupVariants = cva(
  [
    'group/number-field flex w-full min-w-0 items-stretch overflow-hidden border border-transparent bg-components-input-bg-normal text-components-input-text-filled shadow-none outline-none transition-[background-color,border-color,box-shadow]',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    'data-[focused]:border-components-input-border-active data-[focused]:bg-components-input-bg-active data-[focused]:shadow-xs',
    'data-[disabled]:cursor-not-allowed data-[disabled]:border-transparent data-[disabled]:bg-components-input-bg-disabled data-[disabled]:text-components-input-text-filled-disabled',
    'data-[disabled]:hover:border-transparent data-[disabled]:hover:bg-components-input-bg-disabled',
    'data-[readonly]:shadow-none data-[readonly]:hover:border-transparent data-[readonly]:hover:bg-components-input-bg-normal motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        regular: 'radius-md',
        large: 'radius-lg',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)
export type NumberFieldSize = NonNullable<VariantProps<typeof numberFieldGroupVariants>['size']>

export type NumberFieldGroupProps = React.ComponentPropsWithoutRef<typeof BaseNumberField.Group> & VariantProps<typeof numberFieldGroupVariants>

export function NumberFieldGroup({
  className,
  size = 'regular',
  ...props
}: NumberFieldGroupProps) {
  return (
    <BaseNumberField.Group
      className={cn(numberFieldGroupVariants({ size }), className)}
      {...props}
    />
  )
}

export const numberFieldInputVariants = cva(
  [
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent text-components-input-text-filled caret-primary-600 outline-none',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'data-[readonly]:cursor-default',
  ],
  {
    variants: {
      size: {
        regular: 'px-3 py-[7px] system-sm-regular',
        large: 'px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export type NumberFieldInputProps = Omit<React.ComponentPropsWithoutRef<typeof BaseNumberField.Input>, 'size'> & VariantProps<typeof numberFieldInputVariants>

export function NumberFieldInput({
  className,
  size = 'regular',
  ...props
}: NumberFieldInputProps) {
  return (
    <BaseNumberField.Input
      className={cn(numberFieldInputVariants({ size }), className)}
      {...props}
    />
  )
}

export const numberFieldUnitVariants = cva(
  'flex shrink-0 items-center self-stretch text-text-tertiary system-sm-regular',
  {
    variants: {
      size: {
        regular: 'pr-2',
        large: 'pr-2.5',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export type NumberFieldUnitProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof numberFieldUnitVariants>

export function NumberFieldUnit({
  className,
  size = 'regular',
  ...props
}: NumberFieldUnitProps) {
  return (
    <span
      className={cn(numberFieldUnitVariants({ size }), className)}
      {...props}
    />
  )
}

export const numberFieldControlsVariants = cva(
  'flex shrink-0 flex-col items-stretch border-l border-divider-subtle bg-transparent text-text-tertiary',
)

export type NumberFieldControlsProps = React.HTMLAttributes<HTMLDivElement>

export function NumberFieldControls({
  className,
  ...props
}: NumberFieldControlsProps) {
  return (
    <div
      className={cn(numberFieldControlsVariants(), className)}
      {...props}
    />
  )
}

export const numberFieldControlButtonVariants = cva(
  [
    'flex touch-manipulation select-none items-center justify-center px-1.5 text-text-tertiary outline-none transition-colors',
    'hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover',
    'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-[disabled]/number-field:cursor-not-allowed group-data-[disabled]/number-field:hover:bg-transparent group-data-[disabled]/number-field:focus-visible:bg-transparent group-data-[disabled]/number-field:focus-visible:ring-0',
    'group-data-[readonly]/number-field:cursor-default group-data-[readonly]/number-field:hover:bg-transparent group-data-[readonly]/number-field:focus-visible:bg-transparent group-data-[readonly]/number-field:focus-visible:ring-0',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        regular: '',
        large: '',
      },
      direction: {
        increment: '',
        decrement: '',
      },
    },
    compoundVariants: [
      {
        size: 'regular',
        direction: 'increment',
        className: 'pt-1',
      },
      {
        size: 'regular',
        direction: 'decrement',
        className: 'pb-1',
      },
      {
        size: 'large',
        direction: 'increment',
        className: 'pt-1.5',
      },
      {
        size: 'large',
        direction: 'decrement',
        className: 'pb-1.5',
      },
    ],
    defaultVariants: {
      size: 'regular',
      direction: 'increment',
    },
  },
)

type NumberFieldButtonVariantProps = Omit<
  VariantProps<typeof numberFieldControlButtonVariants>,
  'direction'
>

export type NumberFieldButtonProps = React.ComponentPropsWithoutRef<typeof BaseNumberField.Increment> & NumberFieldButtonVariantProps

export function NumberFieldIncrement({
  className,
  children,
  size = 'regular',
  ...props
}: NumberFieldButtonProps) {
  const { t } = useTranslation()

  return (
    <BaseNumberField.Increment
      {...props}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : t('operation.increment', { ns: 'common' }))}
      className={cn(numberFieldControlButtonVariants({ size, direction: 'increment' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-up-s-line size-3" />}
    </BaseNumberField.Increment>
  )
}

export function NumberFieldDecrement({
  className,
  children,
  size = 'regular',
  ...props
}: NumberFieldButtonProps) {
  const { t } = useTranslation()

  return (
    <BaseNumberField.Decrement
      {...props}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : t('operation.decrement', { ns: 'common' }))}
      className={cn(numberFieldControlButtonVariants({ size, direction: 'decrement' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-down-s-line size-3" />}
    </BaseNumberField.Decrement>
  )
}
