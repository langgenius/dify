'use client'

import type * as React from 'react'
import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { Menu } from '@base-ui/react/menu'
import { cn } from '../cn'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
  menuItemClassName,
  menuItemDestructiveClassName,
  menuPopupClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

export type { Placement }

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuRadioItem({ className, ...props }: Menu.RadioItem.Props) {
  return <Menu.RadioItem className={cn(menuItemClassName, className)} {...props} />
}

export function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: Omit<Menu.RadioItemIndicator.Props, 'children'>) {
  return (
    <Menu.RadioItemIndicator className={cn(floatingItemIndicatorClassName, className)} {...props}>
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.RadioItemIndicator>
  )
}

export function DropdownMenuCheckboxItem({ className, ...props }: Menu.CheckboxItem.Props) {
  return <Menu.CheckboxItem className={cn(menuItemClassName, className)} {...props} />
}

export function DropdownMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<Menu.CheckboxItemIndicator.Props, 'children'>) {
  return (
    <Menu.CheckboxItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.CheckboxItemIndicator>
  )
}

export function DropdownMenuLabel({ className, ...props }: Menu.GroupLabel.Props) {
  return <Menu.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
}

type DropdownMenuContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    Menu.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<Menu.Popup.Props, 'children' | 'className'>
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
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <Menu.Popup
          className={cn(menuPopupClassName, floatingPopupAnimationClassName, popupClassName)}
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

type DropdownMenuSubTriggerProps = Menu.SubmenuTrigger.Props & {
  variant?: MenuItemVariant
}

export function DropdownMenuSubTrigger({
  className,
  variant = 'default',
  children,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <Menu.SubmenuTrigger
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="ms-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary"
      />
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

type DropdownMenuItemProps = Menu.Item.Props & {
  variant?: MenuItemVariant
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    />
  )
}

type DropdownMenuLinkItemProps = Menu.LinkItem.Props & {
  variant?: MenuItemVariant
}

export function DropdownMenuLinkItem({
  className,
  variant = 'default',
  closeOnClick = true,
  ...props
}: DropdownMenuLinkItemProps) {
  return (
    <Menu.LinkItem
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return <Menu.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
}
