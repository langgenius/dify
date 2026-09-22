'use client'

import type * as React from 'react'
import type { MenuItemVariant } from '../overlay-shared'
import type { Placement } from '../placement'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
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

type ContextMenuContentProps = Omit<BaseContextMenu.Popup.Props, 'children'> &
  Pick<BaseContextMenu.Positioner.Props, 'sideOffset' | 'alignOffset'> & {
    children: React.ReactNode
    placement?: Placement
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
          className={(state) =>
            cn(
              menuPopupClassName,
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

type ContextMenuLabelProps = BaseContextMenu.GroupLabel.Props

function ContextMenuLabel({ className, ...props }: ContextMenuLabelProps) {
  return (
    <BaseContextMenu.GroupLabel
      className={(state) => cn(floatingGroupLabelClassName, resolveClassName(className, state))}
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
