'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import * as React from 'react'
import {
  menuBackdropClassName,
  menuGroupLabelClassName,
  menuIndicatorClassName,
  menuPopupAnimationClassName,
  menuPopupBaseClassName,
  menuRowClassName,
  menuSeparatorClassName,
} from '@/app/components/base/ui/menu-shared'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const ContextMenu = BaseContextMenu.Root
export const ContextMenuTrigger = BaseContextMenu.Trigger
export const ContextMenuPortal = BaseContextMenu.Portal
export const ContextMenuBackdrop = BaseContextMenu.Backdrop
export const ContextMenuSub = BaseContextMenu.SubmenuRoot
export const ContextMenuGroup = BaseContextMenu.Group
export const ContextMenuRadioGroup = BaseContextMenu.RadioGroup

type ContextMenuContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseContextMenu.Positioner>,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseContextMenu.Popup>,
    'children' | 'className'
  >
}

type ContextMenuPopupRenderProps = Required<Pick<ContextMenuContentProps, 'children'>> & {
  placement: Placement
  sideOffset: number
  alignOffset: number
  className?: string
  popupClassName?: string
  positionerProps?: ContextMenuContentProps['positionerProps']
  popupProps?: ContextMenuContentProps['popupProps']
  withBackdrop?: boolean
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
  withBackdrop = false,
}: ContextMenuPopupRenderProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseContextMenu.Portal>
      {withBackdrop && (
        <BaseContextMenu.Backdrop className={menuBackdropClassName} />
      )}
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-[1002] outline-none', className)}
        {...positionerProps}
      >
        <BaseContextMenu.Popup
          className={cn(
            menuPopupBaseClassName,
            menuPopupAnimationClassName,
            popupClassName,
          )}
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
    withBackdrop: true,
  })
}

type ContextMenuItemProps = React.ComponentPropsWithoutRef<typeof BaseContextMenu.Item> & {
  destructive?: boolean
}

export function ContextMenuItem({
  className,
  destructive,
  ...props
}: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
      {...props}
    />
  )
}

type ContextMenuLinkItemProps = React.ComponentPropsWithoutRef<typeof BaseContextMenu.LinkItem> & {
  destructive?: boolean
}

export function ContextMenuLinkItem({
  className,
  destructive,
  closeOnClick = true,
  ...props
}: ContextMenuLinkItemProps) {
  return (
    <BaseContextMenu.LinkItem
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

export function ContextMenuRadioItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseContextMenu.RadioItem>) {
  return (
    <BaseContextMenu.RadioItem
      className={cn(menuRowClassName, className)}
      {...props}
    />
  )
}

export function ContextMenuCheckboxItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseContextMenu.CheckboxItem>) {
  return (
    <BaseContextMenu.CheckboxItem
      className={cn(menuRowClassName, className)}
      {...props}
    />
  )
}

type ContextMenuIndicatorProps = Omit<React.ComponentPropsWithoutRef<'span'>, 'children'> & {
  children?: React.ReactNode
}

export function ContextMenuItemIndicator({
  className,
  children,
  ...props
}: ContextMenuIndicatorProps) {
  return (
    <span
      aria-hidden
      className={cn(menuIndicatorClassName, className)}
      {...props}
    >
      {children ?? <span aria-hidden className="i-ri-check-line h-4 w-4" />}
    </span>
  )
}

export function ContextMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof BaseContextMenu.CheckboxItemIndicator>, 'children'>) {
  return (
    <BaseContextMenu.CheckboxItemIndicator
      className={cn(menuIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.CheckboxItemIndicator>
  )
}

export function ContextMenuRadioItemIndicator({
  className,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof BaseContextMenu.RadioItemIndicator>, 'children'>) {
  return (
    <BaseContextMenu.RadioItemIndicator
      className={cn(menuIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.RadioItemIndicator>
  )
}

type ContextMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof BaseContextMenu.SubmenuTrigger> & {
  destructive?: boolean
}

export function ContextMenuSubTrigger({
  className,
  destructive,
  children,
  ...props
}: ContextMenuSubTriggerProps) {
  return (
    <BaseContextMenu.SubmenuTrigger
      className={cn(menuRowClassName, destructive && 'text-text-destructive', className)}
      {...props}
    >
      {children}
      <span aria-hidden className="i-ri-arrow-right-s-line ml-auto size-4 shrink-0 text-text-tertiary" />
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

export function ContextMenuGroupLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseContextMenu.GroupLabel>) {
  return (
    <BaseContextMenu.GroupLabel
      className={cn(menuGroupLabelClassName, className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseContextMenu.Separator>) {
  return (
    <BaseContextMenu.Separator
      className={cn(menuSeparatorClassName, className)}
      {...props}
    />
  )
}
