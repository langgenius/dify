'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'

export const Select = BaseSelect.Root
export const SelectValue = BaseSelect.Value
export const SelectTrigger = BaseSelect.Trigger
export const SelectIcon = BaseSelect.Icon
/** @public */
export const SelectGroup = BaseSelect.Group
/** @public */
export const SelectSeparator = BaseSelect.Separator

export const SelectPrimitiveItem = BaseSelect.Item
export const SelectItemText = BaseSelect.ItemText

export function SelectGroupLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>) {
  return (
    <BaseSelect.GroupLabel
      className={cn('px-3 pt-1 pb-0.5 system-xs-medium-uppercase text-text-tertiary', className)}
      {...props}
    />
  )
}

export function SelectItemIndicator({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof BaseSelect.ItemIndicator>, 'children'>) {
  return (
    <BaseSelect.ItemIndicator
      className={cn('flex shrink-0 items-center text-text-accent', className)}
      {...props}
    >
      <span className="i-ri-check-line h-4 w-4" aria-hidden />
    </BaseSelect.ItemIndicator>
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
    React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>,
    'children' | 'className'
  >
  listProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseSelect.List>,
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
        className={cn('z-1002 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseSelect.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-(--transform-origin) transition-[transform,scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none',
            popupClassName,
          )}
          {...popupProps}
        >
          <BaseSelect.List
            className={cn('max-h-80 min-w-40 overflow-auto p-1 outline-hidden', listClassName)}
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
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        'flex h-8 cursor-pointer items-center rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-state-base-hover',
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText className="mr-1 min-w-0 grow truncate px-1">
        {children}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="flex shrink-0 items-center text-text-accent">
        <span className="i-ri-check-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}
