'use client'

import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import type { Placement } from '../internal/placement'
import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { focusRingClassName, insetFocusRingClassName } from '../internal/focus'
import { formLabelClassName, textControlGroupClassName } from '../internal/form-control'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
  positionerClassName,
} from '../internal/overlay'
import { parsePlacement } from '../internal/placement'
import { resolveClassName } from '../internal/resolve-class-name'

type ComboboxActions = BaseCombobox.Root.Actions

type ComboboxProps<
  Value,
  Multiple extends boolean | undefined = false,
  Item = Value,
> = BaseCombobox.Root.Props<Value, Multiple, Item> &
  ([Multiple] extends [true] ? { multiple: true } : unknown)
type ComboboxChangeEventReason = BaseCombobox.Root.ChangeEventReason
type ComboboxChangeEventDetails = BaseCombobox.Root.ChangeEventDetails
type ComboboxOpenChangeEventDetails = BaseCombobox.Root.OpenChangeEventDetails
type ComboboxHighlightEventReason = BaseCombobox.Root.HighlightEventReason
type ComboboxHighlightEventDetails = BaseCombobox.Root.HighlightEventDetails

function Combobox<Value, Multiple extends boolean | undefined = false, Item = Value>(
  props: ComboboxProps<Value, Multiple, Item>,
): React.JSX.Element {
  return <BaseCombobox.Root {...props} />
}

const createComboboxItems = BaseCombobox.createItems
const ComboboxRow = BaseCombobox.Row
const useComboboxFilter = BaseCombobox.useFilter
const useComboboxFilteredItems = BaseCombobox.useFilteredItems

type ComboboxSelectedValue<Value, Multiple extends boolean | undefined = false> =
  | (Multiple extends true ? readonly Value[] : Value)
  | null

type ComboboxValueProps<Value = unknown, Multiple extends boolean | undefined = false> = Omit<
  BaseCombobox.Value.Props,
  'children'
> & {
  children?:
    | React.ReactNode
    | ((selectedValue: ComboboxSelectedValue<Value, Multiple>) => React.ReactNode)
}
function ComboboxValue<Value = unknown, Multiple extends boolean | undefined = false>(
  props: ComboboxValueProps<Value, Multiple>,
): React.JSX.Element
function ComboboxValue(props: BaseCombobox.Value.Props): React.JSX.Element {
  return <BaseCombobox.Value {...props} />
}

type ComboboxGroupProps<Item = unknown> = Omit<BaseCombobox.Group.Props, 'items'> & {
  items?: readonly Item[]
}

function ComboboxGroup<Item = unknown>(props: ComboboxGroupProps<Item>) {
  return <BaseCombobox.Group {...props} />
}

type ComboboxCollectionProps<Item = unknown> = Omit<BaseCombobox.Collection.Props, 'children'> & {
  children: (item: Item, index: number) => React.ReactNode
}

function ComboboxCollection<Item = unknown>(props: ComboboxCollectionProps<Item>) {
  return <BaseCombobox.Collection {...props} />
}

type ComboboxRowProps = BaseCombobox.Row.Props

// The popup is limited to the available height and lays its parts out in a column, so an input or status
// sharing it with the list leaves the list to shrink. The popup scrolls only when nothing can.
// Same layout as `AutocompletePopup`; keep the two local definitions aligned.
const comboboxPopupClassName = [
  'flex max-h-(--available-height) w-(--anchor-width) max-w-[min(28rem,var(--available-width))] flex-col overflow-x-hidden overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
]

// Same layout as `AutocompleteList`; keep the two local definitions aligned.
const comboboxListClassName = [
  'max-h-[min(20rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden scroll-py-1',
  'data-empty:max-h-none data-empty:p-0',
]

const comboboxItemClassName = [
  'grid min-h-8 select-none grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-text-secondary outline-hidden',
  'hover:bg-state-base-hover-alt hover:text-text-primary',
  'data-highlighted:bg-state-base-hover data-highlighted:text-text-primary',
  'data-selected:text-text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-30 data-disabled:hover:bg-transparent data-disabled:hover:text-text-secondary',
]

type ComboboxTriggerProps = BaseCombobox.Trigger.Props

