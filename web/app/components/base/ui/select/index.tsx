'use client'

import type { VariantProps } from 'class-variance-authority'
import type { Placement } from '@/app/components/base/ui/placement'
import { Select as BaseSelect } from '@base-ui/react/select'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const Select = BaseSelect.Root
export const SelectValue = BaseSelect.Value
export const SelectGroup = BaseSelect.Group
export const SelectGroupLabel = BaseSelect.GroupLabel
export const SelectSeparator = BaseSelect.Separator

export const selectTriggerVariants = cva(
  '',
  {
    variants: {
      size: {
        small: 'h-6 gap-px rounded-md px-[5px] py-0 system-xs-regular',
        regular: 'h-8 gap-0.5 rounded-lg px-2 py-1 system-sm-regular',
        large: 'h-9 gap-0.5 rounded-[10px] px-2.5 py-1 system-md-regular',
      },
      variant: {
        default: '',
        destructive: 'border border-components-input-border-destructive bg-components-input-bg-destructive shadow-xs hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive',
      },
    },
    defaultVariants: {
      size: 'regular',
      variant: 'default',
    },
  },
)

const contentPadding: Record<string, string> = {
  small: 'px-[3px] py-1',
  regular: 'p-1',
  large: 'px-1.5 py-1',
}

type SelectTriggerProps = React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger> & {
  clearable?: boolean
  onClear?: () => void
  loading?: boolean
} & VariantProps<typeof selectTriggerVariants>

export function SelectTrigger({
  className,
  children,
  size = 'regular',
  variant = 'default',
  clearable = false,
  onClear,
  loading = false,
  ...props
}: SelectTriggerProps) {
  const paddingClass = contentPadding[size ?? 'regular']
  const isDestructive = variant === 'destructive'

  let trailingIcon: React.ReactNode = null
  if (loading) {
    trailingIcon = (
      <span className="shrink-0 text-text-quaternary" aria-hidden="true">
        <span className="i-ri-loader-4-line h-3.5 w-3.5 animate-spin" />
      </span>
    )
  }
  else if (isDestructive) {
    trailingIcon = (
      <span className="shrink-0 text-text-destructive-secondary" aria-hidden="true">
        <span className="i-ri-error-warning-line h-4 w-4" />
      </span>
    )
  }
  else if (clearable) {
    trailingIcon = (
      <span
        role="button"
        aria-label="Clear selection"
        tabIndex={-1}
        className="shrink-0 cursor-pointer text-text-quaternary hover:text-text-secondary group-data-[disabled]:hidden group-data-[readonly]:hidden"
        onClick={(e) => {
          e.stopPropagation()
          onClear?.()
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <span className="i-ri-close-circle-fill h-3.5 w-3.5" aria-hidden="true" />
      </span>
    )
  }
  else {
    trailingIcon = (
      <BaseSelect.Icon className="shrink-0 text-text-quaternary transition-colors group-hover:text-text-secondary data-[open]:text-text-secondary group-data-[readonly]:hidden">
        <span className="i-ri-arrow-down-s-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.Icon>
    )
  }

  return (
    <BaseSelect.Trigger
      className={cn(
        'group relative flex w-full items-center border-0 bg-components-input-bg-normal text-left text-components-input-text-filled outline-none',
        'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt',
        'data-[placeholder]:text-components-input-text-placeholder',
        selectTriggerVariants({ size, variant }),
        'data-[readonly]:cursor-default data-[readonly]:bg-transparent data-[readonly]:hover:bg-transparent',
        'data-[disabled]:cursor-not-allowed data-[disabled]:bg-components-input-bg-disabled data-[disabled]:text-components-input-text-filled-disabled data-[disabled]:hover:bg-components-input-bg-disabled',
        'data-[disabled]:data-[placeholder]:text-components-input-text-disabled',
        className,
      )}
      {...props}
    >
      <span className={cn('min-w-0 grow truncate', paddingClass)}>
        {children}
      </span>
      {trailingIcon}
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
        className={cn('z-[1002] outline-none', className)}
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
      <BaseSelect.ItemText className="mr-1 min-w-0 grow truncate px-1">
        {children}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="flex shrink-0 items-center text-text-accent">
        <span className="i-ri-check-line h-4 w-4" aria-hidden="true" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}
