'use client'

import type { Radio as BaseRadioNS } from '@base-ui/react/radio'
import type { HTMLAttributes } from 'react'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { cn } from '../cn'

const radioRootClassName = cn(
  'inline-flex size-4 shrink-0 touch-manipulation items-center justify-center rounded-full p-0 transition-colors motion-reduce:transition-none',
  'border border-components-radio-border bg-components-radio-bg shadow-xs shadow-shadow-shadow-3',
  'hover:border-components-radio-border-hover hover:bg-components-radio-bg-hover',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover focus-visible:ring-offset-0',
  'data-checked:border-[5px] data-checked:border-components-radio-border-checked data-checked:hover:border-components-radio-border-checked-hover',
  'data-disabled:cursor-not-allowed data-disabled:border-components-radio-border-disabled data-disabled:bg-components-radio-bg-disabled',
  'data-disabled:hover:border-components-radio-border-disabled data-disabled:hover:bg-components-radio-bg-disabled',
  'data-disabled:data-checked:border-[5px] data-disabled:data-checked:border-components-radio-border-checked-disabled',
  'data-disabled:data-checked:hover:border-components-radio-border-checked-disabled',
)

const radioIndicatorClassName = 'flex items-center justify-center data-unchecked:hidden before:size-1.5 before:rounded-full before:bg-current'

const radioControlClassName = radioRootClassName

const radioSkeletonClassName = 'size-4 shrink-0 rounded-full bg-text-quaternary opacity-20'

export type RadioRootProps<Value = string>
  = Omit<BaseRadioNS.Root.Props<Value>, 'className'>
    & {
      className?: string
      variant?: 'control' | 'unstyled'
    }

export function RadioRoot<Value = string>({
  className,
  variant = 'control',
  ...props
}: RadioRootProps<Value>) {
  return (
    <BaseRadio.Root
      className={cn(variant === 'control' && radioRootClassName, className)}
      {...props}
    />
  )
}

export type RadioIndicatorProps
  = Omit<BaseRadioNS.Indicator.Props, 'className' | 'children'>
    & {
      className?: string
    }

export function RadioIndicator({
  className,
  ...props
}: RadioIndicatorProps) {
  return (
    <BaseRadio.Indicator
      className={cn(radioIndicatorClassName, className)}
      {...props}
    />
  )
}

export type RadioControlProps
  = Omit<RadioIndicatorProps, 'keepMounted'>

export function RadioControl({
  className,
  ...props
}: RadioControlProps) {
  return (
    <BaseRadio.Indicator
      keepMounted
      className={cn(radioControlClassName, className)}
      {...props}
    />
  )
}

export type RadioProps<Value = string>
  = Omit<RadioRootProps<Value>, 'children'>

export function Radio<Value = string>({
  ...props
}: RadioProps<Value>) {
  return <RadioRoot {...props} />
}

export type RadioSkeletonProps
  = Omit<HTMLAttributes<HTMLDivElement>, 'className'>
    & {
      className?: string
    }

export function RadioSkeleton({
  className,
  ...props
}: RadioSkeletonProps) {
  return (
    <div
      className={cn(radioSkeletonClassName, className)}
      {...props}
    />
  )
}
