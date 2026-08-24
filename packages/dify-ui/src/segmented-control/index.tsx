'use client'

import type { Radio as BaseRadioNS } from '@base-ui/react/radio'
import type { RadioGroup as BaseRadioGroupNS } from '@base-ui/react/radio-group'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import * as React from 'react'
import { cn } from '../cn'

type SegmentedControlSelectionProps<Value> =
  | {
      value: Value
      defaultValue?: never
    }
  | {
      value?: never
      defaultValue: Value
    }

type SegmentedControlProps<Value = string> = Omit<
  BaseRadioGroupNS.Props<Value>,
  'className' | 'defaultValue' | 'value'
> &
  SegmentedControlSelectionProps<Value> & {
    className?: string
  }

function SegmentedControl<Value = string>({ className, ...props }: SegmentedControlProps<Value>) {
  return (
    <BaseRadioGroup<Value>
      className={cn(
        'inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5',
        className,
      )}
      {...props}
    />
  )
}

type SegmentedControlItemProps<Value = string> = Omit<
  BaseRadioNS.Root.Props<Value>,
  'className'
> & {
  className?: string
}

function SegmentedControlItem<Value = string>({
  className,
  nativeButton = true,
  render = <button type="button" />,
  ...props
}: SegmentedControlItemProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      nativeButton={nativeButton}
      render={render}
      className={cn(
        'relative flex h-7 min-w-0 touch-manipulation items-center justify-center gap-0.5 overflow-hidden rounded-lg border-[0.5px] border-transparent px-2 py-1 system-sm-medium whitespace-nowrap text-text-secondary hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-components-segmented-control-item-active-border data-checked:bg-components-segmented-control-item-active-bg data-checked:text-text-accent-light-mode-only data-checked:shadow-xs data-checked:shadow-shadow-shadow-3 data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:text-text-disabled data-disabled:shadow-none data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled',
        className,
      )}
      {...props}
    />
  )
}

type SegmentedControlDividerProps = Omit<React.ComponentProps<'span'>, 'className'> & {
  className?: string
}

function SegmentedControlDivider({ className, ...props }: SegmentedControlDividerProps) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={cn('h-3.5 w-px shrink-0 bg-divider-regular', className)}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlDivider, SegmentedControlItem }

export type { SegmentedControlDividerProps, SegmentedControlItemProps, SegmentedControlProps }
