'use client'

import type * as React from 'react'
import type { MenuItemVariant } from '../internal/menu'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { cn } from '../cn'
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

const ContextMenu = BaseContextMenu.Root
const ContextMenuTrigger = BaseContextMenu.Trigger
const ContextMenuSub = BaseContextMenu.SubmenuRoot
const ContextMenuGroup = BaseContextMenu.Group
type ContextMenuProps = BaseContextMenu.Root.Props
type ContextMenuActions = BaseContextMenu.Root.Actions
type ContextMenuChangeEventReason = BaseContextMenu.Root.ChangeEventReason
type ContextMenuChangeEventDetails = BaseContextMenu.Root.ChangeEventDetails
type ContextMenuTriggerProps = BaseContextMenu.Trigger.Props
type ContextMenuSubProps = BaseContextMenu.SubmenuRoot.Props
type ContextMenuSubChangeEventReason = BaseContextMenu.SubmenuRoot.ChangeEventReason
type ContextMenuSubChangeEventDetails = BaseContextMenu.SubmenuRoot.ChangeEventDetails
type ContextMenuGroupProps = BaseContextMenu.Group.Props
type ContextMenuRadioGroupChangeEventReason = BaseContextMenu.RadioGroup.ChangeEventReason
type ContextMenuRadioGroupChangeEventDetails = BaseContextMenu.RadioGroup.ChangeEventDetails
type ContextMenuRadioGroupProps<Value = unknown> = Omit<
  BaseContextMenu.RadioGroup.Props,
  'defaultValue' | 'onValueChange' | 'value'
> & {
  defaultValue?: Value
  onValueChange?: (value: Value, eventDetails: ContextMenuRadioGroupChangeEventDetails) => void
  value?: Value
}
type ContextMenuItemVariant = MenuItemVariant
// Intentionally no public Backdrop export; Base UI handles context-menu modal dismissal internally.

function ContextMenuRadioGroup<Value = unknown>(
  props: ContextMenuRadioGroupProps<Value>,
): React.JSX.Element {
  return <BaseContextMenu.RadioGroup {...props} />
}

type ContextMenuContentProps = Omit<BaseContextMenu.Popup.Props, 'children'> &
  Pick<BaseContextMenu.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
  }

function ContextMenuContent({
  children,
  side = 'bottom',
  align = 'start',
  sideOffset = 0,
  alignOffset = 0,
  className,
  ...props
}: ContextMenuContentProps) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={positionerClassName}
      >
        <BaseContextMenu.Popup
          className={(state) =>
            cn(
              menuPopupBaseClassName,
              menuPopupSurfaceClassName,
              floatingPopupAnimationClassName,
              resolveClassName(className, state),
            )
          }
          {...props}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

type ContextMenuItemProps = BaseContextMenu.Item.Props & {
  variant?: ContextMenuItemVariant
}

function ContextMenuItem({ className, variant = 'default', ...props }: ContextMenuItemProps) {
  return (
    <BaseContextMenu.Item
      data-variant={variant}
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type ContextMenuLinkItemProps = BaseContextMenu.LinkItem.Props & {
  variant?: ContextMenuItemVariant
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
      className={(state) =>
        cn(menuItemClassName, menuItemDestructiveClassName, resolveClassName(className, state))
      }
      closeOnClick={closeOnClick}
      {...props}
    />
  )
}

type ContextMenuRadioItemProps<Value = unknown> = Omit<BaseContextMenu.RadioItem.Props, 'value'> & {
  value: Value
}

function ContextMenuRadioItem<Value = unknown>({
  className,
  ...props
}: ContextMenuRadioItemProps<Value>) {
  return (
    <BaseContextMenu.RadioItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

function ContextMenuCheckboxItem({ className, ...props }: ContextMenuCheckboxItemProps) {
  return (
    <BaseContextMenu.CheckboxItem
      className={(state) => cn(menuItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ContextMenuCheckboxItemProps = BaseContextMenu.CheckboxItem.Props
type ContextMenuCheckboxItemChangeEventReason = BaseContextMenu.CheckboxItem.ChangeEventReason
type ContextMenuCheckboxItemChangeEventDetails = BaseContextMenu.CheckboxItem.ChangeEventDetails

function ContextMenuCheckboxItemIndicator({
  className,
  ...props
}: ContextMenuCheckboxItemIndicatorProps) {
  return (
    <BaseContextMenu.CheckboxItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.CheckboxItemIndicator>
  )
}

type ContextMenuCheckboxItemIndicatorProps = Omit<
  BaseContextMenu.CheckboxItemIndicator.Props,
  'children'
>

function ContextMenuRadioItemIndicator({
  className,
  ...props
}: ContextMenuRadioItemIndicatorProps) {
  return (
    <BaseContextMenu.RadioItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span aria-hidden className="i-ri-check-line h-4 w-4" />
    </BaseContextMenu.RadioItemIndicator>
  )
}

type ContextMenuRadioItemIndicatorProps = Omit<BaseContextMenu.RadioItemIndicator.Props, 'children'>

type ContextMenuSubTriggerProps = BaseContextMenu.SubmenuTrigger.Props & {
  variant?: ContextMenuItemVariant
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
    </BaseContextMenu.SubmenuTrigger>
  )
}

type ContextMenuSubContentProps = ContextMenuContentProps

// Base UI's own submenu default: it opens away from the trigger and follows the text direction.
function ContextMenuSubContent({
  children,
  side = 'inline-end',
  align = 'start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: ContextMenuSubContentProps) {
  return (
    <BaseContextMenu.Portal>
      <BaseContextMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={positionerClassName}
      >
        <BaseContextMenu.Popup
          className={(state) =>
            cn(
              menuPopupBaseClassName,
              menuPopupSurfaceClassName,
              floatingPopupAnimationClassName,
              resolveClassName(className, state),
            )
          }
          {...props}
        >
          {children}
        </BaseContextMenu.Popup>
      </BaseContextMenu.Positioner>
    </BaseContextMenu.Portal>
  )
}

type ContextMenuGroupLabelProps = BaseContextMenu.GroupLabel.Props

function ContextMenuGroupLabel({ className, ...props }: ContextMenuGroupLabelProps) {
  return (
    <BaseContextMenu.GroupLabel
      className={(state) =>
        cn(floatingGroupLabelClassName, 'px-3', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type ContextMenuSeparatorProps = BaseContextMenu.Separator.Props

function ContextMenuSeparator({ className, ...props }: ContextMenuSeparatorProps) {
  return (
    <BaseContextMenu.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuCheckboxItemIndicator,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuGroupLabel,
  ContextMenuItem,
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
  ContextMenuChangeEventDetails,
  ContextMenuChangeEventReason,
  ContextMenuCheckboxItemChangeEventDetails,
  ContextMenuCheckboxItemChangeEventReason,
  ContextMenuCheckboxItemIndicatorProps,
  ContextMenuCheckboxItemProps,
  ContextMenuContentProps,
  ContextMenuGroupLabelProps,
  ContextMenuGroupProps,
  ContextMenuItemProps,
  ContextMenuLinkItemProps,
  ContextMenuProps,
  ContextMenuRadioGroupChangeEventDetails,
  ContextMenuRadioGroupChangeEventReason,
  ContextMenuRadioGroupProps,
  ContextMenuRadioItemIndicatorProps,
  ContextMenuRadioItemProps,
  ContextMenuSeparatorProps,
  ContextMenuSubChangeEventDetails,
  ContextMenuSubChangeEventReason,
  ContextMenuSubContentProps,
  ContextMenuSubProps,
  ContextMenuSubTriggerProps,
  ContextMenuTriggerProps,
}
