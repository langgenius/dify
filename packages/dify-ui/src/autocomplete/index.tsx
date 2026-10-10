'use client'

import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import type { Placement } from '../placement'
import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { textControlGroupClassName } from '../form-control-shared'
import { resolveClassName } from '../internals/resolve-class-name'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

type AutocompleteActions = BaseAutocomplete.Root.Actions

type AutocompleteProps<ItemValue> = BaseAutocomplete.Root.Props<ItemValue>
type AutocompleteChangeEventDetails = BaseAutocomplete.Root.ChangeEventDetails
type AutocompleteOpenChangeEventDetails = BaseAutocomplete.Root.OpenChangeEventDetails
type AutocompleteGroupedProps<Items extends readonly { items: readonly unknown[] }[]> = Omit<
  AutocompleteProps<Items[number]['items'][number]>,
  'items'
> & {
  items: Items
}
type AutocompleteFlatProps<ItemValue> = Omit<AutocompleteProps<ItemValue>, 'items'> & {
  items?: readonly ItemValue[]
}

function Autocomplete<Items extends readonly { items: readonly unknown[] }[]>(
  props: AutocompleteGroupedProps<Items>,
): React.JSX.Element
function Autocomplete<ItemValue>(props: AutocompleteFlatProps<ItemValue>): React.JSX.Element
function Autocomplete(props: AutocompleteProps<unknown>): React.JSX.Element {
  return <BaseAutocomplete.Root {...props} />
}

const AutocompleteValue = BaseAutocomplete.Value
const AutocompleteRow = BaseAutocomplete.Row
const useAutocompleteFilter = BaseAutocomplete.useFilter
const useAutocompleteFilteredItems: <Value>() => readonly Value[] =
  BaseAutocomplete.useFilteredItems

type AutocompleteValueProps = BaseAutocomplete.Value.Props
type AutocompleteRowProps = BaseAutocomplete.Row.Props

type AutocompleteGroupProps<Value = unknown> = Omit<BaseAutocomplete.Group.Props, 'items'> & {
  items?: readonly Value[]
}

function AutocompleteGroup<Value = unknown>(props: AutocompleteGroupProps<Value>) {
  return <BaseAutocomplete.Group {...props} />
}

type AutocompleteCollectionProps<Value = unknown> = Omit<
  BaseAutocomplete.Collection.Props,
  'children'
> & {
  children: (item: Value, index: number) => React.ReactNode
}

function AutocompleteCollection<Value = unknown>(props: AutocompleteCollectionProps<Value>) {
  return <BaseAutocomplete.Collection {...props} />
}

// The popup is limited to the available height and lays its parts out in a column, so a status or input
// sharing it with the list leaves the list to shrink. The popup scrolls only when nothing can.
const autocompletePopupClassName = [
  'flex max-h-(--available-height) w-(--anchor-width) max-w-[min(28rem,var(--available-width))] flex-col overflow-x-hidden overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
]

const autocompleteListClassName = [
  'max-h-[min(20rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden scroll-py-1',
  'data-empty:max-h-none data-empty:p-0',
]

const autocompleteItemClassName = [
  'mx-1 flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-text-secondary outline-hidden',
  'data-highlighted:bg-state-base-hover data-highlighted:text-text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-30',
]

