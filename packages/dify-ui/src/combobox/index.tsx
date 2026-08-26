'use client'

import type { VariantProps } from 'class-variance-authority'
import type { Placement } from '../placement'
import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'
import { formLabelClassName, textControlCompoundInputFocusClassName } from '../form-control-shared'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

type ComboboxProps<Value, Multiple extends boolean | undefined = false> = BaseCombobox.Root.Props<
  Value,
  Multiple
> &
  ([Multiple] extends [true] ? { multiple: true } : unknown)
type ComboboxChangeEventDetails = BaseCombobox.Root.ChangeEventDetails

function Combobox<Value, Multiple extends boolean | undefined = false>(
  props: ComboboxProps<Value, Multiple>,
): React.JSX.Element {
  return <BaseCombobox.Root {...props} />
}

const ComboboxRow = BaseCombobox.Row
const useComboboxFilter = BaseCombobox.useFilter
const useComboboxFilteredItems = BaseCombobox.useFilteredItems

type ComboboxSelectedValue<Value, Multiple extends boolean | undefined = false> =
  | (Multiple extends true ? Value[] : Value)
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

type ComboboxGroupProps<Value = unknown> = Omit<BaseCombobox.Group.Props, 'items'> & {
  items?: readonly Value[]
}

function ComboboxGroup<Value = unknown>(props: ComboboxGroupProps<Value>) {
  return <BaseCombobox.Group {...props} />
}

type ComboboxCollectionProps<Value = unknown> = Omit<BaseCombobox.Collection.Props, 'children'> & {
  children: (item: Value, index: number) => React.ReactNode
}

function ComboboxCollection<Value = unknown>(props: ComboboxCollectionProps<Value>) {
  return <BaseCombobox.Collection {...props} />
}

type ComboboxRowProps = BaseCombobox.Row.Props

const comboboxPopupClassName = [
  'w-(--anchor-width) max-w-[min(28rem,var(--available-width))] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
]

const comboboxListClassName = [
  'max-h-[min(20rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden scroll-py-1',
  'data-empty:max-h-none data-empty:p-0',
]

const comboboxItemClassName = [
  'grid min-h-8 cursor-pointer select-none grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-text-secondary outline-hidden',
  'hover:bg-state-base-hover-alt hover:text-text-primary',
  'data-highlighted:bg-state-base-hover data-highlighted:text-text-primary',
  'data-selected:text-text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-30 data-disabled:hover:bg-transparent data-disabled:hover:text-text-secondary',
]

