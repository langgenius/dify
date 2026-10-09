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
  triggerFocusClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

const DropdownMenu = Menu.Root
const DropdownMenuPortal = Menu.Portal
const DropdownMenuSub = Menu.SubmenuRoot
const DropdownMenuGroup = Menu.Group
const createDropdownMenuHandle = Menu.createHandle

// Filtering (Base UI preview). Wrap `DropdownMenu` in the provider, host the input in an `InputGroup`
// inside the content, and put the items in `DropdownMenuList` so the list owns the `menu` role and
// the scrolling.
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

// Matches `InputGroupInput` so the filter input can be the direct input of an `InputGroup`, which
// owns the shared surface, focus ring and addons.
const dropdownMenuInputClassName = [
  'w-0 min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent px-3 py-1.75 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden',
  'placeholder:text-components-input-text-placeholder',
  'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
]
const dropdownMenuClearClassName = [
  'flex size-5 shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary outline-hidden transition-colors',
  'hover:bg-components-input-bg-hover hover:text-text-secondary',
  'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary',
  'motion-reduce:transition-none',
]
const dropdownMenuEmptyClassName = 'px-3 py-2 system-sm-regular text-text-tertiary'
// The popup keeps its vertical padding and the items keep their inset, so the list adds none.
const dropdownMenuListClassName =
  'max-h-[min(20rem,var(--available-height))] overflow-x-hidden overflow-y-auto overscroll-contain outline-hidden scroll-py-1'

type DropdownMenuInputProps = Menu.Input.Props

function DropdownMenuInput({ className, autoComplete = 'off', ...props }: DropdownMenuInputProps) {
  return (
    <Menu.Input
      autoComplete={autoComplete}
      className={(state) => cn(dropdownMenuInputClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type DropdownMenuClearProps = Menu.Clear.Props

// Base UI renders the clear control only while the input has a value, hidden from assistive
// technology and the tab order: keyboard users clear the input directly.
function DropdownMenuClear({
  className,
  children,
  type = 'button',
  ...props
}: DropdownMenuClearProps) {
  return (
    <Menu.Clear
      type={type}
      className={(state) => cn(dropdownMenuClearClassName, resolveClassName(className, state))}
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </Menu.Clear>
  )
}

type DropdownMenuEmptyProps = Menu.Empty.Props

function DropdownMenuEmpty({ className, ...props }: DropdownMenuEmptyProps) {
  return (
    <Menu.Empty
      className={(state) => cn(dropdownMenuEmptyClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type DropdownMenuListProps = Menu.List.Props

function DropdownMenuList({ className, ...props }: DropdownMenuListProps) {
  return (
    <Menu.List
      className={(state) => cn(dropdownMenuListClassName, resolveClassName(className, state))}
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
