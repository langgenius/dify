'use client'

import type { Placement } from '@floating-ui/react'
import { Menu } from '@base-ui/react/menu'
import * as React from 'react'
import { cn } from '@/utils/classnames'

function parsePlacement(placement: Placement) {
  const [side, align] = placement.split('-') as [
    'top' | 'bottom' | 'left' | 'right',
    'start' | 'center' | 'end' | undefined,
  ]
  return { side, align: align ?? 'center' as const }
}

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuGroupLabel = Menu.GroupLabel
export const DropdownMenuRadioGroup = Menu.RadioGroup
export const DropdownMenuRadioItem = Menu.RadioItem
export const DropdownMenuRadioItemIndicator = Menu.RadioItemIndicator
export const DropdownMenuCheckboxItem = Menu.CheckboxItem
export const DropdownMenuCheckboxItemIndicator = Menu.CheckboxItemIndicator

type DropdownMenuContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
}

export function DropdownMenuContent({
  children,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
}: DropdownMenuContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-dropdown outline-none', className)}
      >
        <Menu.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-1 text-sm text-text-secondary shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            popupClassName,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof Menu.SubmenuTrigger> & {
  destructive?: boolean
}

export function DropdownMenuSubTrigger({
  className,
  destructive,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <Menu.SubmenuTrigger
      className={cn(
        'mx-1 flex h-8 cursor-pointer select-none items-center rounded-lg px-3 outline-none',
        'data-[highlighted]:bg-components-panel-on-panel-item-bg-hover',
        destructive && 'text-text-destructive',
        className,
      )}
      {...props}
    />
  )
}

type DropdownMenuSubContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
}

export function DropdownMenuSubContent({
  children,
  placement = 'left-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
}: DropdownMenuSubContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-dropdown outline-none', className)}
      >
        <Menu.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-1 text-sm text-text-secondary shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            popupClassName,
          )}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof Menu.Item> & {
  destructive?: boolean
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      className={cn(
        'mx-1 flex h-8 cursor-pointer select-none items-center rounded-lg px-3 outline-none',
        'data-[highlighted]:bg-components-panel-on-panel-item-bg-hover',
        destructive && 'text-text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return (
    <Menu.Separator
      className={cn('my-1 h-px bg-divider-regular', className)}
      {...props}
    />
  )
}