const autocompleteInputGroupVariants = cva(
  [textControlGroupClassName, 'group/autocomplete items-center'],
  {
    variants: {
      size: {
        small: 'h-6 rounded-md',
        medium: 'h-8 rounded-lg',
        large: 'h-9 rounded-[10px]',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type AutocompleteInputGroupProps = BaseAutocomplete.InputGroup.Props &
  VariantProps<typeof autocompleteInputGroupVariants>

function AutocompleteInputGroup({
  className,
  size = 'medium',
  ...props
}: AutocompleteInputGroupProps) {
  return (
    <BaseAutocomplete.InputGroup
      className={(state) =>
        cn(autocompleteInputGroupVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

const autocompleteInputVariants = cva(
  [
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent text-components-input-text-filled caret-primary-600 outline-hidden',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'enabled:data-readonly:cursor-default',
  ],
  {
    variants: {
      size: {
        small: 'px-2 py-1 system-xs-regular',
        medium: 'px-3 py-1.75 system-sm-regular',
        large: 'px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type AutocompleteInputProps = Omit<BaseAutocomplete.Input.Props, 'size'> &
  VariantProps<typeof autocompleteInputVariants>

function AutocompleteInput({
  className,
  size = 'medium',
  autoComplete = 'off',
  ...props
}: AutocompleteInputProps) {
  return (
    <BaseAutocomplete.Input
      autoComplete={autoComplete}
      className={(state) =>
        cn(autocompleteInputVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

const autocompleteControlVariants = cva(
  [
    'flex shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary outline-hidden transition-colors',
    'hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary',
    'focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-disabled/autocomplete:cursor-not-allowed group-data-disabled/autocomplete:hover:bg-transparent group-data-disabled/autocomplete:focus-visible:bg-transparent group-data-disabled/autocomplete:focus-visible:ring-0',
    'group-data-readonly/autocomplete:hidden',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'me-1 size-4',
        medium: 'me-1.5 size-5',
        large: 'me-2 size-5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type AutocompleteTriggerProps = BaseAutocomplete.Trigger.Props &
  VariantProps<typeof autocompleteControlVariants>

function AutocompleteTrigger({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: AutocompleteTriggerProps) {
  return (
    <BaseAutocomplete.Trigger
      type={type}
      aria-label={
        props['aria-label'] ??
        (props['aria-labelledby'] ? undefined : 'Open autocomplete suggestions')
      }
      className={(state) =>
        cn(autocompleteControlVariants({ size }), resolveClassName(className, state))
      }
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Trigger>
  )
}

type AutocompleteClearProps = BaseAutocomplete.Clear.Props &
  VariantProps<typeof autocompleteControlVariants>

function AutocompleteClear({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: AutocompleteClearProps) {
  return (
    <BaseAutocomplete.Clear
      type={type}
      aria-label={
        props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Clear autocomplete')
      }
      className={(state) =>
        cn(
          autocompleteControlVariants({ size }),
          'data-ending-style:opacity-0 data-starting-style:opacity-0',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Clear>
  )
}

type AutocompleteIconProps = BaseAutocomplete.Icon.Props

function AutocompleteIcon({ className, children, ...props }: AutocompleteIconProps) {
  return (
    <BaseAutocomplete.Icon
      className={(state) =>
        cn('flex shrink-0 items-center text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Icon>
  )
}

const AutocompletePortal = BaseAutocomplete.Portal
type AutocompletePortalProps = BaseAutocomplete.Portal.Props

type AutocompletePositionerProps = Omit<BaseAutocomplete.Positioner.Props, 'side' | 'align'> & {
  placement?: Placement
}

function AutocompletePositioner({
  className,
  placement = 'bottom-start',
  sideOffset = 4,
  ...props
}: AutocompletePositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseAutocomplete.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      className={(state) => cn('z-50 outline-hidden', resolveClassName(className, state))}
      {...props}
    />
  )
}

type AutocompletePopupProps = BaseAutocomplete.Popup.Props

function AutocompletePopup({ className, ...props }: AutocompletePopupProps) {
  return (
    <BaseAutocomplete.Popup
      className={(state) =>
        cn(
          autocompletePopupClassName,
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type AutocompleteListProps<Value = unknown> = Omit<BaseAutocomplete.List.Props, 'children'> & {
  children?: React.ReactNode | ((item: Value, index: number) => React.ReactNode)
}

function AutocompleteList<Value = unknown>({ className, ...props }: AutocompleteListProps<Value>) {
  return (
    <BaseAutocomplete.List
      className={(state) => cn(autocompleteListClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type AutocompleteItemProps<Value = unknown> = Omit<BaseAutocomplete.Item.Props, 'value'> & {
  value?: Value
}

function AutocompleteItem<Value = unknown>({ className, ...props }: AutocompleteItemProps<Value>) {
  return (
    <BaseAutocomplete.Item
      className={(state) => cn(autocompleteItemClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type AutocompleteItemTextProps = React.ComponentProps<'span'>

function AutocompleteItemText({ className, ...props }: AutocompleteItemTextProps) {
  return (
    <span className={cn('min-w-0 grow truncate px-1 system-sm-medium', className)} {...props} />
  )
}

type AutocompleteGroupLabelProps = BaseAutocomplete.GroupLabel.Props

function AutocompleteGroupLabel({ className, ...props }: AutocompleteGroupLabelProps) {
  return (
    <BaseAutocomplete.GroupLabel
      className={(state) => cn(floatingGroupLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type AutocompleteSeparatorProps = BaseAutocomplete.Separator.Props

function AutocompleteSeparator({ className, ...props }: AutocompleteSeparatorProps) {
  return (
    <BaseAutocomplete.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type AutocompleteEmptyProps = BaseAutocomplete.Empty.Props

function AutocompleteEmpty({ className, ...props }: AutocompleteEmptyProps) {
  return (
    <BaseAutocomplete.Empty
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

type AutocompleteStatusProps = BaseAutocomplete.Status.Props

function AutocompleteStatus({ className, ...props }: AutocompleteStatusProps) {
  return (
    <BaseAutocomplete.Status
      className={(state) =>
        cn('px-3 py-2 system-sm-regular text-text-tertiary', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

function AutocompleteItemIndicator({
  className,
  children,
  ...props
}: AutocompleteItemIndicatorProps) {
  return (
    <span className={cn(floatingItemIndicatorClassName, className)} {...props}>
      {children ?? <span className="i-ri-arrow-right-line size-4" aria-hidden="true" />}
    </span>
  )
}

type AutocompleteItemIndicatorProps = React.ComponentProps<'span'>

export {
  Autocomplete,
  AutocompleteClear,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteIcon,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemIndicator,
  AutocompleteItemText,
  AutocompleteList,
  AutocompletePopup,
  AutocompletePortal,
  AutocompletePositioner,
  AutocompleteRow,
  AutocompleteSeparator,
  AutocompleteStatus,
  AutocompleteTrigger,
  AutocompleteValue,
  useAutocompleteFilter,
  useAutocompleteFilteredItems,
}

export type {
  AutocompleteActions,
  AutocompleteChangeEventDetails,
  AutocompleteClearProps,
  AutocompleteCollectionProps,
  AutocompleteEmptyProps,
  AutocompleteFlatProps,
  AutocompleteGroupedProps,
  AutocompleteGroupLabelProps,
  AutocompleteGroupProps,
  AutocompleteIconProps,
  AutocompleteInputGroupProps,
  AutocompleteInputProps,
  AutocompleteItemIndicatorProps,
  AutocompleteItemProps,
  AutocompleteItemTextProps,
  AutocompleteListProps,
  AutocompleteOpenChangeEventDetails,
  AutocompletePopupProps,
  AutocompletePortalProps,
  AutocompletePositionerProps,
  AutocompleteProps,
  AutocompleteRowProps,
  AutocompleteSeparatorProps,
  AutocompleteStatusProps,
  AutocompleteTriggerProps,
  AutocompleteValueProps,
}
