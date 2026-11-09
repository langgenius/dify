'use client'

import type * as React from 'react'
import type { InputGroupProps } from '../input-group'
import type { MenuItemVariant as SharedMenuItemVariant } from '../internal/menu'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { cn } from '../cn'
import { InputGroup } from '../input-group'
import { focusRingClassName } from '../internal/focus'
import { textControlGroupInputClassName } from '../internal/form-control'
import {
  menuItemClassName,
  menuItemDestructiveClassName,
  menuPopupBaseClassName,
  menuPopupSurfaceClassName,
} from '../internal/menu'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
  positionerClassName,
} from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const Menu = BaseMenu.Root
const MenuPortal = BaseMenu.Portal
const MenuSubmenu = BaseMenu.SubmenuRoot
const MenuGroup = BaseMenu.Group
const createMenuHandle = BaseMenu.createHandle

// A filterable menu hosts its input in `MenuInputGroup` and its items in `MenuList`,
// so the list owns the `menu` role and the scrolling while the popup keeps its padding.
const MenuFilterProvider = BaseMenu.FilterProvider
const useMenuFilter = BaseMenu.useFilter

type MenuHandle<Payload = unknown> = BaseMenu.Handle<Payload>

type MenuActions = BaseMenu.Root.Actions
type MenuChangeEventReason = BaseMenu.Root.ChangeEventReason
type MenuChangeEventDetails = BaseMenu.Root.ChangeEventDetails
type MenuHighlightEventReason = BaseMenu.Root.HighlightEventReason
type MenuHighlightEventDetails = BaseMenu.Root.HighlightEventDetails

type MenuProps<Payload = unknown> = BaseMenu.Root.Props<Payload>
type MenuTriggerProps<Payload = unknown> = BaseMenu.Trigger.Props<Payload>

