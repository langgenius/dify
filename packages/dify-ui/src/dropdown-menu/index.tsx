'use client'

import type { ReactNode } from 'react'
import type { OverlayItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { Menu } from '@base-ui/react/menu'
import { cn } from '../cn'
import {
  overlayDestructiveClassName,
  overlayIndicatorClassName,
  overlayLabelClassName,
  overlayPopupAnimationClassName,
  overlayPopupBaseClassName,
  overlayRowClassName,
  overlaySeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

export type { Placement }

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuRadioGroup = Menu.RadioGroup

export function DropdownMenuRadioItem({
  className,
  ...props
}: Menu.RadioItem.Props) {
  return (
    <Menu.RadioItem
      className={cn(overlayRowClassName, className)}
      {...props}
    />
  )
}

export function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: Omit<Menu.RadioItemIndicator.Props, 'children'>) {
  return (
    <Menu.RadioItemIndicator
      className={cn(overlayIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.RadioItemIndicator>
  )
}

export function DropdownMenuCheckboxItem({
  className,
  ...props
}: Menu.CheckboxItem.Props) {
  return (
    <Menu.CheckboxItem
      className={cn(overlayRowClassName, className)}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<Menu.CheckboxItemIndicator.Props, 'children'>) {
  return (
    <Menu.CheckboxItemIndicator
      className={cn(overlayIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.CheckboxItemIndicator>
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: Menu.GroupLabel.Props) {
  return (
    <Menu.GroupLabel
      className={cn(overlayLabelClassName, className)}
      {...props}
    />
  )
}

type DropdownMenuContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    Menu.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    Menu.Popup.Props,
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
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <Menu.Popup
          className={cn(
            overlayPopupBaseClassName,
            overlayPopupAnimationClassName,
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

type DropdownMenuSubTriggerProps = Menu.SubmenuTrigger.Props & {
  variant?: OverlayItemVariant
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
      className={cn(overlayRowClassName, overlayDestructiveClassName, className)}
      {...props}
    >
      {children}
      <span aria-hidden className="ml-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" />
    </Menu.SubmenuTrigger>
  )
}

type DropdownMenuSubContentProps = {
  children: ReactNode
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
  variant?: OverlayItemVariant
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: DropdownMenuItemProps) {
  return (
    <Menu.Item
      data-variant={variant}
      className={cn(overlayRowClassName, overlayDestructiveClassName, className)}
      {...props}
    />
  )
}

type DropdownMenuLinkItemProps = Menu.LinkItem.Props & {
  variant?: OverlayItemVariant
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
      className={cn(overlayRowClassName, overlayDestructiveClassName, className)}
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: Menu.Separator.Props) {
  return (
    <Menu.Separator
      className={cn(overlaySeparatorClassName, className)}
      {...props}
    />
  )
}
