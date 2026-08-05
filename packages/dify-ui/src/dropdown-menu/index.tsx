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

const DropdownMenu = Menu.Root
const DropdownMenuTrigger = Menu.Trigger
const DropdownMenuSub = Menu.SubmenuRoot
const DropdownMenuGroup = Menu.Group

type DropdownMenuProps<Payload = unknown> = Menu.Root.Props<Payload>
type DropdownMenuTriggerProps<Payload = unknown> = Menu.Trigger.Props<Payload>
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

function DropdownMenuContent({
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

function DropdownMenuSubContent({
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
  DropdownMenuProps,
  DropdownMenuRadioGroupProps,
  DropdownMenuRadioItemIndicatorProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSeparatorProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
  DropdownMenuTriggerProps,
  Placement,
}
