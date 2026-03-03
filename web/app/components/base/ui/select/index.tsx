'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { Select as BaseSelect } from '@base-ui/react/select'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const Select = BaseSelect.Root
export const SelectValue = BaseSelect.Value
export const SelectGroup = BaseSelect.Group
export const SelectGroupLabel = BaseSelect.GroupLabel
export const SelectSeparator = BaseSelect.Separator

type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger> & {
  clearable?: boolean
  onClear?: () => void
  loading?: boolean
}

export function SelectTrigger({
  className,
  children,
  clearable = false,
  onClear,
  loading = false,
  ...props
}: SelectTriggerProps) {
  const showClear = clearable && !loading

  return (
    <BaseSelect.Trigger
      className={cn(
        'group relative flex h-8 w-full items-center rounded-lg border-0 bg-components-input-bg-normal px-2 text-left text-components-input-text-filled outline-none',
        'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="grow truncate">{children}</span>
      {loading
        ? (
            <span className="ml-1 shrink-0 text-text-quaternary">
              <span className="i-ri-loader-4-line h-3.5 w-3.5 animate-spin" />
            </span>
          )
        : showClear
          ? (
              <span
                role="button"
                aria-label="Clear selection"
                tabIndex={-1}
                className="ml-1 shrink-0 cursor-pointer text-text-quaternary hover:text-text-secondary"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear?.()
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <span className="i-ri-close-circle-fill h-3.5 w-3.5" />
              </span>
            )
          : (
              <BaseSelect.Icon className="ml-1 shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary data-[open]:text-text-secondary">
                <span className="i-ri-arrow-down-s-line h-4 w-4" />
              </BaseSelect.Icon>
            )}
    </BaseSelect.Trigger>
  )
}

type SelectContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  listClassName?: string
  positionerProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>,
    'children' | 'className'
  >
  listProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BaseSelect.List>,
    'children' | 'className'
  >
}

export function SelectContent({
  children,
  placement = 'bottom-start',
  sideOffset = 4,
  alignOffset = 0,
  className,
  popupClassName,
  listClassName,
  positionerProps,
  popupProps,
  listProps,
}: SelectContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        alignItemWithTrigger={false}
        className={cn('z-50 outline-none', className)}
        {...positionerProps}
      >
        <BaseSelect.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
            popupClassName,
          )}
          {...popupProps}
        >
          <BaseSelect.List
            className={cn('max-h-80 min-w-[10rem] overflow-auto p-1 outline-none', listClassName)}
            {...listProps}
          >
            {children}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      className={cn(
        'flex h-8 cursor-pointer items-center rounded-lg px-2 text-text-secondary outline-none system-sm-medium',
        'data-[disabled]:cursor-not-allowed data-[highlighted]:bg-state-base-hover data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText className="mr-1 grow truncate px-1">
        {children}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="flex shrink-0 items-center text-text-accent">
        <span className="i-ri-check-line h-4 w-4" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}
