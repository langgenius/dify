'use client'

import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes, ReactNode } from 'react'
import type { Placement } from '../placement'
import { Autocomplete as BaseAutocomplete } from '@base-ui/react/autocomplete'
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

export const Autocomplete = BaseAutocomplete.Root
export const AutocompleteValue = BaseAutocomplete.Value
export const AutocompleteGroup = BaseAutocomplete.Group
export const AutocompleteCollection = BaseAutocomplete.Collection
export const AutocompleteRow = BaseAutocomplete.Row
export const useAutocompleteFilter = BaseAutocomplete.useFilter
export const useAutocompleteFilteredItems = BaseAutocomplete.useFilteredItems

export type AutocompleteRootProps<ItemValue> = BaseAutocomplete.Root.Props<ItemValue>
export type AutocompleteRootChangeEventDetails = BaseAutocomplete.Root.ChangeEventDetails
export type AutocompleteRootHighlightEventDetails = BaseAutocomplete.Root.HighlightEventDetails

const autocompletePopupClassName = [
  'w-(--anchor-width) max-w-[min(28rem,var(--available-width))] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
  'data-side-top:origin-bottom data-side-bottom:origin-top data-side-left:origin-right data-side-right:origin-left',
]

const autocompleteListClassName = [
  'max-h-[min(20rem,var(--available-height))] overflow-y-auto overflow-x-hidden overscroll-contain p-1 outline-hidden scroll-py-1',
  'data-empty:max-h-none data-empty:p-0',
]

const autocompleteItemClassName = [
  'mx-1 flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-text-secondary outline-hidden transition-colors',
  'hover:bg-state-base-hover-alt hover:text-text-primary',
  'data-highlighted:bg-state-base-hover data-highlighted:text-text-primary',
  'data-disabled:cursor-not-allowed data-disabled:opacity-30 data-disabled:hover:bg-transparent data-disabled:hover:text-text-secondary',
  'motion-reduce:transition-none',
]

