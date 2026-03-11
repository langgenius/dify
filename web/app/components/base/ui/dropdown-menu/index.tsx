'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { Menu } from '@base-ui/react/menu'
import * as React from 'react'
import {
  menuGroupLabelClassName,
  menuIndicatorClassName,
  menuPopupAnimationClassName,
  menuPopupBaseClassName,
  menuRowClassName,
  menuSeparatorClassName,
} from '@/app/components/base/ui/menu-shared'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const DropdownMenu = Menu.Root
export const DropdownMenuPortal = Menu.Portal
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuRadioItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      className={cn(menuRowClassName, className)}
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
      className={cn(menuIndicatorClassName, className)}
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
      className={cn(menuRowClassName, className)}
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
      className={cn(menuIndicatorClassName, className)}
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
      className={cn(menuGroupLabelClassName, className)}
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
        className={cn('z-[1002] outline-none', className)}
        {...positionerProps}
      >
        <Menu.Popup
          className={cn(
            menuPopupBaseClassName,
            menuPopupAnimationClassName,
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
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
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
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
      {...props}
    />
  )
}

type DropdownMenuLinkItemProps = React.ComponentPropsWithoutRef<typeof Menu.LinkItem> & {
  destructive?: boolean
}

export function DropdownMenuLinkItem({
  className,
  destructive,
  closeOnClick = true,
  ...props
}: DropdownMenuLinkItemProps) {
  return (
    <Menu.LinkItem
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
      closeOnClick={closeOnClick}
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
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}
