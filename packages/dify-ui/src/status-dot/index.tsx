'use client'

import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const statusDotVariants = cva(
  'block shrink-0 border border-solid',
  {
    variants: {
      status: {
        success: 'border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg shadow-status-indicator-green-shadow',
        warning: 'border-components-badge-status-light-warning-border-inner bg-components-badge-status-light-warning-bg shadow-status-indicator-warning-shadow',
        error: 'border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg shadow-status-indicator-red-shadow',
        normal: 'border-components-badge-status-light-normal-border-inner bg-components-badge-status-light-normal-bg shadow-status-indicator-blue-shadow',
        disabled: 'border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg shadow-status-indicator-gray-shadow',
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
  },
)

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

export type StatusDotStatus = NonNullable<StatusDotVariants['status']>
export type StatusDotSize = NonNullable<StatusDotVariants['size']>

export type StatusDotProps
  = Omit<ComponentProps<'span'>, 'children'>
    & {
      status?: StatusDotStatus
      size?: StatusDotSize
    }

export type StatusDotSkeletonProps
  = Omit<ComponentProps<'span'>, 'children'>
    & {
      size?: StatusDotSize
    }

export function StatusDot({
  className,
  status = 'success',
  size = 'medium',
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: StatusDotProps) {
  const hidden = ariaHidden ?? (ariaLabel || ariaLabelledBy ? undefined : true)

  return (
    <span
      className={cn(
        statusDotVariants({ status, size }),
        className,
      )}
      aria-hidden={hidden}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      {...props}
    />
  )
}

export function StatusDotSkeleton({
  className,
  size = 'medium',
  'aria-hidden': ariaHidden,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...props
}: StatusDotSkeletonProps) {
  const hidden = ariaHidden ?? (ariaLabel || ariaLabelledBy ? undefined : true)

  return (
    <span
      className={cn(statusDotSkeletonVariants({ size }), className)}
      aria-hidden={hidden}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      {...props}
    />
  )
}