// Owns the focus indicator only. The caller owns the appearance, directly or through `render`.
function ComboboxTrigger({ className, type = 'button', ...props }: ComboboxTriggerProps) {
  return (
    <BaseCombobox.Trigger
      type={type}
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

// The group owns the horizontal padding and the gap, so an icon, the input, and the controls sit in
// it without margins of their own, like `DropdownMenuInputGroup`. The input keeps a narrow inset so
// its text lands where a standalone `Input` of the same size puts it.
const comboboxInputGroupVariants = cva(
  [
    textControlGroupClassName,
    'group/combobox items-center gap-0.5',
    // Inside the popup the group is the search box and lines up with the options on 4px gutters.
    // The popup marks itself with a data attribute because a `role="dialog"` ancestor could also be
    // a Dialog hosting a field anchor.
    'in-data-dify-combobox-popup:mx-1 in-data-dify-combobox-popup:mt-1 in-data-dify-combobox-popup:w-auto',
  ],
  {
    variants: {
      size: {
        small: 'min-h-6 rounded-md px-1',
        medium: 'min-h-8 rounded-lg px-2',
        large: 'min-h-9 rounded-[10px] px-3',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type ComboboxInputGroupProps = BaseCombobox.InputGroup.Props &
  VariantProps<typeof comboboxInputGroupVariants>

function ComboboxInputGroup({ className, size = 'medium', ...props }: ComboboxInputGroupProps) {
  return (
    <BaseCombobox.InputGroup
      className={(state) =>
        cn(comboboxInputGroupVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

const comboboxInputVariants = cva(
  [
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent px-1 text-components-input-text-filled caret-primary-600 outline-hidden',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'enabled:data-readonly:cursor-default',
  ],
  {
    variants: {
      // Vertical padding fills the group's min height exactly, so the group never grows past it.
      size: {
        small: 'py-0.75 system-xs-regular',
        medium: 'py-1.75 system-sm-regular',
        large: 'py-1.75 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type ComboboxInputProps = Omit<BaseCombobox.Input.Props, 'size'> &
  VariantProps<typeof comboboxInputVariants>

function ComboboxInput({
  className,
  size = 'medium',
  autoComplete = 'off',
  ...props
}: ComboboxInputProps) {
  return (
    <BaseCombobox.Input
      autoComplete={autoComplete}
      className={(state) => cn(comboboxInputVariants({ size }), resolveClassName(className, state))}
      {...props}
    />
  )
}

const comboboxControlVariants = cva(
  [
    'flex shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary',
    'hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary',
    insetFocusRingClassName,
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary disabled:focus-visible:bg-transparent',
    'group-data-disabled/combobox:cursor-not-allowed group-data-disabled/combobox:hover:bg-transparent group-data-disabled/combobox:focus-visible:bg-transparent',
    'group-data-readonly/combobox:hidden',
  ],
  {
    variants: {
      size: {
        small: 'size-4',
        medium: 'size-5',
        large: 'size-5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type ComboboxClearProps = BaseCombobox.Clear.Props & VariantProps<typeof comboboxControlVariants>

// Same look as `DropdownMenuClear`; change both together.
function ComboboxClear({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: ComboboxClearProps) {
  return (
    <BaseCombobox.Clear
      type={type}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Clear combobox')}
      className={(state) =>
        cn(
          comboboxControlVariants({ size }),
          'data-ending-style:opacity-0 data-starting-style:opacity-0',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </BaseCombobox.Clear>
  )
}

type ComboboxInputTriggerProps = BaseCombobox.Trigger.Props &
  VariantProps<typeof comboboxControlVariants>

function ComboboxInputTrigger({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: ComboboxInputTriggerProps) {
  return (
    <BaseCombobox.Trigger
      type={type}
      aria-label={
        props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Open combobox options')
      }
      className={(state) =>
        cn(comboboxControlVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Trigger>
  )
}

type ComboboxIconProps = BaseCombobox.Icon.Props

function ComboboxIcon({ className, children, ...props }: ComboboxIconProps) {
  return (
    <BaseCombobox.Icon
      className={(state) =>
        cn('flex shrink-0 items-center text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Icon>
  )
}

const ComboboxPortal = BaseCombobox.Portal
type ComboboxPortalProps = BaseCombobox.Portal.Props

type ComboboxPositionerProps = Omit<BaseCombobox.Positioner.Props, 'side' | 'align'> & {
  placement?: Placement
}

function ComboboxPositioner({
  className,
  placement = 'bottom-start',
  sideOffset = 4,
  ...props
}: ComboboxPositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseCombobox.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      className={(state) => cn(positionerClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ComboboxPopupProps = BaseCombobox.Popup.Props

function ComboboxPopup({ className, ...props }: ComboboxPopupProps) {
  return (
    <BaseCombobox.Popup
      data-dify-combobox-popup=""
      className={(state) =>
        cn(
          comboboxPopupClassName,
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type ComboboxListProps<Item = unknown> = Omit<BaseCombobox.List.Props, 'children'> & {
  children?: React.ReactNode | ((item: Item, index: number) => React.ReactNode)
}

function ComboboxList<Item = unknown>({ className, ...props }: ComboboxListProps<Item>) {
  return (
    <BaseCombobox.List
      className={(state) => cn(comboboxListClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ComboboxItemProps<Value = unknown> = Omit<BaseCombobox.Item.Props, 'value'> & {
  value?: Value
}

function ComboboxItem<Value = unknown>({ className, ...props }: ComboboxItemProps<Value>) {
  return (
    <BaseCombobox.Item
      className={(state) => cn(comboboxItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ComboboxItemTextProps = React.ComponentProps<'span'>

function ComboboxItemText({ className, ...props }: ComboboxItemTextProps) {
  return <span className={cn('min-w-0 grow truncate system-sm-medium', className)} {...props} />
}

function ComboboxItemIndicator({ className, children, ...props }: ComboboxItemIndicatorProps) {
  return (
    <BaseCombobox.ItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      {children ?? <span className="i-ri-check-line h-4 w-4" aria-hidden="true" />}
    </BaseCombobox.ItemIndicator>
  )
}

type ComboboxItemIndicatorProps = Omit<BaseCombobox.ItemIndicator.Props, 'children'> & {
  children?: React.ReactNode
}

type ComboboxLabelProps = BaseCombobox.Label.Props

function ComboboxLabel({ className, ...props }: ComboboxLabelProps) {
  return (
    <BaseCombobox.Label
      className={(state) => cn(formLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ComboboxGroupLabelProps = BaseCombobox.GroupLabel.Props

// The list's own padding supplies the rest of the inset, so the label text lines up with the
// item text.
function ComboboxGroupLabel({ className, ...props }: ComboboxGroupLabelProps) {
  return (
    <BaseCombobox.GroupLabel
      className={(state) =>
        cn(floatingGroupLabelClassName, 'px-2', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type ComboboxSeparatorProps = BaseCombobox.Separator.Props

function ComboboxSeparator({ className, ...props }: ComboboxSeparatorProps) {
  return (
    <BaseCombobox.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type ComboboxEmptyProps = BaseCombobox.Empty.Props

// Same look as `DropdownMenuEmpty`; change both together.
function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return (
    <BaseCombobox.Empty
      className={(state) =>
        cn(
          'px-3 py-2 system-sm-regular text-text-tertiary empty:h-0 empty:p-0',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type ComboboxStatusProps = BaseCombobox.Status.Props

function ComboboxStatus({ className, ...props }: ComboboxStatusProps) {
  return (
    <BaseCombobox.Status
      className={(state) =>
        cn(
          'px-3 py-2 system-sm-regular text-text-tertiary empty:p-0',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type ComboboxChipsProps = BaseCombobox.Chips.Props

function ComboboxChips({ className, ...props }: ComboboxChipsProps) {
  return (
    <BaseCombobox.Chips
      className={(state) =>
        cn('flex w-full min-w-0 flex-wrap items-center gap-1', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type ComboboxChipProps = BaseCombobox.Chip.Props

function ComboboxChip({ className, ...props }: ComboboxChipProps) {
  return (
    <BaseCombobox.Chip
      className={(state) =>
        cn(
          'inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-state-base-hover px-1.5 py-0.5 system-xs-medium text-text-secondary',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

function ComboboxChipRemove({
  className,
  children,
  type = 'button',
  ...props
}: ComboboxChipRemoveProps) {
  return (
    <BaseCombobox.ChipRemove
      type={type}
      aria-label={
        props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Remove selected item')
      }
      className={(state) =>
        cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-sm text-text-tertiary hover:bg-state-base-hover-alt hover:text-text-secondary',
          focusRingClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-3" aria-hidden="true" />}
    </BaseCombobox.ChipRemove>
  )
}

type ComboboxChipRemoveProps = BaseCombobox.ChipRemove.Props

export {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxClear,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxIcon,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxInputTrigger,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxItemText,
  ComboboxLabel,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxRow,
  ComboboxSeparator,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
  createComboboxItems,
  useComboboxFilter,
  useComboboxFilteredItems,
}

export type {
  ComboboxActions,
  ComboboxChangeEventDetails,
  ComboboxChangeEventReason,
  ComboboxChipProps,
  ComboboxChipRemoveProps,
  ComboboxChipsProps,
  ComboboxClearProps,
  ComboboxCollectionProps,
  ComboboxEmptyProps,
  ComboboxGroupLabelProps,
  ComboboxGroupProps,
  ComboboxHighlightEventDetails,
  ComboboxHighlightEventReason,
  ComboboxIconProps,
  ComboboxInputGroupProps,
  ComboboxInputProps,
  ComboboxInputTriggerProps,
  ComboboxItemIndicatorProps,
  ComboboxItemProps,
  ComboboxItemTextProps,
  ComboboxLabelProps,
  ComboboxListProps,
  ComboboxOpenChangeEventDetails,
  ComboboxPopupProps,
  ComboboxPortalProps,
  ComboboxPositionerProps,
  ComboboxProps,
  ComboboxRowProps,
  ComboboxSeparatorProps,
  ComboboxStatusProps,
  ComboboxTriggerProps,
  ComboboxValueProps,
}
