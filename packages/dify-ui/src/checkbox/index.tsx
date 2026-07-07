'use client'

import type { Checkbox as BaseCheckboxNS } from '@base-ui/react/checkbox'
import type * as React from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { cn } from '../cn'

const checkboxRootClassName = cn(
  'inline-flex size-4 shrink-0 touch-manipulation items-center justify-center rounded-sm shadow-xs shadow-shadow-shadow-3 transition-colors motion-reduce:transition-none',
  'border border-components-checkbox-border bg-components-checkbox-bg-unchecked text-components-checkbox-icon',
  'hover:border-components-checkbox-border-hover hover:bg-components-checkbox-bg-unchecked-hover',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-0',
  'data-checked:border-transparent data-checked:bg-components-checkbox-bg data-checked:hover:bg-components-checkbox-bg-hover',
  'data-indeterminate:border-transparent data-indeterminate:bg-components-checkbox-bg data-indeterminate:hover:bg-components-checkbox-bg-hover',
  'data-disabled:cursor-not-allowed data-disabled:border-components-checkbox-border-disabled data-disabled:bg-components-checkbox-bg-disabled',
  'data-disabled:hover:border-components-checkbox-border-disabled data-disabled:hover:bg-components-checkbox-bg-disabled',
  'data-disabled:data-checked:border-transparent data-disabled:data-checked:bg-components-checkbox-bg-disabled-checked data-disabled:data-checked:text-components-checkbox-icon-disabled',
  'data-disabled:data-checked:hover:bg-components-checkbox-bg-disabled-checked',
  'data-disabled:data-indeterminate:border-transparent data-disabled:data-indeterminate:bg-components-checkbox-bg-disabled-checked data-disabled:data-indeterminate:text-components-checkbox-icon-disabled',
  'data-disabled:data-indeterminate:hover:bg-components-checkbox-bg-disabled-checked',
)

const checkboxIndicatorClassName = 'flex size-3 items-center justify-center text-current data-unchecked:hidden'

const checkboxSkeletonClassName = 'size-4 shrink-0 rounded-sm bg-text-quaternary opacity-20'

export type CheckboxRootProps
  = Omit<BaseCheckboxNS.Root.Props, 'className'>
    & {
      className?: string
    }

export function CheckboxRoot({
  className,
  ...props
}: CheckboxRootProps) {
  return (
    <BaseCheckbox.Root
      className={cn(checkboxRootClassName, className)}
      {...props}
    />
  )
}

export type CheckboxIndicatorProps
  = Omit<BaseCheckboxNS.Indicator.Props, 'className' | 'children'>
    & {
      className?: string
    }

export function CheckboxIndicator({
  className,
  render,
  ...props
}: CheckboxIndicatorProps) {
  return (
    <BaseCheckbox.Indicator
      className={cn(checkboxIndicatorClassName, className)}
      render={render ?? ((indicatorProps, state) => (
        <span {...indicatorProps}>
          {state.indeterminate
            ? <span className="block h-[1.5px] w-1.75 rounded-full bg-current" />
            : <span className="i-ri-check-line block size-3 shrink-0" />}
        </span>
      ))}
      {...props}
    />
  )
}

export type CheckboxProps
  = Omit<CheckboxRootProps, 'children'>

export function Checkbox({
  ...props
}: CheckboxProps) {
  return (
    <CheckboxRoot {...props}>
      <CheckboxIndicator />
    </CheckboxRoot>
  )
}

export type CheckboxSkeletonProps
  = Omit<React.ComponentProps<'div'>, 'className'>
    & {
      className?: string
    }

export function CheckboxSkeleton({
  className,
  ...props
}: CheckboxSkeletonProps) {
  return (
    <div
      className={cn(checkboxSkeletonClassName, className)}
      {...props}
    />
  )
}
