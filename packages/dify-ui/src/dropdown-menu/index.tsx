'use client'

import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { Menu } from '@base-ui/react/menu'
import * as React from 'react'
import { cn } from '../cn'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
  menuItemClassName,
  menuItemDestructiveClassName,
  menuPopupBaseClassName,
  menuPopupSurfaceClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

const DropdownMenu = Menu.Root
const DropdownMenuPortal = Menu.Portal
const DropdownMenuTrigger = Menu.Trigger
const DropdownMenuSub = Menu.SubmenuRoot
const DropdownMenuGroup = Menu.Group

type DropdownMenuProps<Payload = unknown> = Menu.Root.Props<Payload>
type DropdownMenuTriggerProps<Payload = unknown> = Menu.Trigger.Props<Payload>
type DropdownMenuPortalProps = Menu.Portal.Props
type DropdownMenuSubProps = Menu.SubmenuRoot.Props
type DropdownMenuGroupProps = Menu.Group.Props
type DropdownMenuRadioGroupProps<Value = unknown> = Omit<
  Menu.RadioGroup.Props,
  'defaultValue' | 'onValueChange' | 'value'
> & {
  defaultValue?: Value
  onValueChange?: (value: Value, eventDetails: Menu.RadioGroup.ChangeEventDetails) => void
  value?: Value
}
type DropdownMenuItemVariant = MenuItemVariant

function DropdownMenuRadioGroup<Value = unknown>(
  props: DropdownMenuRadioGroupProps<Value>,
): React.JSX.Element {
  return <Menu.RadioGroup {...props} />
}

type DropdownMenuRadioItemProps<Value = unknown> = Omit<
  Menu.RadioItem.Props,
  'className' | 'value'
> & {
  className?: string
  value: Value
}

function DropdownMenuRadioItem<Value = unknown>({
  className,
  ...props
}: DropdownMenuRadioItemProps<Value>) {
  return <Menu.RadioItem className={cn(menuItemClassName, className)} {...props} />
}

function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: DropdownMenuRadioItemIndicatorProps) {
  return (
    <Menu.RadioItemIndicator className={cn(floatingItemIndicatorClassName, className)} {...props}>
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.RadioItemIndicator>
  )
}

type DropdownMenuRadioItemIndicatorProps = Omit<
  Menu.RadioItemIndicator.Props,
  'children' | 'className'
> & { className?: string }

type DropdownMenuCheckboxItemProps = Omit<Menu.CheckboxItem.Props, 'className'> & {
  className?: string
}

function DropdownMenuCheckboxItem({ className, ...props }: DropdownMenuCheckboxItemProps) {
  return <Menu.CheckboxItem className={cn(menuItemClassName, className)} {...props} />
}

function DropdownMenuCheckboxItemIndicator({
  className,
  ...props
}: DropdownMenuCheckboxItemIndicatorProps) {
  return (
    <Menu.CheckboxItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.CheckboxItemIndicator>
  )
}

type DropdownMenuCheckboxItemIndicatorProps = Omit<
  Menu.CheckboxItemIndicator.Props,
  'children' | 'className'
> & { className?: string }

type DropdownMenuLabelProps = Omit<Menu.GroupLabel.Props, 'className'> & {
  className?: string
}

function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return <Menu.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
}

type DropdownMenuPositionerProps = Omit<Menu.Positioner.Props, 'className' | 'side' | 'align'> & {
  className?: string
  placement?: Placement
}

function DropdownMenuPositioner({
  className,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  ...props
}: DropdownMenuPositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <Menu.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={cn('z-50 outline-hidden', className)}
      {...props}
    />
  )
}

type DropdownMenuPopupProps = Omit<Menu.Popup.Props, 'className'> & {
  className?: string
}

function DropdownMenuPopup({ className, ...props }: DropdownMenuPopupProps) {
  return (
    <Menu.Popup
      className={cn(menuPopupBaseClassName, floatingPopupAnimationClassName, className)}
      {...props}
    />
  )
}

type DropdownMenuContentProps = Omit<DropdownMenuPopupProps, 'children' | 'className'> &
  Pick<DropdownMenuPositionerProps, 'alignOffset' | 'placement' | 'sideOffset'> & {
    children: React.ReactNode
    className?: string
  }

function DropdownMenuContent({
  children,
  placement = 'bottom-end',
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPositioner
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <DropdownMenuPopup className={cn(menuPopupSurfaceClassName, className)} {...props}>
          {children}
        </DropdownMenuPopup>
      </DropdownMenuPositioner>
    </DropdownMenuPortal>
  )
}

type DropdownMenuSubTriggerProps = Omit<Menu.SubmenuTrigger.Props, 'className'> & {
  variant?: DropdownMenuItemVariant
  className?: string
}

function DropdownMenuSubTrigger({
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

type DropdownMenuSubContentProps = DropdownMenuContentProps

function DropdownMenuSubContent({
  children,
  placement = 'left-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuPortal>
      <DropdownMenuPositioner
        placement={placement}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <DropdownMenuPopup className={cn(menuPopupSurfaceClassName, className)} {...props}>
          {children}
        </DropdownMenuPopup>
      </DropdownMenuPositioner>
    </DropdownMenuPortal>
  )
}

type DropdownMenuItemProps = Omit<Menu.Item.Props, 'className'> & {
  variant?: DropdownMenuItemVariant
  className?: string
}

function DropdownMenuItem({ className, variant = 'default', ...props }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      data-variant={variant}
      className={cn(menuItemClassName, menuItemDestructiveClassName, className)}
      {...props}
    />
  )
}

type DropdownMenuLinkItemProps = Omit<Menu.LinkItem.Props, 'className'> & {
  variant?: DropdownMenuItemVariant
  className?: string
}

function DropdownMenuLinkItem({
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

type DropdownMenuSeparatorProps = Omit<Menu.Separator.Props, 'className'> & {
  className?: string
}

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return <Menu.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioItemIndicator,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}

export type {
  DropdownMenuCheckboxItemIndicatorProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuContentProps,
  DropdownMenuGroupProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuLinkItemProps,
  DropdownMenuPopupProps,
  DropdownMenuPortalProps,
  DropdownMenuPositionerProps,
  DropdownMenuProps,
  DropdownMenuRadioGroupProps,
  DropdownMenuRadioItemIndicatorProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSeparatorProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
  DropdownMenuTriggerProps,
}
