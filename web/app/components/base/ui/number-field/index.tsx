'use client'

import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'

export const NumberField = BaseNumberField.Root
export type NumberFieldRootProps = BaseNumberField.Root.Props

export const numberFieldGroupVariants = cva(
  [
    'group/number-field flex w-full min-w-0 items-stretch overflow-hidden border border-transparent bg-components-input-bg-normal text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    'data-focused:border-components-input-border-active data-focused:bg-components-input-bg-active data-focused:shadow-xs',
    'data-disabled:cursor-not-allowed data-disabled:border-transparent data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled',
    'data-disabled:hover:border-transparent data-disabled:hover:bg-components-input-bg-disabled',
    'data-readonly:shadow-none data-readonly:hover:border-transparent data-readonly:hover:bg-components-input-bg-normal motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        medium: 'rounded-lg',
        large: 'rounded-[10px]',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)
export type NumberFieldSize = NonNullable<VariantProps<typeof numberFieldGroupVariants>['size']>

export type NumberFieldGroupProps = BaseNumberField.Group.Props & VariantProps<typeof numberFieldGroupVariants>

export function NumberFieldGroup({
  className,
  size = 'medium',
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
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent text-components-input-text-filled caret-primary-600 outline-hidden',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'data-readonly:cursor-default',
  ],
  {
    variants: {
      size: {
        medium: 'px-3 py-[7px] system-sm-regular',
        large: 'px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type NumberFieldInputProps = Omit<BaseNumberField.Input.Props, 'size'> & VariantProps<typeof numberFieldInputVariants>

export function NumberFieldInput({
  className,
  size = 'medium',
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
  'flex shrink-0 items-center self-stretch system-sm-regular text-text-tertiary',
  {
    variants: {
      size: {
        medium: 'pr-2',
        large: 'pr-2.5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type NumberFieldUnitProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof numberFieldUnitVariants>

export function NumberFieldUnit({
  className,
  size = 'medium',
  ...props
}: NumberFieldUnitProps) {
  return (
    <span
      className={cn(numberFieldUnitVariants({ size }), className)}
      {...props}
    />
  )
}

const numberFieldControlsVariants = cva(
  'flex shrink-0 flex-col items-stretch border-l border-divider-subtle bg-transparent text-text-tertiary',
)

export type NumberFieldControlsProps = HTMLAttributes<HTMLDivElement>

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

const numberFieldControlButtonVariants = cva(
  [
    'flex touch-manipulation items-center justify-center px-1.5 text-text-tertiary outline-hidden transition-colors select-none',
    'hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover',
    'focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-disabled/number-field:cursor-not-allowed hover:group-data-disabled/number-field:bg-transparent focus-visible:group-data-disabled/number-field:bg-transparent focus-visible:group-data-disabled/number-field:ring-0',
    'group-data-readonly/number-field:cursor-default hover:group-data-readonly/number-field:bg-transparent focus-visible:group-data-readonly/number-field:bg-transparent focus-visible:group-data-readonly/number-field:ring-0',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        medium: '',
        large: '',
      },
      direction: {
        increment: '',
        decrement: '',
      },
    },
    compoundVariants: [
      {
        size: 'medium',
        direction: 'increment',
        className: 'pt-1',
      },
      {
        size: 'medium',
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
      size: 'medium',
      direction: 'increment',
    },
  },
)

type NumberFieldButtonVariantProps = Omit<
  VariantProps<typeof numberFieldControlButtonVariants>,
  'direction'
>

export type NumberFieldButtonProps = BaseNumberField.Increment.Props & NumberFieldButtonVariantProps

const incrementAriaLabel = 'Increment value'
const decrementAriaLabel = 'Decrement value'

export function NumberFieldIncrement({
  className,
  children,
  size = 'medium',
  ...props
}: NumberFieldButtonProps) {
  return (
    <BaseNumberField.Increment
      {...props}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : incrementAriaLabel)}
      className={cn(numberFieldControlButtonVariants({ size, direction: 'increment' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-up-s-line size-3" />}
    </BaseNumberField.Increment>
  )
}

export function NumberFieldDecrement({
  className,
  children,
  size = 'medium',
  ...props
}: NumberFieldButtonProps) {
  return (
    <BaseNumberField.Decrement
      {...props}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : decrementAriaLabel)}
      className={cn(numberFieldControlButtonVariants({ size, direction: 'decrement' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-down-s-line size-3" />}
    </BaseNumberField.Decrement>
  )
}