const autocompleteInputGroupVariants = cva(
  [
    'group/autocomplete flex w-full min-w-0 items-center border border-transparent bg-components-input-bg-normal text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
    'data-focused:border-components-input-border-active data-focused:bg-components-input-bg-active data-focused:shadow-xs',
    'data-disabled:cursor-not-allowed data-disabled:border-transparent data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled',
    'data-disabled:hover:border-transparent data-disabled:hover:bg-components-input-bg-disabled',
    'data-readonly:shadow-none data-readonly:hover:border-transparent data-readonly:hover:bg-components-input-bg-normal',
    'motion-reduce:transition-none',
  ],
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

export type AutocompleteSize = NonNullable<VariantProps<typeof autocompleteInputGroupVariants>['size']>

export type AutocompleteInputGroupProps
  = BaseAutocomplete.InputGroup.Props
    & VariantProps<typeof autocompleteInputGroupVariants>

export function AutocompleteInputGroup({
  className,
  size = 'medium',
  ...props
}: AutocompleteInputGroupProps) {
  return (
    <BaseAutocomplete.InputGroup
      className={cn(autocompleteInputGroupVariants({ size }), className)}
      {...props}
    />
  )
}

const autocompleteInputVariants = cva(
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

export type AutocompleteInputProps
  = Omit<BaseAutocomplete.Input.Props, 'size'>
    & VariantProps<typeof autocompleteInputVariants>

export function AutocompleteInput({
  className,
  size = 'medium',
  type = 'text',
  autoComplete = 'off',
  ...props
}: AutocompleteInputProps) {
  return (
    <BaseAutocomplete.Input
      type={type}
      autoComplete={autoComplete}
      className={cn(autocompleteInputVariants({ size }), className)}
      {...props}
    />
  )
}

const autocompleteControlVariants = cva(
  [
    'flex shrink-0 touch-manipulation items-center justify-center rounded-md text-text-tertiary outline-hidden transition-colors',
    'hover:bg-components-input-bg-hover hover:text-text-secondary focus-visible:bg-components-input-bg-hover focus-visible:text-text-secondary',
    'focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:ring-inset',
    'disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-tertiary disabled:focus-visible:bg-transparent disabled:focus-visible:ring-0',
    'group-data-disabled/autocomplete:cursor-not-allowed group-data-disabled/autocomplete:hover:bg-transparent group-data-disabled/autocomplete:focus-visible:bg-transparent group-data-disabled/autocomplete:focus-visible:ring-0',
    'group-data-readonly/autocomplete:hidden',
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

export type AutocompleteControlProps
  = Omit<BaseAutocomplete.Trigger.Props, 'className'>
    & VariantProps<typeof autocompleteControlVariants>
    & { className?: string }

export function AutocompleteTrigger({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: AutocompleteControlProps) {
  return (
    <BaseAutocomplete.Trigger
      type={type}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Open autocomplete suggestions')}
      className={cn(autocompleteControlVariants({ size }), className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Trigger>
  )
}

export type AutocompleteClearProps
  = Omit<BaseAutocomplete.Clear.Props, 'className'>
    & VariantProps<typeof autocompleteControlVariants>
    & { className?: string }

export function AutocompleteClear({
  className,
  children,
  size = 'medium',
  type = 'button',
  ...props
}: AutocompleteClearProps) {
  return (
    <BaseAutocomplete.Clear
      type={type}
      aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Clear autocomplete')}
      className={cn(
        autocompleteControlVariants({ size }),
        'data-ending-style:opacity-0 data-starting-style:opacity-0',
        className,
      )}
      {...props}
    >
      {children ?? <span className="i-ri-close-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Clear>
  )
}

export function AutocompleteIcon({
  className,
  children,
  ...props
}: BaseAutocomplete.Icon.Props) {
  return (
    <BaseAutocomplete.Icon
      className={cn('flex shrink-0 items-center text-text-tertiary', className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-down-s-line size-4" aria-hidden="true" />}
    </BaseAutocomplete.Icon>
  )
}

type AutocompleteContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  portalProps?: Omit<BaseAutocomplete.Portal.Props, 'children'>
  positionerProps?: Omit<
    BaseAutocomplete.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BaseAutocomplete.Popup.Props,
    'children' | 'className'
  >
}

export function AutocompleteContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  portalProps,
  positionerProps,
  popupProps,
}: AutocompleteContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseAutocomplete.Portal {...portalProps}>
      <BaseAutocomplete.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BaseAutocomplete.Popup
          className={cn(
            autocompletePopupClassName,
            overlayPopupAnimationClassName,
            popupClassName,
          )}
          {...popupProps}
        >
          {children}
        </BaseAutocomplete.Popup>
      </BaseAutocomplete.Positioner>
    </BaseAutocomplete.Portal>
  )
}

export function AutocompleteList({
  className,
  ...props
}: BaseAutocomplete.List.Props) {
  return (
    <BaseAutocomplete.List
      className={cn(autocompleteListClassName, className)}
      {...props}
    />
  )
}

export function AutocompleteItem({
  className,
  ...props
}: BaseAutocomplete.Item.Props) {
  return (
    <BaseAutocomplete.Item
      className={cn(autocompleteItemClassName, className)}
      {...props}
    />
  )
}

export type AutocompleteItemTextProps = HTMLAttributes<HTMLSpanElement>

export function AutocompleteItemText({
  className,
  ...props
}: AutocompleteItemTextProps) {
  return (
    <span
      className={cn('min-w-0 grow truncate px-1 system-sm-medium', className)}
      {...props}
    />
  )
}

export function AutocompleteLabel({
  className,
  ...props
}: BaseAutocomplete.GroupLabel.Props) {
  return (
    <BaseAutocomplete.GroupLabel
      className={cn(overlayLabelClassName, className)}
      {...props}
    />
  )
}

export function AutocompleteSeparator({
  className,
  ...props
}: BaseAutocomplete.Separator.Props) {
  return (
    <BaseAutocomplete.Separator
      className={cn(overlaySeparatorClassName, className)}
      {...props}
    />
  )
}

export function AutocompleteEmpty({
  className,
  ...props
}: BaseAutocomplete.Empty.Props) {
  return (
    <BaseAutocomplete.Empty
      className={cn('px-3 py-2 system-sm-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

export function AutocompleteStatus({
  className,
  ...props
}: BaseAutocomplete.Status.Props) {
  return (
    <BaseAutocomplete.Status
      className={cn('px-3 py-2 system-sm-regular text-text-tertiary', className)}
      {...props}
    />
  )
}

export function AutocompleteItemIndicator({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(overlayIndicatorClassName, className)}
      {...props}
    >
      {children ?? <span className="i-ri-arrow-right-line size-4" aria-hidden="true" />}
    </span>
  )
}
