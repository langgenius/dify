'use client'

import type * as React from 'react'
import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
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

export const ContextMenu = BaseContextMenu.Root
export const ContextMenuTrigger = BaseContextMenu.Trigger
export const ContextMenuSub = BaseContextMenu.SubmenuRoot
export const ContextMenuGroup = BaseContextMenu.Group
export const ContextMenuRadioGroup = BaseContextMenu.RadioGroup
export type ContextMenuActions = BaseContextMenu.Root.Actions
// Intentionally no public Backdrop export; Base UI handles context-menu modal dismissal internally.

type ContextMenuContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BaseContextMenu.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<BaseContextMenu.Popup.Props, 'children' | 'className'>
}

type ContextMenuPopupRenderProps = Required<Pick<ContextMenuContentProps, 'children'>> & {
  placement: Placement
  sideOffset: number
  alignOffset: number
  className?: string
  popupClassName?: string
  positionerProps?: ContextMenuContentProps['positionerProps']
  popupProps?: ContextMenuContentProps['popupProps']
}

function renderContextMenuPopup({
  children,
  placement,
  sideOffset,
  alignOffset,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: ContextMenuPopupRenderProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseContextMenu.Popup
          className={cn(menuPopupClassName, floatingPopupAnimationClassName, popupClassName)}
          {...popupProps}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

export function ContextMenuContent({
  children,
  placement = 'bottom-start',
  sideOffset = 0,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: ContextMenuContentProps) {
  return renderContextMenuPopup({
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

type ContextMenuItemProps = BaseContextMenu.Item.Props & {
  variant?: MenuItemVariant
}

export function ContextMenuItem({
  className,
  variant = 'default',
  ...props
}: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    />
  )
}

type ContextMenuLinkItemProps = BaseContextMenu.LinkItem.Props & {
  variant?: MenuItemVariant
}

export function ContextMenuLinkItem({
  className,
  variant = 'default',
  closeOnClick = true,
  ...props
}: ContextMenuLinkItemProps) {
  return (
    <BaseContextMenu.LinkItem
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

export function ContextMenuRadioItem({ className, ...props }: BaseContextMenu.RadioItem.Props) {
  return <BaseContextMenu.RadioItem className={cn(menuItemClassName, className)} {...props} />
}

export function ContextMenuCheckboxItem({
  className,
  ...props
}: BaseContextMenu.CheckboxItem.Props) {
  return <BaseContextMenu.CheckboxItem className={cn(menuItemClassName, className)} {...props} />
}

export function ContextMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<BaseContextMenu.CheckboxItemIndicator.Props, 'children'>) {
  return (
    <BaseContextMenu.CheckboxItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.CheckboxItemIndicator>
  )
}

export function ContextMenuRadioItemIndicator({
  className,
  ...props
}: Omit<BaseContextMenu.RadioItemIndicator.Props, 'children'>) {
  return (
    <BaseContextMenu.RadioItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.RadioItemIndicator>
  )
}

type ContextMenuSubTriggerProps = BaseContextMenu.SubmenuTrigger.Props & {
  variant?: MenuItemVariant
}

export function ContextMenuSubTrigger({
  className,
  variant = 'default',
  children,
  ...props
}: ContextMenuSubTriggerProps) {
  return (
    <BaseContextMenu.SubmenuTrigger
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="ms-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary"
      />
    </BaseContextMenu.SubmenuTrigger>
  )
}

type ContextMenuSubContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: ContextMenuContentProps['positionerProps']
  popupProps?: ContextMenuContentProps['popupProps']
}

export function ContextMenuSubContent({
  children,
  placement = 'right-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: ContextMenuSubContentProps) {
  return renderContextMenuPopup({
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

export function ContextMenuLabel({ className, ...props }: BaseContextMenu.GroupLabel.Props) {
  return (
    <BaseContextMenu.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
  )
}

export function ContextMenuSeparator({ className, ...props }: BaseContextMenu.Separator.Props) {
  return (
    <BaseContextMenu.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
  )
}
