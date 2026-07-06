'use client'

import type { Radio as BaseRadioNS } from '@base-ui/react/radio'
import type * as React from 'react'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { cn } from '../cn'

const radioControlClassName = cn(
  'inline-flex size-4 shrink-0 touch-manipulation items-center justify-center rounded-full p-0 transition-colors motion-reduce:transition-none',
  'border border-components-radio-border bg-components-radio-bg shadow-xs shadow-shadow-shadow-3',
  'hover:border-components-radio-border-hover hover:bg-components-radio-bg-hover',
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-0',
  'data-checked:border-[5px] data-checked:border-components-radio-border-checked data-checked:hover:border-components-radio-border-checked-hover',
  'data-disabled:cursor-not-allowed data-disabled:border-components-radio-border-disabled data-disabled:bg-components-radio-bg-disabled',
  'data-disabled:hover:border-components-radio-border-disabled data-disabled:hover:bg-components-radio-bg-disabled',
  'data-disabled:data-checked:border-[5px] data-disabled:data-checked:border-components-radio-border-checked-disabled',
  'data-disabled:data-checked:hover:border-components-radio-border-checked-disabled',
)

const radioSkeletonClassName = 'size-4 shrink-0 rounded-full bg-text-quaternary opacity-20'

export type RadioItemProps<Value = string>
  = Omit<BaseRadioNS.Root.Props<Value>, 'className'>
    & {
      className?: string
    }

export function RadioItem<Value = string>({
  className,
  ...props
}: RadioItemProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      className={className}
      {...props}
    />
  )
}

export type RadioControlProps
  = Omit<BaseRadioNS.Indicator.Props, 'className' | 'children' | 'keepMounted'>
    & {
      className?: string
    }

export function RadioControl({
  className,
  ...props
}: RadioControlProps) {
  return (
    <BaseRadio.Indicator
      {...props}
      keepMounted
      className={cn(radioControlClassName, className)}
    />
  )
}

export type RadioProps<Value = string>
  = Omit<RadioItemProps<Value>, 'children'>

export function Radio<Value = string>({
  className,
  ...props
}: RadioProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      className={cn(radioControlClassName, className)}
      {...props}
    />
  )
}

export type RadioSkeletonProps = React.ComponentProps<'div'>

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
