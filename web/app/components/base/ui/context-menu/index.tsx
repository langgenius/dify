'use client'

import type { ReactNode } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { cn } from '@langgenius/dify-ui/cn'
import {
  overlayBackdropClassName,
  overlayGroupLabelClassName,
  overlayIndicatorClassName,
  overlayPopupAnimationClassName,
  overlayPopupBaseClassName,
  overlayRowClassName,
  overlaySeparatorClassName,
} from '@/app/components/base/ui/overlay-shared'
import { parsePlacement } from '@/app/components/base/ui/placement'

export const ContextMenu = BaseContextMenu.Root
export const ContextMenuTrigger = BaseContextMenu.Trigger
export const ContextMenuSub = BaseContextMenu.SubmenuRoot
export const ContextMenuGroup = BaseContextMenu.Group
export const ContextMenuRadioGroup = BaseContextMenu.RadioGroup

type ContextMenuContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BaseContextMenu.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BaseContextMenu.Popup.Props,
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
        <BaseContextMenu.Backdrop className={overlayBackdropClassName} />
      )}
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-1002 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseContextMenu.Popup
          className={cn(
            overlayPopupBaseClassName,
            overlayPopupAnimationClassName,
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

type ContextMenuItemProps = BaseContextMenu.Item.Props & {
  destructive?: boolean
}

export function ContextMenuItem({
  className,
  destructive,
  ...props
}: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      className={cn(overlayRowClassName, destructive && 'text-text-destructive', className)}
      {...props}
    />
  )
}

type ContextMenuLinkItemProps = BaseContextMenu.LinkItem.Props & {
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
      className={cn(overlayRowClassName, destructive && 'text-text-destructive', className)}
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

export function ContextMenuRadioItem({
  className,
  ...props
}: BaseContextMenu.RadioItem.Props) {
  return (
    <BaseContextMenu.RadioItem
      className={cn(overlayRowClassName, className)}
      {...props}
    />
  )
}

export function ContextMenuCheckboxItem({
  className,
  ...props
}: BaseContextMenu.CheckboxItem.Props) {
  return (
    <BaseContextMenu.CheckboxItem
      className={cn(overlayRowClassName, className)}
      {...props}
    />
  )
}

export function ContextMenuCheckboxItemIndicator({
  className,
  ...props
}: Omit<BaseContextMenu.CheckboxItemIndicator.Props, 'children'>) {
  return (
    <BaseContextMenu.CheckboxItemIndicator
      className={cn(overlayIndicatorClassName, className)}
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
      className={cn(overlayIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.RadioItemIndicator>
  )
}

type ContextMenuSubTriggerProps = BaseContextMenu.SubmenuTrigger.Props & {
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
      className={cn(overlayRowClassName, destructive && 'text-text-destructive', className)}
      {...props}
    >
      {children}
      <span aria-hidden className="ml-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary" />
    </BaseContextMenu.SubmenuTrigger>
  )
}

type ContextMenuSubContentProps = {
  children: ReactNode
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
}: BaseContextMenu.GroupLabel.Props) {
  return (
    <BaseContextMenu.GroupLabel
      className={cn(overlayGroupLabelClassName, className)}
      {...props}
    />
  )
}

export function ContextMenuSeparator({
  className,
  ...props
}: BaseContextMenu.Separator.Props) {
  return (
    <BaseContextMenu.Separator
      className={cn(overlaySeparatorClassName, className)}
      {...props}
    />
  )
}
