'use client'

import type * as React from 'react'
import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { Menu } from '@base-ui/react/menu'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
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

type DropdownMenuRadioItemProps<Value = unknown> = Omit<Menu.RadioItem.Props, 'value'> & {
  value: Value
}

function DropdownMenuRadioItem<Value = unknown>({
  className,
  ...props
}: DropdownMenuRadioItemProps<Value>) {
  return (
    <Menu.RadioItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

function DropdownMenuRadioItemIndicator({
  className,
  ...props
}: DropdownMenuRadioItemIndicatorProps) {
  return (
    <Menu.RadioItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.RadioItemIndicator>
  )
}

type DropdownMenuRadioItemIndicatorProps = Omit<Menu.RadioItemIndicator.Props, 'children'>

type DropdownMenuCheckboxItemProps = Menu.CheckboxItem.Props

function DropdownMenuCheckboxItem({ className, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <Menu.CheckboxItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItemIndicator({
  className,
  ...props
}: DropdownMenuCheckboxItemIndicatorProps) {
  return (
    <Menu.CheckboxItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </Menu.CheckboxItemIndicator>
  )
}

type DropdownMenuCheckboxItemIndicatorProps = Omit<Menu.CheckboxItemIndicator.Props, 'children'>

type DropdownMenuLabelProps = Menu.GroupLabel.Props

function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return (
    <Menu.GroupLabel
      className={(state) => cn(floatingGroupLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type DropdownMenuPositionerProps = Omit<Menu.Positioner.Props, 'side' | 'align'> & {
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
      className={(state) => cn('z-50 outline-hidden', resolveClassName(className, state))}
      {...props}
    />
  )
}

type DropdownMenuPopupProps = Menu.Popup.Props

function DropdownMenuPopup({ className, ...props }: DropdownMenuPopupProps) {
  return (
    <Menu.Popup
      className={(state) =>
        cn(
          menuPopupBaseClassName,
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type DropdownMenuContentProps = Omit<DropdownMenuPopupProps, 'children'> &
  Pick<DropdownMenuPositionerProps, 'alignOffset' | 'placement' | 'sideOffset'> & {
    children: React.ReactNode
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
        <DropdownMenuPopup
          className={(state) => cn(menuPopupSurfaceClassName, resolveClassName(className, state))}
          {...props}
        >
          {children}
        </DropdownMenuPopup>
      </DropdownMenuPositioner>
    </DropdownMenuPortal>
  )
}

type DropdownMenuSubTriggerProps = Menu.SubmenuTrigger.Props & {
  variant?: DropdownMenuItemVariant
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
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
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

type DropdownMenuItemProps = Menu.Item.Props & {
  variant?: DropdownMenuItemVariant
}

function DropdownMenuItem({ className, variant = 'default', ...props }: DropdownMenuItemProps) {
  return (
    <Menu.Item
      data-variant={variant}
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type DropdownMenuLinkItemProps = Menu.LinkItem.Props & {
  variant?: DropdownMenuItemVariant
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
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

type DropdownMenuSeparatorProps = Menu.Separator.Props

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <Menu.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
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
