'use client'

import type { VariantProps } from 'class-variance-authority'
import { NumberField as BaseNumberField } from '@base-ui/react/number-field'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'
import { textControlCompoundInputFocusClassName } from '../form-control-shared'

const NumberField = BaseNumberField.Root
type NumberFieldProps = BaseNumberField.Root.Props

const numberFieldGroupVariants = cva(
  [
    'group/number-field flex w-full min-w-0 items-stretch overflow-hidden border border-transparent bg-components-input-bg-normal text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    textControlCompoundInputFocusClassName,
    'data-focused:border-components-input-border-active data-focused:bg-components-input-bg-active data-focused:shadow-xs',
    'data-invalid:border-components-input-border-destructive data-invalid:bg-components-input-bg-destructive',
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
type NumberFieldSize = NonNullable<VariantProps<typeof numberFieldGroupVariants>['size']>

type NumberFieldGroupProps = Omit<BaseNumberField.Group.Props, 'className'> &
  VariantProps<typeof numberFieldGroupVariants> & {
    className?: string
  }

function NumberFieldGroup({ className, size = 'medium', ...props }: NumberFieldGroupProps) {
  return (
    <BaseNumberField.Group
      className={cn(numberFieldGroupVariants({ size }), className)}
      {...props}
    />
  )
}

const numberFieldInputVariants = cva(
  [
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent text-components-input-text-filled caret-primary-600 outline-hidden',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'data-readonly:cursor-default',
  ],
  {
    variants: {
      size: {
        medium: 'px-3 py-1.75 system-sm-regular',
        large: 'px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type NumberFieldInputProps = Omit<BaseNumberField.Input.Props, 'className' | 'size'> &
  VariantProps<typeof numberFieldInputVariants> & {
    className?: string
  }

function NumberFieldInput({ className, size = 'medium', ...props }: NumberFieldInputProps) {
  return (
    <BaseNumberField.Input
      className={cn(numberFieldInputVariants({ size }), className)}
      {...props}
    />
  )
}

const numberFieldUnitVariants = cva(
  'flex shrink-0 items-center self-stretch system-sm-regular text-text-tertiary',
  {
    variants: {
      size: {
        medium: 'pe-2',
        large: 'pe-2.5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type NumberFieldUnitProps = React.ComponentProps<'span'> &
  VariantProps<typeof numberFieldUnitVariants>

function NumberFieldUnit({ className, size = 'medium', ...props }: NumberFieldUnitProps) {
  return <span className={cn(numberFieldUnitVariants({ size }), className)} {...props} />
}

const numberFieldControlsVariants = cva(
  'flex shrink-0 flex-col items-stretch border-l border-divider-subtle bg-transparent text-text-tertiary',
)

type NumberFieldControlsProps = React.ComponentProps<'div'>

function NumberFieldControls({ className, ...props }: NumberFieldControlsProps) {
  return <div className={cn(numberFieldControlsVariants(), className)} {...props} />
}

const numberFieldControlButtonVariants = cva(
  [
    'flex touch-manipulation items-center justify-center px-1.5 text-text-tertiary outline-hidden transition-colors select-none',
    'hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover',
    'focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
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

type NumberFieldIncrementProps = Omit<BaseNumberField.Increment.Props, 'className'> &
  NumberFieldButtonVariantProps & {
    className?: string
  }
type NumberFieldDecrementProps = Omit<BaseNumberField.Decrement.Props, 'className'> &
  NumberFieldButtonVariantProps & {
    className?: string
  }

const incrementAriaLabel = 'Increment value'
const decrementAriaLabel = 'Decrement value'

function NumberFieldIncrement({
  className,
  children,
  size = 'medium',
  ...props
}: NumberFieldIncrementProps) {
  return (
    <BaseNumberField.Increment
      {...props}
      aria-label={
        props['aria-label'] ?? (props['aria-labelledby'] ? undefined : incrementAriaLabel)
      }
      className={cn(numberFieldControlButtonVariants({ size, direction: 'increment' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-up-s-line size-3" />}
    </BaseNumberField.Increment>
  )
}

function NumberFieldDecrement({
  className,
  children,
  size = 'medium',
  ...props
}: NumberFieldDecrementProps) {
  return (
    <BaseNumberField.Decrement
      {...props}
      aria-label={
        props['aria-label'] ?? (props['aria-labelledby'] ? undefined : decrementAriaLabel)
      }
      className={cn(numberFieldControlButtonVariants({ size, direction: 'decrement' }), className)}
    >
      {children ?? <span aria-hidden="true" className="i-ri-arrow-down-s-line size-3" />}
    </BaseNumberField.Decrement>
  )
}

export {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldUnit,
}
export type {
  NumberFieldControlsProps,
  NumberFieldDecrementProps,
  NumberFieldGroupProps,
  NumberFieldIncrementProps,
  NumberFieldInputProps,
  NumberFieldProps,
  NumberFieldSize,
  NumberFieldUnitProps,
}
