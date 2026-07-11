'use client'

import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import type { Placement } from '../placement'
import { Select as BaseSelect } from '@base-ui/react/select'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'
import {
  overlayLabelClassName,
  overlayPopupAnimationClassName,
  overlaySeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

export type { Placement }

export type SelectProps<
  Value,
  Multiple extends boolean | undefined = false,
> = BaseSelect.Root.Props<Value, Multiple>

export function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
): React.JSX.Element {
  return <BaseSelect.Root {...props} />
}

export const SelectValue = BaseSelect.Value
export const SelectGroup = BaseSelect.Group

const selectTriggerVariants = cva(
  [
    'group flex w-full items-center border-0 bg-components-input-bg-normal text-start text-components-input-text-filled outline-hidden',
    'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
    'focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-active',
    'data-placeholder:text-components-input-text-placeholder',
    'data-readonly:cursor-default data-readonly:bg-components-input-bg-normal data-readonly:hover:bg-components-input-bg-normal',
    'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
    'data-disabled:data-placeholder:text-components-input-text-disabled',
  ],
  {
    variants: {
      size: {
        small: 'h-6 gap-px rounded-md px-2 py-1 system-xs-regular',
        medium: 'h-8 gap-0.5 rounded-lg px-3 py-2 system-sm-regular',
        large: 'h-9 gap-0.5 rounded-[10px] px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type SelectTriggerProps
  = Omit<BaseSelect.Trigger.Props, 'className'>
    & VariantProps<typeof selectTriggerVariants>
    & { className?: string }

export function SelectTrigger({
  className,
  children,
  size,
  ...props
}: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      className={cn(selectTriggerVariants({ size, className }))}
      {...props}
    >
      <span className="min-w-0 grow truncate">
        {children}
      </span>
      <BaseSelect.Icon className="shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary group-data-readonly:hidden data-popup-open:text-text-secondary">
        <span className="i-ri-arrow-down-s-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

export function SelectLabel({
  className,
  ...props
}: BaseSelect.Label.Props) {
  return (
    <BaseSelect.Label
      className={cn(formLabelClassName, className)}
      {...props}
    />
  )
}

export function SelectGroupLabel({
  className,
  ...props
}: BaseSelect.GroupLabel.Props) {
  return (
    <BaseSelect.GroupLabel
      className={cn(overlayLabelClassName, className)}
      {...props}
    />
  )
}

export function SelectSeparator({
  className,
  ...props
}: BaseSelect.Separator.Props) {
  return (
    <BaseSelect.Separator
      className={cn(overlaySeparatorClassName, className)}
      {...props}
    />
  )
}

type SelectContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  listClassName?: string
  positionerProps?: Omit<
    BaseSelect.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BaseSelect.Popup.Props,
    'children' | 'className'
  >
  listProps?: Omit<
    BaseSelect.List.Props,
    'children' | 'className'
  >
}

export function SelectContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  listClassName,
  positionerProps,
  popupProps,
  listProps,
}: SelectContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        alignItemWithTrigger={false}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseSelect.Popup
          className={cn(
            'min-w-(--anchor-width) rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            overlayPopupAnimationClassName,
            popupClassName,
          )}
          {...popupProps}
        >
          <BaseSelect.List
            className={cn('max-h-80 overflow-auto p-1 outline-hidden', listClassName)}
            {...listProps}
          >
            {children}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

export function SelectItem({
  className,
  ...props
}: BaseSelect.Item.Props) {
  return (
    <BaseSelect.Item
      className={cn(
        'flex h-8 cursor-pointer items-center rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-state-base-hover',
        className,
      )}
      {...props}
    />
  )
}

export function SelectItemText({
  className,
  ...props
}: BaseSelect.ItemText.Props) {
  return (
    <BaseSelect.ItemText
      className={cn('me-1 min-w-0 grow truncate px-1', className)}
      {...props}
    />
  )
}

export function SelectItemIndicator({
  className,
  ...props
}: Omit<BaseSelect.ItemIndicator.Props, 'children'>) {
  return (
    <BaseSelect.ItemIndicator
      className={cn('ms-auto flex shrink-0 items-center text-text-accent', className)}
      {...props}
    >
      <span className="i-ri-check-line h-4 w-4" aria-hidden />
    </BaseSelect.ItemIndicator>
  )
}
