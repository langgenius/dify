'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { Menu } from '@base-ui/react/menu'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const DropdownMenu = Menu.Root
export const DropdownMenuPortal = Menu.Portal
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuRadioGroup = Menu.RadioGroup

const menuRowBaseClassName = 'mx-1 flex h-8 cursor-pointer select-none items-center gap-1 rounded-lg px-2 outline-none'
const menuRowStateClassName = 'data-[highlighted]:bg-state-base-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-30'

export function DropdownMenuRadioItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      className={cn(
        menuRowBaseClassName,
        menuRowStateClassName,
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof Menu.RadioItemIndicator>, 'children'>) {
  return (
    <Menu.RadioItemIndicator
      className={cn(
        'ml-auto flex shrink-0 items-center text-text-accent',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.RadioItemIndicator>
  )
}

export function DropdownMenuCheckboxItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem
      className={cn(
        menuRowBaseClassName,
        menuRowStateClassName,
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof Menu.CheckboxItemIndicator>, 'children'>) {
  return (
    <Menu.CheckboxItemIndicator
      className={cn(
        'ml-auto flex shrink-0 items-center text-text-accent',
        className,
      )}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.CheckboxItemIndicator>
  )
}

export function DropdownMenuGroupLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.GroupLabel>) {
  return (
    <Menu.GroupLabel
      className={cn(
        'px-3 pb-0.5 pt-1 text-text-tertiary system-xs-medium-uppercase',
        className,
      )}
      {...props}
    />
  )
}

type DropdownMenuContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    React.ComponentPropsWithoutRef<typeof Menu.Positioner>,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    React.ComponentPropsWithoutRef<typeof Menu.Popup>,
    'children' | 'className'
  >
}

type DropdownMenuPopupRenderProps = Required<Pick<DropdownMenuContentProps, 'children'>> & {
  placement: Placement
  sideOffset: number
  alignOffset: number
  className?: string
  popupClassName?: string
  positionerProps?: DropdownMenuContentProps['positionerProps']
  popupProps?: DropdownMenuContentProps['popupProps']
}

function renderDropdownMenuPopup({
  children,
  placement,
  sideOffset,
  alignOffset,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: DropdownMenuPopupRenderProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-none', className)}
        {...positionerProps}
      >
        <Menu.Popup
          className={cn(
            'max-h-[var(--available-height)] overflow-y-auto overflow-x-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-1 text-sm text-text-secondary shadow-lg backdrop-blur-[5px]',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
            popupClassName,
          )}
          {...popupProps}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function DropdownMenuContent({
  children,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: DropdownMenuContentProps) {
  return renderDropdownMenuPopup({
    children,
    placement,
    sideOffset,
    alignOffset,
    className,
    popupClassName,
    positionerProps,
    popupProps,
  })
}

type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof Menu.SubmenuTrigger> & {
  destructive?: boolean
}

export function DropdownMenuSubTrigger({
  className,
  destructive,
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <Menu.SubmenuTrigger
      className={cn(
        menuRowBaseClassName,
        menuRowStateClassName,
        destructive && 'text-text-destructive',
        className,
      )}
      {...props}
    >
      {children}
      <span aria-hidden className="i-ri-arrow-right-s-line ml-auto size-4 shrink-0 text-text-tertiary" />
    </Menu.SubmenuTrigger>
  )
}

type DropdownMenuSubContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: DropdownMenuContentProps['positionerProps']
  popupProps?: DropdownMenuContentProps['popupProps']
}

export function DropdownMenuSubContent({
  children,
  placement = 'left-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: DropdownMenuSubContentProps) {
  return renderDropdownMenuPopup({
    children,
    placement,
    sideOffset,
    alignOffset,
    className,
    popupClassName,
    positionerProps,
    popupProps,
  })
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
        menuRowBaseClassName,
        menuRowStateClassName,
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
      className={cn('my-1 h-px bg-divider-subtle', className)}
      {...props}
    />
  )
}
