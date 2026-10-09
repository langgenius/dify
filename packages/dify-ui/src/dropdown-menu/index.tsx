'use client'

import type * as React from 'react'
import type { InputGroupProps } from '../input-group'
import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { Menu } from '@base-ui/react/menu'
import { cn } from '../cn'
import { textControlGroupInputClassName } from '../form-control-shared'
import { InputGroup } from '../input-group'
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
  triggerFocusClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

const DropdownMenu = Menu.Root
const DropdownMenuPortal = Menu.Portal
const DropdownMenuSub = Menu.SubmenuRoot
const DropdownMenuGroup = Menu.Group
const createDropdownMenuHandle = Menu.createHandle

// A filterable menu hosts its input in `DropdownMenuInputGroup` and its items in `DropdownMenuList`,
// so the list owns the `menu` role and the scrolling while the popup keeps its padding.
const DropdownMenuFilterProvider = Menu.FilterProvider
const useDropdownMenuFilter = Menu.useFilter

type DropdownMenuHandle<Payload = unknown> = Menu.Handle<Payload>

type DropdownMenuActions = Menu.Root.Actions

type DropdownMenuProps<Payload = unknown> = Menu.Root.Props<Payload>
type DropdownMenuTriggerProps<Payload = unknown> = Menu.Trigger.Props<Payload>

function DropdownMenuTrigger<Payload = unknown>({
  className,
  ...props
}: DropdownMenuTriggerProps<Payload>) {
  return (
    <Menu.Trigger
      className={(state) => cn(triggerFocusClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
type DropdownMenuPortalProps = Menu.Portal.Props
type DropdownMenuSubProps = Menu.SubmenuRoot.Props
type DropdownMenuGroupProps = Menu.Group.Props
type DropdownMenuFilterProviderProps = Menu.FilterProvider.Props

type DropdownMenuInputGroupProps = InputGroupProps

// A dify-ui composition over `InputGroup` with the menu's input and clear parts; it carries no Base
// UI state attributes. Laid out like the Combobox popup search, with a minimum width because the
// input has no intrinsic width and a menu popup is sized by its items. `InputGroup` owns the focus
// ring; this group withholds it while the focused input lacks Base UI's `data-highlighted`, so the
// ring shows while the input holds the keyboard highlight and gives way to the item highlight once
// the arrow keys move into the list.
function DropdownMenuInputGroup({ className, ...props }: DropdownMenuInputGroupProps) {
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

type DropdownMenuInputProps = Menu.Input.Props

// The group's padding and icon surround the input, so it keeps only a narrow inset.
function DropdownMenuInput({ className, ...props }: DropdownMenuInputProps) {
  return (
    <Menu.Input
      className={(state) =>
        cn(textControlGroupInputClassName, 'px-1', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type DropdownMenuClearProps = Menu.Clear.Props

// Base UI shows it only while the input has a value and keeps it out of the accessibility tree and
// the tab order. Same look as `ComboboxClear`; change both together.
function DropdownMenuClear({ className, children, ...props }: DropdownMenuClearProps) {
  return (
    <Menu.Clear
      className={(state) =>
        cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-components-input-bg-hover hover:text-text-secondary',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </Menu.Clear>
  )
}

type DropdownMenuEmptyProps = Menu.Empty.Props

// Same look as `ComboboxEmpty`; change both together.
function DropdownMenuEmpty({ className, ...props }: DropdownMenuEmptyProps) {
  return (
    <Menu.Empty
      className={(state) =>
        cn('px-3 py-2 system-sm-regular text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type DropdownMenuListProps = Menu.List.Props

// The popup keeps its vertical padding and the items keep their inset, so the list adds none.
// Filtering hides a group whose items all match out, so a separator between groups goes at the
// start of the later group and shows only while a visible group precedes it. Every separator
// directly inside a group follows that rule, so separate items with groups, not with a separator
// among them. A separator placed directly in the list is not managed.
function DropdownMenuList({ className, ...props }: DropdownMenuListProps) {
  return (
    <Menu.List
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

type DropdownMenuGroupLabelProps = Menu.GroupLabel.Props

function DropdownMenuGroupLabel({ className, ...props }: DropdownMenuGroupLabelProps) {
  return (
    <Menu.GroupLabel
      className={(state) => cn(floatingGroupLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type DropdownMenuPositionerProps = Omit<Menu.Positioner.Props, 'side' | 'align'> & {
  placement: Placement
}

function DropdownMenuPositioner({
  className,
  placement,
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

// When a `DropdownMenuList` is rendered, Base UI hands the `menu` role to it and the popup becomes a
// column that never scrolls itself, so the list scrolls and anything else in the popup stays put.
function DropdownMenuPopup({ className, ...props }: DropdownMenuPopupProps) {
  return (
    <Menu.Popup
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

type DropdownMenuContentProps = Omit<DropdownMenuPopupProps, 'children'> &
  Pick<DropdownMenuPositionerProps, 'alignOffset' | 'sideOffset'> & {
    children: React.ReactNode
    placement?: Placement
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

// Base UI's own submenu default: it opens away from the trigger and follows the text direction.
function DropdownMenuSubContent({
  children,
  placement = 'inline-end-start',
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
  createDropdownMenuHandle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuCheckboxItemIndicator,
  DropdownMenuClear,
  DropdownMenuContent,
  DropdownMenuEmpty,
  DropdownMenuFilterProvider,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuInput,
  DropdownMenuInputGroup,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuList,
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
  useDropdownMenuFilter,
}

export type {
  DropdownMenuActions,
  DropdownMenuCheckboxItemIndicatorProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuClearProps,
  DropdownMenuContentProps,
  DropdownMenuEmptyProps,
  DropdownMenuFilterProviderProps,
  DropdownMenuGroupLabelProps,
  DropdownMenuGroupProps,
  DropdownMenuHandle,
  DropdownMenuInputGroupProps,
  DropdownMenuInputProps,
  DropdownMenuItemProps,
  DropdownMenuLinkItemProps,
  DropdownMenuListProps,
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
