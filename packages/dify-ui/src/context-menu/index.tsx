'use client'

import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import * as React from 'react'
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

const ContextMenu = BaseContextMenu.Root
const ContextMenuTrigger = BaseContextMenu.Trigger
const ContextMenuSub = BaseContextMenu.SubmenuRoot
const ContextMenuGroup = BaseContextMenu.Group
type ContextMenuProps = BaseContextMenu.Root.Props
type ContextMenuActions = BaseContextMenu.Root.Actions
type ContextMenuTriggerProps = BaseContextMenu.Trigger.Props
type ContextMenuSubProps = BaseContextMenu.SubmenuRoot.Props
type ContextMenuGroupProps = BaseContextMenu.Group.Props
type ContextMenuRadioGroupProps<Value = unknown> = Omit<
  BaseContextMenu.RadioGroup.Props,
  'defaultValue' | 'onValueChange' | 'value'
> & {
  defaultValue?: Value
  onValueChange?: (
    value: Value,
    eventDetails: BaseContextMenu.RadioGroup.ChangeEventDetails,
  ) => void
  value?: Value
}
type ContextMenuItemVariant = MenuItemVariant
// Intentionally no public Backdrop export; Base UI handles context-menu modal dismissal internally.

function ContextMenuRadioGroup<Value = unknown>(
  props: ContextMenuRadioGroupProps<Value>,
): React.JSX.Element {
  return <BaseContextMenu.RadioGroup {...props} />
}

type ContextMenuContentProps = Omit<BaseContextMenu.Popup.Props, 'children' | 'className'> &
  Pick<BaseContextMenu.Positioner.Props, 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
    placement?: Placement
    className?: string
  }

function ContextMenuContent({
  children,
  placement = 'bottom-start',
  sideOffset = 0,
  alignOffset = 0,
  className,
  ...props
}: ContextMenuContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-hidden"
      >
        <BaseContextMenu.Popup
          className={cn(menuPopupClassName, floatingPopupAnimationClassName, className)}
          {...props}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

type ContextMenuItemProps = Omit<BaseContextMenu.Item.Props, 'className'> & {
  variant?: ContextMenuItemVariant
  className?: string
}

function ContextMenuItem({ className, variant = 'default', ...props }: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    />
  )
}

type ContextMenuLinkItemProps = Omit<BaseContextMenu.LinkItem.Props, 'className'> & {
  variant?: ContextMenuItemVariant
  className?: string
}

function ContextMenuLinkItem({
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

type ContextMenuRadioItemProps<Value = unknown> = Omit<
  BaseContextMenu.RadioItem.Props,
  'className' | 'value'
> & {
  className?: string
  value: Value
}

function ContextMenuRadioItem<Value = unknown>({
  className,
  ...props
}: ContextMenuRadioItemProps<Value>) {
  return <BaseContextMenu.RadioItem className={cn(menuItemClassName, className)} {...props} />
}

function ContextMenuCheckboxItem({ className, ...props }: ContextMenuCheckboxItemProps) {
  return <BaseContextMenu.CheckboxItem className={cn(menuItemClassName, className)} {...props} />
}

type ContextMenuCheckboxItemProps = Omit<BaseContextMenu.CheckboxItem.Props, 'className'> & {
  className?: string
}

function ContextMenuCheckboxItemIndicator({
  className,
  ...props
}: ContextMenuCheckboxItemIndicatorProps) {
  return (
    <BaseContextMenu.CheckboxItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.CheckboxItemIndicator>
  )
}

type ContextMenuCheckboxItemIndicatorProps = Omit<
  BaseContextMenu.CheckboxItemIndicator.Props,
  'children' | 'className'
> & { className?: string }

function ContextMenuRadioItemIndicator({
  className,
  ...props
}: ContextMenuRadioItemIndicatorProps) {
  return (
    <BaseContextMenu.RadioItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.RadioItemIndicator>
  )
}

type ContextMenuRadioItemIndicatorProps = Omit<
  BaseContextMenu.RadioItemIndicator.Props,
  'children' | 'className'
> & { className?: string }

type ContextMenuSubTriggerProps = Omit<BaseContextMenu.SubmenuTrigger.Props, 'className'> & {
  variant?: ContextMenuItemVariant
  className?: string
}

function ContextMenuSubTrigger({
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

type ContextMenuSubContentProps = ContextMenuContentProps

function ContextMenuSubContent({
  children,
  placement = 'right-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: ContextMenuSubContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-50 outline-hidden"
      >
        <BaseContextMenu.Popup
          className={cn(menuPopupClassName, floatingPopupAnimationClassName, className)}
          {...props}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

type ContextMenuLabelProps = Omit<BaseContextMenu.GroupLabel.Props, 'className'> & {
  className?: string
}

function ContextMenuLabel({ className, ...props }: ContextMenuLabelProps) {
  return (
    <BaseContextMenu.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
  )
}

type ContextMenuSeparatorProps = Omit<BaseContextMenu.Separator.Props, 'className'> & {
  className?: string
}

function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return (
    <BaseContextMenu.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
  )
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuCheckboxItemIndicator,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuLinkItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuRadioItemIndicator,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
}

export type {
  ContextMenuActions,
  ContextMenuCheckboxItemIndicatorProps,
  ContextMenuCheckboxItemProps,
  ContextMenuContentProps,
  ContextMenuGroupProps,
  ContextMenuItemProps,
  ContextMenuLabelProps,
  ContextMenuLinkItemProps,
  ContextMenuProps,
  ContextMenuRadioGroupProps,
  ContextMenuRadioItemIndicatorProps,
  ContextMenuRadioItemProps,
  ContextMenuSeparatorProps,
  ContextMenuSubContentProps,
  ContextMenuSubProps,
  ContextMenuSubTriggerProps,
  ContextMenuTriggerProps,
}
