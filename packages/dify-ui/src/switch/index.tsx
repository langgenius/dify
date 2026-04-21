'use client'

import type { Switch as BaseSwitchNS } from '@base-ui/react/switch'
import type { VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const switchRootStateClassName = 'bg-components-toggle-bg-unchecked hover:bg-components-toggle-bg-unchecked-hover data-checked:bg-components-toggle-bg data-checked:hover:bg-components-toggle-bg-hover data-disabled:cursor-not-allowed data-disabled:bg-components-toggle-bg-unchecked-disabled data-disabled:hover:bg-components-toggle-bg-unchecked-disabled data-disabled:data-checked:bg-components-toggle-bg-disabled data-disabled:data-checked:hover:bg-components-toggle-bg-disabled'

const switchRootVariants = cva(
  `group relative inline-flex shrink-0 cursor-pointer touch-manipulation items-center transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-components-toggle-bg motion-reduce:transition-none ${switchRootStateClassName}`,
  {
    variants: {
      size: {
        xs: 'h-2.5 w-3.5 rounded-xs p-0.5',
        sm: 'h-3 w-5 rounded-[3.5px] p-0.5',
        md: 'h-4 w-7 rounded-[5px] p-0.5',
        lg: 'h-5 w-9 rounded-md p-[3px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

const switchThumbVariants = cva(
  'block bg-components-toggle-knob shadow-sm transition-transform duration-200 ease-in-out group-hover:bg-components-toggle-knob-hover group-hover:shadow-md group-data-disabled:bg-components-toggle-knob-disabled group-data-disabled:shadow-none motion-reduce:transition-none',
  {
    variants: {
      size: {
        xs: 'h-1.5 w-1 rounded-[1px] data-checked:translate-x-1.5',
        sm: 'h-2 w-[7px] rounded-xs data-checked:translate-x-[9px]',
        md: 'h-3 w-2.5 rounded-[3px] data-checked:translate-x-[14px]',
        lg: 'size-3.5 rounded-sm data-checked:translate-x-4',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

export type SwitchSize = NonNullable<VariantProps<typeof switchRootVariants>['size']>

const spinnerSizeConfig: Partial<Record<SwitchSize, {
  icon: string
  uncheckedPosition: string
  checkedPosition: string
}>> = {
  md: {
    icon: 'size-2',
    uncheckedPosition: 'left-[calc(50%+6px)]',
    checkedPosition: 'left-[calc(50%-6px)]',
  },
  lg: {
    icon: 'size-2.5',
    uncheckedPosition: 'left-[calc(50%+8px)]',
    checkedPosition: 'left-[calc(50%-8px)]',
  },
}

export type SwitchProps
  = Omit<BaseSwitchNS.Root.Props, 'className' | 'size' | 'onCheckedChange'>
    & VariantProps<typeof switchRootVariants>
    & {
      onCheckedChange?: (checked: boolean) => void
      loading?: boolean
      className?: string
    }

export function Switch({
  checked,
  size = 'md',
  disabled,
  loading = false,
  className,
  onCheckedChange,
  ...props
}: SwitchProps) {
  const isDisabled = disabled || loading
  const spinner = loading && size ? spinnerSizeConfig[size] : undefined

  return (
    <BaseSwitch.Root
      checked={checked}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(switchRootVariants({ size }), className)}
      onCheckedChange={value => onCheckedChange?.(value)}
      {...props}
    >
      <BaseSwitch.Thumb
        className={switchThumbVariants({ size })}
      />
      {spinner
        ? (
            <span
              className={cn(
                'absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
                spinner.icon,
                checked ? spinner.checkedPosition : spinner.uncheckedPosition,
              )}
              aria-hidden="true"
            >
              <i className="i-ri-loader-2-line size-full animate-spin text-text-tertiary motion-reduce:animate-none" />
            </span>
          )
        : null}
    </BaseSwitch.Root>
  )
}

const switchSkeletonVariants = cva(
  'bg-text-quaternary opacity-20',
  {
    variants: {
      size: {
        xs: 'h-2.5 w-3.5 rounded-xs',
        sm: 'h-3 w-5 rounded-[3.5px]',
        md: 'h-4 w-7 rounded-[5px]',
        lg: 'h-5 w-9 rounded-md',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

export type SwitchSkeletonProps
  = Omit<HTMLAttributes<HTMLDivElement>, 'className'>
    & VariantProps<typeof switchSkeletonVariants>
    & {
      className?: string
    }

export function SwitchSkeleton({
  size = 'md',
  className,
  ...props
}: SwitchSkeletonProps) {
  return (
    <div
      className={cn(switchSkeletonVariants({ size }), className)}
      {...props}
    />
  )
}
