'use client'

import type { ComponentRenderFn, HTMLProps } from '@base-ui/react/types'
import type * as React from 'react'
import type { SelectSize } from '../internal/select-trigger-style'
import { Select as BaseSelect } from '@base-ui/react/select'
import { cn } from '../cn'
import { formLabelClassName } from '../internal/form-control'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
  positionerClassName,
} from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'
import { selectTriggerIconClassName, selectTriggerVariants } from '../internal/select-trigger-style'

type SelectActions = BaseSelect.Root.Actions
type SelectChangeEventReason = BaseSelect.Root.ChangeEventReason
type SelectChangeEventDetails = BaseSelect.Root.ChangeEventDetails
type SelectOpenChangeEventDetails = BaseSelect.Root.OpenChangeEventDetails

type SelectProps<Value, Multiple extends boolean | undefined = false> = BaseSelect.Root.Props<
  Value,
  Multiple
> &
  ([Multiple] extends [true] ? { multiple: true } : unknown)

function Select<Value, Multiple extends boolean | undefined = false>(
  props: SelectProps<Value, Multiple>,
): React.JSX.Element {
  return <BaseSelect.Root {...props} />
}

const SelectGroup = BaseSelect.Group

type SelectSelectedValue<Value, Multiple extends boolean | undefined = false> =
  | (Multiple extends true ? readonly Value[] : Value)
  | null
type SelectValueState<Value = unknown, Multiple extends boolean | undefined = false> = Omit<
  BaseSelect.Value.State,
  'value'
> & {
  value: SelectSelectedValue<Value, Multiple>
}
type SelectValueProps<Value = unknown, Multiple extends boolean | undefined = false> = Omit<
  BaseSelect.Value.Props,
  'children' | 'className' | 'render' | 'style'
> & {
  children?: React.ReactNode | ((value: SelectSelectedValue<Value, Multiple>) => React.ReactNode)
  className?: string | ((state: SelectValueState<Value, Multiple>) => string | undefined)
  render?:
    | React.ReactElement
    | ComponentRenderFn<HTMLProps<HTMLSpanElement>, SelectValueState<Value, Multiple>>
  style?:
    | React.CSSProperties
    | ((state: SelectValueState<Value, Multiple>) => React.CSSProperties | undefined)
}
function SelectValue<Value = unknown, Multiple extends boolean | undefined = false>(
  props: SelectValueProps<Value, Multiple>,
): React.JSX.Element
function SelectValue(props: BaseSelect.Value.Props): React.JSX.Element {
  return <BaseSelect.Value {...props} />
}
type SelectGroupProps = BaseSelect.Group.Props

type SelectTriggerProps = BaseSelect.Trigger.Props & {
  size?: SelectSize
}

function SelectTrigger({ className, children, size, ...props }: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger
      className={(state) =>
        cn(selectTriggerVariants({ size, className: resolveClassName(className, state) }))
      }
      {...props}
    >
      <span className="min-w-0 grow truncate">{children}</span>
      <BaseSelect.Icon className={selectTriggerIconClassName}>
        <span className="i-ri-arrow-down-s-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

type SelectLabelProps = BaseSelect.Label.Props

function SelectLabel({ className, ...props }: SelectLabelProps) {
  return (
    <BaseSelect.Label
      className={(state) => cn(formLabelClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type SelectGroupLabelProps = BaseSelect.GroupLabel.Props

// The list's own padding supplies the rest of the inset, so the label text lines up with the
// item text.
function SelectGroupLabel({ className, ...props }: SelectGroupLabelProps) {
  return (
    <BaseSelect.GroupLabel
      className={(state) =>
        cn(floatingGroupLabelClassName, 'px-2', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

type SelectSeparatorProps = BaseSelect.Separator.Props

function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return (
    <BaseSelect.Separator
      className={(state) => cn(floatingSeparatorClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

const SelectPortal = BaseSelect.Portal
type SelectPortalProps = BaseSelect.Portal.Props

type SelectPositionerProps = BaseSelect.Positioner.Props

function SelectPositioner({
  align = 'start',
  sideOffset = 4,
  alignItemWithTrigger = false,
  className,
  ...props
}: SelectPositionerProps) {
  return (
    <BaseSelect.Positioner
      align={align}
      sideOffset={sideOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className={(state) => cn(positionerClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type SelectPopupProps = BaseSelect.Popup.Props

function SelectPopup({ className, ...props }: SelectPopupProps) {
  return (
    <BaseSelect.Popup
      className={(state) =>
        cn(
          'flex max-h-(--available-height) max-w-(--available-width) min-w-[min(var(--anchor-width),var(--available-width))] flex-col overflow-x-hidden overflow-y-auto rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SelectListProps = BaseSelect.List.Props

function SelectList({ className, ...props }: SelectListProps) {
  return (
    <BaseSelect.List
      className={(state) =>
        cn(
          'max-h-80 scroll-py-1 overflow-auto p-1 outline-hidden',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SelectContentProps = Omit<SelectPopupProps, 'children'> &
  Pick<SelectPositionerProps, 'alignOffset' | 'side' | 'align' | 'sideOffset'> & {
    children: React.ReactNode
  }

function SelectContent({
  children,
  side,
  align,
  sideOffset,
  alignOffset,
  className,
  ...props
}: SelectContentProps) {
  return (
    <SelectPortal>
      <SelectPositioner side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset}>
        <SelectPopup className={className} {...props}>
          <SelectList>{children}</SelectList>
        </SelectPopup>
      </SelectPositioner>
    </SelectPortal>
  )
}

type SelectItemProps<Value = unknown> = Omit<BaseSelect.Item.Props, 'value'> & {
  value?: Value
}

function SelectItem<Value = unknown>({ className, ...props }: SelectItemProps<Value>) {
  return (
    <BaseSelect.Item
      className={(state) =>
        cn(
          'flex h-8 items-center rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden select-none',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-state-base-hover',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SelectItemTextProps = BaseSelect.ItemText.Props

function SelectItemText({ className, ...props }: SelectItemTextProps) {
  return (
    <BaseSelect.ItemText
      className={(state) => cn('me-1 min-w-0 grow truncate', resolveClassName(className, state))}
      {...props}
    />
  )
}

type SelectItemIndicatorProps = Omit<BaseSelect.ItemIndicator.Props, 'children'>

function SelectItemIndicator({ className, ...props }: SelectItemIndicatorProps) {
  return (
    <BaseSelect.ItemIndicator
      className={(state) => cn(floatingItemIndicatorClassName, resolveClassName(className, state))}
      {...props}
    >
      <span className="i-ri-check-line h-4 w-4" aria-hidden />
    </BaseSelect.ItemIndicator>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

export type {
  SelectActions,
  SelectChangeEventDetails,
  SelectChangeEventReason,
  SelectContentProps,
  SelectGroupLabelProps,
  SelectGroupProps,
  SelectItemIndicatorProps,
  SelectItemProps,
  SelectItemTextProps,
  SelectLabelProps,
  SelectListProps,
  SelectOpenChangeEventDetails,
  SelectPopupProps,
  SelectPortalProps,
  SelectPositionerProps,
  SelectProps,
  SelectSeparatorProps,
  SelectTriggerProps,
  SelectValueProps,
}
