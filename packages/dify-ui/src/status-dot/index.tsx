'use client'

import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'

const statusDotVariants = cva('block shrink-0 border border-solid', {
  variants: {
    status: {
      success:
        'border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow',
      warning:
        'border-components-badge-status-light-warning-border-inner bg-components-badge-status-light-warning-bg shadow-status-indicator-warning-shadow',
      error:
        'border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-status-indicator-red-shadow',
      normal:
        'border-components-badge-status-light-normal-border-inner bg-components-badge-status-light-normal-bg shadow-status-indicator-blue-shadow',
      disabled:
        'border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg shadow-status-indicator-gray-shadow',
    },
    size: {
      small: 'size-1.5 rounded-xs',
      medium: 'size-2 rounded-[3px]',
    },
  },
  defaultVariants: {
    status: 'success',
    size: 'medium',
  },
})

const statusDotSkeletonVariants = cva(
  'block shrink-0 border border-transparent bg-text-primary opacity-30',
  {
    variants: {
      size: {
        small: 'size-1.5 rounded-xs',
        medium: 'size-2 rounded-[3px]',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

type StatusDotVariants = VariantProps<typeof statusDotVariants>

type StatusDotStatus = NonNullable<StatusDotVariants['status']>
type StatusDotSize = NonNullable<StatusDotVariants['size']>

type DecorativeSpanProps = Omit<
  React.ComponentProps<'span'>,
  'children' | 'role' | 'tabIndex' | keyof React.AriaAttributes
> & {
  [Key in keyof React.AriaAttributes]?: never
} & {
  role?: never
  tabIndex?: never
}

type StatusDotProps = DecorativeSpanProps & {
  status?: StatusDotStatus
  size?: StatusDotSize
}

type StatusDotSkeletonProps = DecorativeSpanProps & {
  size?: StatusDotSize
}

function StatusDot({ className, status = 'success', size = 'medium', ...props }: StatusDotProps) {
  return (
    <span
      {...props}
      className={cn(statusDotVariants({ status, size }), className)}
      aria-hidden="true"
    />
  )
}

function StatusDotSkeleton({ className, size = 'medium', ...props }: StatusDotSkeletonProps) {
  return (
    <span
      {...props}
      className={cn(statusDotSkeletonVariants({ size }), className)}
      aria-hidden="true"
    />
  )
}

export { StatusDot, StatusDotSkeleton }

export type { StatusDotProps, StatusDotSkeletonProps, StatusDotStatus }
