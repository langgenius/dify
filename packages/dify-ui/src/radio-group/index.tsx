'use client'

import type { Radio as BaseRadioNS } from '@base-ui/react/radio'
import type { RadioGroup as BaseRadioGroupNS } from '@base-ui/react/radio-group'
import type * as React from 'react'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'

type RadioGroupProps<Value = string> = BaseRadioGroupNS.Props<Value>

function RadioGroup<Value = string>({ className, ...props }: RadioGroupProps<Value>) {
  return (
    <BaseRadioGroup<Value>
      className={(state) => cn('flex items-center gap-2', resolveClassName(className, state))}
      {...props}
    />
  )
}

type RadioItemProps<Value = string> = BaseRadioNS.Root.Props<Value>

function RadioItem<Value = string>({ className, ...props }: RadioItemProps<Value>) {
  return <BaseRadio.Root<Value> className={className} {...props} />
}

type RadioControlProps = Omit<BaseRadioNS.Indicator.Props, 'children' | 'keepMounted'>

function RadioControl({ className, ...props }: RadioControlProps) {
  return (
    <BaseRadio.Indicator
      {...props}
      keepMounted
      className={(state) =>
        cn(
          'inline-flex size-4 shrink-0 touch-manipulation items-center justify-center rounded-full p-0 transition-colors motion-reduce:transition-none',
          'border border-components-radio-border bg-components-radio-bg shadow-xs shadow-shadow-shadow-3',
          'hover:border-components-radio-border-hover hover:bg-components-radio-bg-hover',
          'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-0 focus-visible:outline-hidden',
          'data-checked:border-[5px] data-checked:border-components-radio-border-checked data-checked:hover:border-components-radio-border-checked-hover',
          'data-disabled:cursor-not-allowed data-disabled:border-components-radio-border-disabled data-disabled:bg-components-radio-bg-disabled',
          'data-disabled:hover:border-components-radio-border-disabled data-disabled:hover:bg-components-radio-bg-disabled',
          'data-disabled:data-checked:border-[5px] data-disabled:data-checked:border-components-radio-border-checked-disabled',
          'data-disabled:data-checked:hover:border-components-radio-border-checked-disabled',
          resolveClassName(className, state),
        )
      }
    />
  )
}

type RadioProps<Value = string> = Omit<RadioItemProps<Value>, 'children'>

function Radio<Value = string>({ className, ...props }: RadioProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      className={cn(
        'inline-flex size-4 shrink-0 touch-manipulation items-center justify-center rounded-full p-0 transition-colors motion-reduce:transition-none',
        'border border-components-radio-border bg-components-radio-bg shadow-xs shadow-shadow-shadow-3',
        'hover:border-components-radio-border-hover hover:bg-components-radio-bg-hover',
        'focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-offset-0 focus-visible:outline-hidden',
        'data-checked:border-[5px] data-checked:border-components-radio-border-checked data-checked:hover:border-components-radio-border-checked-hover',
        'data-disabled:cursor-not-allowed data-disabled:border-components-radio-border-disabled data-disabled:bg-components-radio-bg-disabled',
        'data-disabled:hover:border-components-radio-border-disabled data-disabled:hover:bg-components-radio-bg-disabled',
        'data-disabled:data-checked:border-[5px] data-disabled:data-checked:border-components-radio-border-checked-disabled',
        'data-disabled:data-checked:hover:border-components-radio-border-checked-disabled',
        className,
      )}
      {...props}
    />
  )
}

type RadioSkeletonProps = React.ComponentProps<'div'>

function RadioSkeleton({ className, ...props }: RadioSkeletonProps) {
  return (
    <div
      className={cn('size-4 shrink-0 rounded-full bg-text-quaternary opacity-20', className)}
      {...props}
    />
  )
}

export { Radio, RadioControl, RadioGroup, RadioItem, RadioSkeleton }

export type { RadioControlProps, RadioGroupProps, RadioItemProps, RadioProps, RadioSkeletonProps }
