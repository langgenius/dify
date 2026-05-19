'use client'

import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'
import type { Placement } from '../placement'
import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import {
  overlayIndicatorClassName,
  overlayLabelClassName,
  overlayPopupAnimationClassName,
  overlaySeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

export type { Placement }

export const Combobox = BaseCombobox.Root
export const ComboboxValue = BaseCombobox.Value
export const ComboboxGroup = BaseCombobox.Group
export const ComboboxCollection = BaseCombobox.Collection
export const ComboboxRow = BaseCombobox.Row
export const useComboboxFilter = BaseCombobox.useFilter
export const useComboboxFilteredItems = BaseCombobox.useFilteredItems

export type ComboboxRootProps<Value, Multiple extends boolean | undefined = false>
  = BaseCombobox.Root.Props<Value, Multiple>
export type ComboboxRootChangeEventDetails = BaseCombobox.Root.ChangeEventDetails
export type ComboboxRootHighlightEventDetails = BaseCombobox.Root.HighlightEventDetails

const comboboxPopupClassName = [
  'w-(--anchor-width) max-w-[min(28rem,var(--available-width))] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
  'data-side-top:origin-bottom data-side-bottom:origin-top data-side-left:origin-right data-side-right:origin-left',
]

const comboboxListClassName = [
  'max-h-[min(20rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden scroll-py-1',
  'data-empty:max-h-none data-empty:p-0',
]

const comboboxItemClassName = [
  'mx-1 grid min-h-8 cursor-pointer select-none grid-cols-[1fr_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-text-secondary outline-hidden transition-colors',
  'hover:bg-state-base-hover-alt hover:text-text-primary',
  'data-highlighted:bg-state-base-hover data-highlighted:text-text-primary',
  'data-selected:text-text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-30 data-disabled:hover:bg-transparent data-disabled:hover:text-text-secondary',
  'motion-reduce:transition-none',
]

const comboboxTriggerVariants = cva(
  [
    'group/combobox-trigger flex w-full min-w-0 items-center border-0 bg-components-input-bg-normal text-left text-components-input-text-filled outline-hidden transition-colors',
    'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-open:bg-state-base-hover-alt',
    'focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
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

export type ComboboxSize = NonNullable<VariantProps<typeof comboboxTriggerVariants>['size']>

type ComboboxTriggerProps
  = Omit<BaseCombobox.Trigger.Props, 'className'>
    & VariantProps<typeof comboboxTriggerVariants>
    & {
      className?: string
      icon?: ReactNode | false
    }

export function ComboboxTrigger({
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
      <span className="min-w-0 grow truncate">
        {children}
      </span>
      {icon !== false && (
        <BaseCombobox.Icon className="shrink-0 text-text-quaternary transition-colors group-hover/combobox-trigger:text-text-secondary group-data-open/combobox-trigger:text-text-secondary group-data-readonly/combobox-trigger:hidden">
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
    'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
    'data-focused:border-components-input-border-active data-focused:bg-components-input-bg-active data-focused:shadow-xs',
    'data-open:border-components-input-border-active data-open:bg-components-input-bg-active',
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

export type ComboboxInputGroupProps
  = BaseCombobox.InputGroup.Props
    & VariantProps<typeof comboboxInputGroupVariants>

export function ComboboxInputGroup({
  className,
  size = 'medium',
  ...props
}: ComboboxInputGroupProps) {
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
        medium: 'px-3 py-[7px] system-sm-regular',
        large: 'px-4 py-2 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type ComboboxInputProps
  = Omit<BaseCombobox.Input.Props, 'size'>
    & VariantProps<typeof comboboxInputVariants>

export function ComboboxInput({
  className,
  size = 'medium',
  type = 'text',
  autoComplete = 'off',
  ...props
}: ComboboxInputProps) {
  return (
    <BaseCombobox.Input
      type={type}
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
    'focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-disabled/combobox:cursor-not-allowed group-data-disabled/combobox:hover:bg-transparent group-data-disabled/combobox:focus-visible:bg-transparent group-data-disabled/combobox:focus-visible:ring-0',
    'group-data-readonly/combobox:hidden',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'mr-1 size-4',
        medium: 'mr-1.5 size-5',
        large: 'mr-2 size-5',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type ComboboxClearProps
  = Omit<BaseCombobox.Clear.Props, 'className'>
    & VariantProps<typeof comboboxControlVariants>
    & { className?: string }

export function ComboboxClear({
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

export type ComboboxInputTriggerProps
  = Omit<BaseCombobox.Trigger.Props, 'className'>
    & VariantProps<typeof comboboxControlVariants>
    & { className?: string }

export function ComboboxInputTrigger({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: ComboboxInputTriggerProps) {
  return (
    <BaseCombobox.Trigger
      type={type}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Open combobox options')}
      className={cn(comboboxControlVariants({ size }), className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Trigger>
  )
}

export function ComboboxIcon({
  className,
  children,
  ...props
}: BaseCombobox.Icon.Props) {
  return (
    <BaseCombobox.Icon
      className={cn('flex shrink-0 items-center text-text-tertiary', className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseCombobox.Icon>
  )
}

type ComboboxContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  portalProps?: Omit<BaseCombobox.Portal.Props, 'children'>
  positionerProps?: Omit<
    BaseCombobox.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BaseCombobox.Popup.Props,
    'children' | 'className'
  >
}

export function ComboboxContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  portalProps,
  positionerProps,
  popupProps,
}: ComboboxContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseCombobox.Portal {...portalProps}>
      <BaseCombobox.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseCombobox.Popup
          className={cn(
            comboboxPopupClassName,
            overlayPopupAnimationClassName,
            popupClassName,
          )}
          {...popupProps}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  )
}

export function ComboboxList({
  className,
  ...props
}: BaseCombobox.List.Props) {
  return (
    <BaseCombobox.List
      className={cn(comboboxListClassName, className)}
      {...props}
    />
  )
}

export function ComboboxItem({
  className,
  ...props
}: BaseCombobox.Item.Props) {
  return (
    <BaseCombobox.Item
      className={cn(comboboxItemClassName, className)}
      {...props}
    />
  )
}

export type ComboboxItemTextProps = HTMLAttributes<HTMLSpanElement>

export function ComboboxItemText({
  className,
  ...props
}: ComboboxItemTextProps) {
  return (
    <span
      className={cn('min-w-0 grow truncate px-1 system-sm-medium', className)}
      {...props}
    />
  )
}

export function ComboboxItemIndicator({
  className,
  children,
  ...props
}: Omit<BaseCombobox.ItemIndicator.Props, 'children'> & { children?: ReactNode }) {
  return (
    <BaseCombobox.ItemIndicator
      className={cn(overlayIndicatorClassName, className)}
      {...props}
    >
      {children ?? <span className="i-ri-check-line h-4 w-4" aria-hidden="true" />}
    </BaseCombobox.ItemIndicator>
  )
}

export function ComboboxLabel({
  className,
  ...props
}: BaseCombobox.Label.Props) {
  return (
    <BaseCombobox.Label
      className={cn('mb-1 block text-text-secondary system-sm-medium', className)}
      {...props}
    />
  )
}

export function ComboboxGroupLabel({
  className,
  ...props
}: BaseCombobox.GroupLabel.Props) {
  return (
    <BaseCombobox.GroupLabel
      className={cn(overlayLabelClassName, className)}
      {...props}
    />
  )
}

export function ComboboxSeparator({
  className,
  ...props
}: BaseCombobox.Separator.Props) {
  return (
    <BaseCombobox.Separator
      className={cn(overlaySeparatorClassName, className)}
      {...props}
    />
  )
}

export function ComboboxEmpty({
  className,
  ...props
}: BaseCombobox.Empty.Props) {
  return (
    <BaseCombobox.Empty
      className={cn('px-3 py-2 system-sm-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

export function ComboboxStatus({
  className,
  ...props
}: BaseCombobox.Status.Props) {
  return (
    <BaseCombobox.Status
      className={cn('px-3 py-2 system-sm-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

export function ComboboxChips({
  className,
  ...props
}: BaseCombobox.Chips.Props) {
  return (
    <BaseCombobox.Chips
      className={cn('flex w-full min-w-0 flex-wrap items-center gap-1 px-1', className)}
      {...props}
    />
  )
}

export function ComboboxChip({
  className,
  ...props
}: BaseCombobox.Chip.Props) {
  return (
    <BaseCombobox.Chip
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-state-base-hover px-1.5 py-0.5 text-text-secondary system-xs-medium', className)}
      {...props}
    />
  )
}

export function ComboboxChipRemove({
  className,
  children,
  type = 'button',
  ...props
}: BaseCombobox.ChipRemove.Props) {
  return (
    <BaseCombobox.ChipRemove
      type={type}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Remove selected item')}
      className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-sm text-text-tertiary outline-hidden hover:bg-state-base-hover-alt hover:text-text-secondary focus-visible:ring-1 focus-visible:ring-components-input-border-active', className)}
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-3" aria-hidden="true" />}
    </BaseCombobox.ChipRemove>
  )
}
