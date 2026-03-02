'use client'

import type { Placement } from '@floating-ui/react'
import { Select as BaseSelect } from '@base-ui/react/select'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const Select = BaseSelect.Root
export const SelectValue = BaseSelect.Value
export const SelectGroup = BaseSelect.Group
export const SelectGroupLabel = BaseSelect.GroupLabel
export const SelectSeparator = BaseSelect.Separator

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        'group relative flex h-8 w-full items-center rounded-lg border-0 bg-components-input-bg-normal px-2 text-left text-components-input-text-filled outline-none',
        'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon className="ml-1 shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary data-[open]:text-text-secondary">
        <span className="i-ri-arrow-down-s-line h-4 w-4" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
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
}

export function SelectContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  listClassName,
}: SelectContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-dropdown outline-none', className)}
      >
        <BaseSelect.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            popupClassName,
          )}
        >
          <BaseSelect.List className={cn('max-h-80 min-w-[10rem] overflow-auto p-1 outline-none', listClassName)}>
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
        'flex h-8 cursor-pointer items-center rounded-lg px-2 text-text-secondary outline-none system-sm-medium',
        'data-[disabled]:cursor-not-allowed data-[highlighted]:bg-state-base-hover data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText className="mr-1 grow truncate px-1">
        {children}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="flex shrink-0 items-center text-text-accent">
        <span className="i-ri-check-line h-4 w-4" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}