function MenuTrigger<Payload = unknown>({ className, ...props }: MenuTriggerProps<Payload>) {
  return (
    <BaseMenu.Trigger
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
type MenuPortalProps = BaseMenu.Portal.Props
type MenuSubmenuProps = BaseMenu.SubmenuRoot.Props
type MenuSubmenuChangeEventReason = BaseMenu.SubmenuRoot.ChangeEventReason
type MenuSubmenuChangeEventDetails = BaseMenu.SubmenuRoot.ChangeEventDetails
type MenuGroupProps = BaseMenu.Group.Props
type MenuFilterProviderProps = BaseMenu.FilterProvider.Props
type MenuFilterProviderChangeEventReason = BaseMenu.FilterProvider.ChangeEventReason
type MenuFilterProviderChangeEventDetails = BaseMenu.FilterProvider.ChangeEventDetails

type MenuInputGroupProps = InputGroupProps

// A dify-ui composition over `InputGroup` with the menu's input and clear parts; it carries no Base
// UI state attributes. Laid out like the Combobox popup search, with a minimum width because the
// input has no intrinsic width and a menu popup is sized by its items. `InputGroup` owns the focus
// ring; this group withholds it while the focused input lacks Base UI's `data-highlighted`, so the
// ring shows while the input holds the keyboard highlight and gives way to the item highlight once
// the arrow keys move into the list.
function MenuInputGroup({ className, ...props }: MenuInputGroupProps) {
  return (
    <InputGroup
      className={cn(
        'mx-1 mb-1 w-auto min-w-48 gap-0.5 px-2 has-[>input:focus:not([data-highlighted])]:ring-0',
        className,
      )}
      {...props}
    />
  )
}

type MenuInputProps = BaseMenu.Input.Props

// The group's padding and icon surround the input, so it keeps only a narrow inset.
function MenuInput({ className, ...props }: MenuInputProps) {
  return (
    <BaseMenu.Input
      className={(state) =>
        cn(textControlGroupInputClassName, 'px-1', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type MenuClearProps = BaseMenu.Clear.Props

// Base UI shows it only while the input has a value and keeps it out of the accessibility tree and
// the tab order. Same look as `ComboboxClear`; change both together.
function MenuClear({ className, children, ...props }: MenuClearProps) {
  return (
    <BaseMenu.Clear
      className={(state) =>
        cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-components-input-bg-hover hover:text-text-secondary',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </BaseMenu.Clear>
  )
}

type MenuEmptyProps = BaseMenu.Empty.Props

// Same look as `ComboboxEmpty`; change both together.
function MenuEmpty({ className, ...props }: MenuEmptyProps) {
  return (
    <BaseMenu.Empty
      className={(state) =>
        cn('px-3 py-2 system-sm-regular text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type MenuListProps = BaseMenu.List.Props

// The popup keeps its vertical padding and the items keep their inset, so the list adds none.
// Filtering hides a group whose items all match out, so a separator between groups goes at the
// start of the later group and shows only while a visible group precedes it. Every separator
// directly inside a group follows that rule, so separate items with groups, not with a separator
// among them. A separator placed directly in the list is not managed.
function MenuList({ className, ...props }: MenuListProps) {
  return (
    <BaseMenu.List
      className={(state) =>
        cn(
          'max-h-80 min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain outline-hidden',
          '[&>:not([hidden])~[role=group]:not([hidden])>[role=separator]]:block [&>[role=group]>[role=separator]]:hidden',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}
type MenuRadioGroupChangeEventReason = BaseMenu.RadioGroup.ChangeEventReason
type MenuRadioGroupChangeEventDetails = BaseMenu.RadioGroup.ChangeEventDetails
type MenuRadioGroupProps<Value = unknown> = Omit<
  BaseMenu.RadioGroup.Props,
  'defaultValue' | 'onValueChange' | 'value'
> & {
  defaultValue?: Value
  onValueChange?: (value: Value, eventDetails: MenuRadioGroupChangeEventDetails) => void
  value?: Value
}
type MenuItemVariant = SharedMenuItemVariant

function MenuRadioGroup<Value = unknown>(props: MenuRadioGroupProps<Value>): React.JSX.Element {
  return <BaseMenu.RadioGroup {...props} />
}

type MenuRadioItemProps<Value = unknown> = Omit<BaseMenu.RadioItem.Props, 'value'> & {
  value: Value
}

function MenuRadioItem<Value = unknown>({ className, ...props }: MenuRadioItemProps<Value>) {
  return (
    <BaseMenu.RadioItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

function MenuRadioItemIndicator({ className, ...props }: MenuRadioItemIndicatorProps) {
  return (
    <BaseMenu.RadioItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseMenu.RadioItemIndicator>
  )
}

type MenuRadioItemIndicatorProps = Omit<BaseMenu.RadioItemIndicator.Props, 'children'>

type MenuCheckboxItemProps = BaseMenu.CheckboxItem.Props
type MenuCheckboxItemChangeEventReason = BaseMenu.CheckboxItem.ChangeEventReason
type MenuCheckboxItemChangeEventDetails = BaseMenu.CheckboxItem.ChangeEventDetails

function MenuCheckboxItem({ className, ...props }: MenuCheckboxItemProps) {
  return (
    <BaseMenu.CheckboxItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

function MenuCheckboxItemIndicator({ className, ...props }: MenuCheckboxItemIndicatorProps) {
  return (
    <BaseMenu.CheckboxItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseMenu.CheckboxItemIndicator>
  )
}

type MenuCheckboxItemIndicatorProps = Omit<BaseMenu.CheckboxItemIndicator.Props, 'children'>

type MenuGroupLabelProps = BaseMenu.GroupLabel.Props

function MenuGroupLabel({ className, ...props }: MenuGroupLabelProps) {
  return (
    <BaseMenu.GroupLabel
      className={(state) =>
        cn(floatingGroupLabelClassName, 'px-3', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type MenuPositionerProps = BaseMenu.Positioner.Props

function MenuPositioner({ className, ...props }: MenuPositionerProps) {
  return (
    <BaseMenu.Positioner
      className={(state) => cn(positionerClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type MenuPopupProps = BaseMenu.Popup.Props

// When a `MenuList` is rendered, Base UI hands the `menu` role to it and the popup becomes a
// column that never scrolls itself, so the list scrolls and anything else in the popup stays put.
function MenuPopup({ className, ...props }: MenuPopupProps) {
  return (
    <BaseMenu.Popup
      className={(state) =>
        cn(
          menuPopupBaseClassName,
          'not-[[role=menu]]:flex not-[[role=menu]]:flex-col not-[[role=menu]]:overflow-hidden',
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type MenuContentProps = Omit<MenuPopupProps, 'children'> &
  Pick<MenuPositionerProps, 'side' | 'align' | 'alignOffset' | 'sideOffset'> & {
    children: React.ReactNode
  }

function MenuContent({
  children,
  side,
  align,
  sideOffset = 4,
  alignOffset,
  className,
  ...props
}: MenuContentProps) {
  return (
    <MenuPortal>
      <MenuPositioner side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset}>
        <MenuPopup
          className={(state) => cn(menuPopupSurfaceClassName, resolveClassName(className, state))}
          {...props}
        >
          {children}
        </MenuPopup>
      </MenuPositioner>
    </MenuPortal>
  )
}

type MenuSubmenuTriggerProps = BaseMenu.SubmenuTrigger.Props & {
  variant?: MenuItemVariant
}

function MenuSubmenuTrigger({
  className,
  variant = 'default',
  children,
  ...props
}: MenuSubmenuTriggerProps) {
  return (
    <BaseMenu.SubmenuTrigger
      data-variant={variant}
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="ms-auto i-ri-arrow-right-s-line size-4 shrink-0 text-text-tertiary [&:dir(rtl)]:-scale-x-100"
      />
    </BaseMenu.SubmenuTrigger>
  )
}

type MenuItemProps = BaseMenu.Item.Props & {
  variant?: MenuItemVariant
}

function MenuItem({ className, variant = 'default', ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item
      data-variant={variant}
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type MenuLinkItemProps = BaseMenu.LinkItem.Props & {
  variant?: MenuItemVariant
}

function MenuLinkItem({
  className,
  variant = 'default',
  closeOnClick = true,
  ...props
}: MenuLinkItemProps) {
  return (
    <BaseMenu.LinkItem
      data-variant={variant}
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

type MenuSeparatorProps = BaseMenu.Separator.Props

function MenuSeparator({ className, ...props }: MenuSeparatorProps) {
  return (
    <BaseMenu.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

export {
  createMenuHandle,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuClear,
  MenuContent,
  MenuEmpty,
  MenuFilterProvider,
  MenuGroup,
  MenuGroupLabel,
  MenuInput,
  MenuInputGroup,
  MenuItem,
  MenuLinkItem,
  MenuList,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSubmenu,
  MenuSubmenuTrigger,
  MenuTrigger,
  useMenuFilter,
}

export type {
  MenuActions,
  MenuChangeEventDetails,
  MenuChangeEventReason,
  MenuCheckboxItemChangeEventDetails,
  MenuCheckboxItemChangeEventReason,
  MenuCheckboxItemIndicatorProps,
  MenuCheckboxItemProps,
  MenuClearProps,
  MenuContentProps,
  MenuEmptyProps,
  MenuFilterProviderChangeEventDetails,
  MenuFilterProviderChangeEventReason,
  MenuFilterProviderProps,
  MenuGroupLabelProps,
  MenuGroupProps,
  MenuHandle,
  MenuHighlightEventDetails,
  MenuHighlightEventReason,
  MenuInputGroupProps,
  MenuInputProps,
  MenuItemProps,
  MenuLinkItemProps,
  MenuListProps,
  MenuPopupProps,
  MenuPortalProps,
  MenuPositionerProps,
  MenuProps,
  MenuRadioGroupChangeEventDetails,
  MenuRadioGroupChangeEventReason,
  MenuRadioGroupProps,
  MenuRadioItemIndicatorProps,
  MenuRadioItemProps,
  MenuSeparatorProps,
  MenuSubmenuChangeEventDetails,
  MenuSubmenuChangeEventReason,
  MenuSubmenuProps,
  MenuSubmenuTriggerProps,
  MenuTriggerProps,
}
