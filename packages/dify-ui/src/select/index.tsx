'use client'

import type { ComponentRenderFn, HTMLProps } from '@base-ui/react/types'
import type { VariantProps } from 'class-variance-authority'
import type { Placement } from '../placement'
import { Select as BaseSelect } from '@base-ui/react/select'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'
import { formLabelClassName } from '../form-control-shared'
import {
  floatingGroupLabelClassName,
  floatingItemIndicatorClassName,
  floatingPopupAnimationClassName,
  floatingSeparatorClassName,
} from '../overlay-shared'
import { parsePlacement } from '../placement'

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
  | (Multiple extends true ? Value[] : Value)
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

const selectTriggerVariants = cva(
  [
    'group flex w-full items-center border-0 bg-components-input-bg-normal text-start text-components-input-text-filled outline-hidden',
    'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
    'focus-visible:ring-2 focus-visible:ring-state-accent-solid',
    'data-placeholder:text-components-input-text-placeholder',
    'data-readonly:cursor-default data-readonly:bg-components-input-bg-normal data-readonly:hover:bg-components-input-bg-normal',
    'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
    'data-disabled:data-placeholder:text-components-input-text-disabled',
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

type SelectSize = NonNullable<VariantProps<typeof selectTriggerVariants>['size']>
type SelectTriggerProps = Omit<BaseSelect.Trigger.Props, 'className'> & {
  className?: string
  size?: SelectSize
}

function SelectTrigger({ className, children, size, ...props }: SelectTriggerProps) {
  return (
    <BaseSelect.Trigger className={cn(selectTriggerVariants({ size, className }))} {...props}>
      <span className="min-w-0 grow truncate">{children}</span>
      <BaseSelect.Icon className="shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary group-data-readonly:hidden data-popup-open:text-text-secondary">
        <span className="i-ri-arrow-down-s-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

type SelectLabelProps = Omit<BaseSelect.Label.Props, 'className'> & { className?: string }

function SelectLabel({ className, ...props }: SelectLabelProps) {
  return <BaseSelect.Label className={cn(formLabelClassName, className)} {...props} />
}

type SelectGroupLabelProps = Omit<BaseSelect.GroupLabel.Props, 'className'> & {
  className?: string
}

function SelectGroupLabel({ className, ...props }: SelectGroupLabelProps) {
  return <BaseSelect.GroupLabel className={cn(floatingGroupLabelClassName, className)} {...props} />
}

type SelectSeparatorProps = Omit<BaseSelect.Separator.Props, 'className'> & { className?: string }

function SelectSeparator({ className, ...props }: SelectSeparatorProps) {
  return <BaseSelect.Separator className={cn(floatingSeparatorClassName, className)} {...props} />
}

const SelectPortal = BaseSelect.Portal
type SelectPortalProps = BaseSelect.Portal.Props

type SelectPositionerProps = Omit<BaseSelect.Positioner.Props, 'className' | 'side' | 'align'> & {
  className?: string
  placement?: Placement
}

function SelectPositioner({
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  alignItemWithTrigger = false,
  className,
  ...props
}: SelectPositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseSelect.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      className={cn('z-50 outline-hidden', className)}
      {...props}
    />
  )
}

type SelectPopupProps = Omit<BaseSelect.Popup.Props, 'className'> & {
  className?: string
}

function SelectPopup({ className, ...props }: SelectPopupProps) {
  return (
    <BaseSelect.Popup
      className={cn(
        'max-w-(--available-width) min-w-[min(var(--anchor-width),var(--available-width))] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg outline-hidden',
        floatingPopupAnimationClassName,
        className,
      )}
      {...props}
    />
  )
}

type SelectListProps = Omit<BaseSelect.List.Props, 'className'> & {
  className?: string
}

function SelectList({ className, ...props }: SelectListProps) {
  return (
    <BaseSelect.List
      className={cn('max-h-80 overflow-auto p-1 outline-hidden', className)}
      {...props}
    />
  )
}

type SelectContentProps = Omit<SelectPopupProps, 'children' | 'className'> &
  Pick<SelectPositionerProps, 'alignOffset' | 'placement' | 'sideOffset'> & {
    children: React.ReactNode
    className?: string
  }

function SelectContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  ...props
}: SelectContentProps) {
  return (
    <SelectPortal>
      <SelectPositioner placement={placement} sideOffset={sideOffset} alignOffset={alignOffset}>
        <SelectPopup className={className} {...props}>
          <SelectList>{children}</SelectList>
        </SelectPopup>
      </SelectPositioner>
    </SelectPortal>
  )
}

type SelectItemProps<Value = unknown> = Omit<BaseSelect.Item.Props, 'className' | 'value'> & {
  className?: string
  value?: Value
}

function SelectItem<Value = unknown>({ className, ...props }: SelectItemProps<Value>) {
  return (
    <BaseSelect.Item
      className={cn(
        'flex h-8 cursor-pointer items-center rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-state-base-hover',
        className,
      )}
      {...props}
    />
  )
}

type SelectItemTextProps = Omit<BaseSelect.ItemText.Props, 'className'> & { className?: string }

function SelectItemText({ className, ...props }: SelectItemTextProps) {
  return (
    <BaseSelect.ItemText className={cn('me-1 min-w-0 grow truncate px-1', className)} {...props} />
  )
}

type SelectItemIndicatorProps = Omit<BaseSelect.ItemIndicator.Props, 'children' | 'className'> & {
  className?: string
}

function SelectItemIndicator({ className, ...props }: SelectItemIndicatorProps) {
  return (
    <BaseSelect.ItemIndicator className={cn(floatingItemIndicatorClassName, className)} {...props}>
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
  SelectContentProps,
  SelectGroupLabelProps,
  SelectGroupProps,
  SelectItemIndicatorProps,
  SelectItemProps,
  SelectItemTextProps,
  SelectLabelProps,
  SelectListProps,
  SelectPopupProps,
  SelectPortalProps,
  SelectPositionerProps,
  SelectProps,
  SelectSeparatorProps,
  SelectTriggerProps,
  SelectValueProps,
}