const comboboxTriggerVariants = cva(
  [
    'group/combobox-trigger flex w-full min-w-0 items-center border-0 bg-components-input-bg-normal text-start text-components-input-text-filled outline-hidden transition-colors',
    'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
    'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    'data-placeholder:text-components-input-text-placeholder',
    'data-readonly:cursor-default data-readonly:bg-transparent data-readonly:hover:bg-transparent',
    'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
    'data-disabled:data-placeholder:text-components-input-text-disabled',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'h-6 gap-px rounded-md px-2 py-1 system-xs-regular',
        medium: 'h-8 gap-0.5 rounded-lg px-3 py-2 system-sm-regular',
        large: 'h-9 gap-0.5 rounded-[10px] px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type ComboboxTriggerProps = Omit<BaseCombobox.Trigger.Props, 'className'> &
  VariantProps<typeof comboboxTriggerVariants> & {
    className?: string
    icon?: React.ReactNode | false
  }

function ComboboxTrigger({
  className,
  children,
  icon,
  size,
  type = 'button',
  ...props
}: ComboboxTriggerProps) {
  return (
    <BaseCombobox.Trigger
      type={type}
      className={cn(comboboxTriggerVariants({ size, className }))}
      {...props}
    >
      <span className="min-w-0 grow truncate">{children}</span>
      {icon !== false && (
        <BaseCombobox.Icon className="shrink-0 text-text-quaternary transition-colors group-hover/combobox-trigger:text-text-secondary group-data-popup-open/combobox-trigger:text-text-secondary group-data-readonly/combobox-trigger:hidden">
          {icon ?? <span className="i-ri-arrow-down-s-line h-4 w-4" aria-hidden="true" />}
        </BaseCombobox.Icon>
      )}
    </BaseCombobox.Trigger>
  )
}

const comboboxInputGroupVariants = cva(
  [
    'group/combobox flex w-full min-w-0 items-center border border-transparent bg-components-input-bg-normal text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    textControlCompoundInputFocusClassName,
    'data-focused:border-components-input-border-active data-focused:bg-components-input-bg-active data-focused:shadow-xs',
    'data-popup-open:border-components-input-border-active data-popup-open:bg-components-input-bg-active',
    'data-disabled:cursor-not-allowed data-disabled:border-transparent data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled',
    'data-disabled:hover:border-transparent data-disabled:hover:bg-components-input-bg-disabled',
    'data-readonly:shadow-none data-readonly:hover:border-transparent data-readonly:hover:bg-components-input-bg-normal',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'min-h-6 rounded-md',
        medium: 'min-h-8 rounded-lg',
        large: 'min-h-9 rounded-[10px]',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type ComboboxInputGroupProps = Omit<BaseCombobox.InputGroup.Props, 'className'> &
  VariantProps<typeof comboboxInputGroupVariants> & { className?: string }

function ComboboxInputGroup({ className, size = 'medium', ...props }: ComboboxInputGroupProps) {
  return (
    <BaseCombobox.InputGroup
      className={cn(comboboxInputGroupVariants({ size }), className)}
      {...props}
    />
  )
}

const comboboxInputVariants = cva(
  [
    'w-0 min-w-0 flex-1 appearance-none border-0 bg-transparent text-components-input-text-filled caret-primary-600 outline-hidden',
    'placeholder:text-components-input-text-placeholder',
    'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled disabled:placeholder:text-components-input-text-disabled',
    'data-readonly:cursor-default',
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

type ComboboxInputProps = Omit<BaseCombobox.Input.Props, 'className' | 'size'> &
  VariantProps<typeof comboboxInputVariants> & { className?: string }

function ComboboxInput({
  className,
  size = 'medium',
  autoComplete = 'off',
  ...props
}: ComboboxInputProps) {
  return (
    <BaseCombobox.Input
      autoComplete={autoComplete}
      className={cn(comboboxInputVariants({ size }), className)}
      {...props}
    />
  )
}

const comboboxControlVariants = cva(
  [
    'flex shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary outline-hidden transition-colors',
    'hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary',
    'focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-disabled/combobox:cursor-not-allowed group-data-disabled/combobox:hover:bg-transparent group-data-disabled/combobox:focus-visible:bg-transparent group-data-disabled/combobox:focus-visible:ring-0',
    'group-data-readonly/combobox:hidden',
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

type ComboboxClearProps = Omit<BaseCombobox.Clear.Props, 'className'> &
  VariantProps<typeof comboboxControlVariants> & { className?: string }

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
      className={cn(
        comboboxControlVariants({ size }),
        'data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </BaseCombobox.Clear>
  )
}

type ComboboxInputTriggerProps = Omit<BaseCombobox.Trigger.Props, 'className'> &
  VariantProps<typeof comboboxControlVariants> & { className?: string }

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
      className={cn(comboboxControlVariants({ size }), className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Trigger>
  )
}

type ComboboxIconProps = Omit<BaseCombobox.Icon.Props, 'className'> & {
  className?: string
}

function ComboboxIcon({ className, children, ...props }: ComboboxIconProps) {
  return (
    <BaseCombobox.Icon
      className={cn('flex shrink-0 items-center text-text-tertiary', className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Icon>
  )
}

const ComboboxPortal = BaseCombobox.Portal
type ComboboxPortalProps = BaseCombobox.Portal.Props

type ComboboxPositionerProps = Omit<
  BaseCombobox.Positioner.Props,
  'className' | 'side' | 'align'
> & {
  className?: string
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
      className={cn('z-50 outline-hidden', className)}
      {...props}
    />
  )
}

type ComboboxPopupProps = Omit<BaseCombobox.Popup.Props, 'className'> & {
  className?: string
}

function ComboboxPopup({ className, ...props }: ComboboxPopupProps) {
  return (
    <BaseCombobox.Popup
      className={cn(comboboxPopupClassName, floatingPopupAnimationClassName, className)}
      {...props}
    />
  )
}

type ComboboxListProps<Value = unknown> = Omit<
  BaseCombobox.List.Props,
  'children' | 'className'
> & {
  className?: string
  children?: React.ReactNode | ((item: Value, index: number) => React.ReactNode)
}

function ComboboxList<Value = unknown>({ className, ...props }: ComboboxListProps<Value>) {
  return <BaseCombobox.List className={cn(comboboxListClassName, className)} {...props} />
}

type ComboboxItemProps<Value = unknown> = Omit<BaseCombobox.Item.Props, 'className' | 'value'> & {
  className?: string
  value?: Value
}

function ComboboxItem<Value = unknown>({ className, ...props }: ComboboxItemProps<Value>) {
  return <BaseCombobox.Item className={cn(comboboxItemClassName, className)} {...props} />
}

type ComboboxItemTextProps = React.ComponentProps<'span'>

function ComboboxItemText({ className, ...props }: ComboboxItemTextProps) {
  return (
    <span className={cn('min-w-0 grow truncate px-1 system-sm-medium', className)} {...props} />
  )
}

function ComboboxItemIndicator({ className, children, ...props }: ComboboxItemIndicatorProps) {
  return (
    <BaseCombobox.ItemIndicator
      className={cn(floatingItemIndicatorClassName, className)}
      {...props}
    >
      {children ?? <span className="i-ri-check-line h-4 w-4" aria-hidden="true" />}
    </BaseCombobox.ItemIndicator>
  )
}

type ComboboxItemIndicatorProps = Omit<
  BaseCombobox.ItemIndicator.Props,
  'children' | 'className'
> & {
  children?: React.ReactNode
  className?: string
}

type ComboboxLabelProps = Omit<BaseCombobox.Label.Props, 'className'> & {
  className?: string
}

function ComboboxLabel({ className, ...props }: ComboboxLabelProps) {
  return <BaseCombobox.Label className={cn(formLabelClassName, className)} {...props} />
}

type ComboboxGroupLabelProps = Omit<BaseCombobox.GroupLabel.Props, 'className'> & {
  className?: string
}

function ComboboxGroupLabel({ className, ...props }: ComboboxGroupLabelProps) {
  return (
    <BaseCombobox.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
  )
}

type ComboboxSeparatorProps = Omit<BaseCombobox.Separator.Props, 'className'> & {
  className?: string
}

function ComboboxSeparator({ className, ...props }: ComboboxSeparatorProps) {
  return <BaseCombobox.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
}

type ComboboxEmptyProps = Omit<BaseCombobox.Empty.Props, 'className'> & {
  className?: string
}

function ComboboxEmpty({ className, ...props }: ComboboxEmptyProps) {
  return (
    <BaseCombobox.Empty
      className={cn(
        'px-3 py-2 system-sm-regular text-text-tertiary empty:h-0 empty:p-0',
        className,
      )}
      {...props}
    />
  )
}

type ComboboxStatusProps = Omit<BaseCombobox.Status.Props, 'className'> & {
  className?: string
}

function ComboboxStatus({ className, ...props }: ComboboxStatusProps) {
  return (
    <BaseCombobox.Status
      className={cn('px-3 py-2 system-sm-regular text-text-tertiary empty:p-0', className)}
      {...props}
    />
  )
}

type ComboboxChipsProps = Omit<BaseCombobox.Chips.Props, 'className'> & {
  className?: string
}

function ComboboxChips({ className, ...props }: ComboboxChipsProps) {
  return (
    <BaseCombobox.Chips
      className={cn('flex w-full min-w-0 flex-wrap items-center gap-1 px-1', className)}
      {...props}
    />
  )
}

type ComboboxChipProps = Omit<BaseCombobox.Chip.Props, 'className'> & {
  className?: string
}

function ComboboxChip({ className, ...props }: ComboboxChipProps) {
  return (
    <BaseCombobox.Chip
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-state-base-hover px-1.5 py-0.5 system-xs-medium text-text-secondary',
        className,
      )}
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
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center rounded-sm text-text-tertiary outline-hidden hover:bg-state-base-hover-alt hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        className,
      )}
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-3" aria-hidden="true" />}
    </BaseCombobox.ChipRemove>
  )
}

type ComboboxChipRemoveProps = Omit<BaseCombobox.ChipRemove.Props, 'className'> & {
  className?: string
}

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
  useComboboxFilter,
  useComboboxFilteredItems,
}

export type {
  ComboboxChangeEventDetails,
  ComboboxChipProps,
  ComboboxChipRemoveProps,
  ComboboxChipsProps,
  ComboboxClearProps,
  ComboboxCollectionProps,
  ComboboxEmptyProps,
  ComboboxGroupLabelProps,
  ComboboxGroupProps,
  ComboboxIconProps,
  ComboboxInputGroupProps,
  ComboboxInputProps,
  ComboboxInputTriggerProps,
  ComboboxItemIndicatorProps,
  ComboboxItemProps,
  ComboboxItemTextProps,
  ComboboxLabelProps,
  ComboboxListProps,
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
