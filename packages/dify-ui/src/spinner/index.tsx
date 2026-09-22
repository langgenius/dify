'use client'

import type * as React from 'react'
import { Progress as BaseProgress } from '@base-ui/react/progress'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const spinnerVariants = cva('inline-flex shrink-0 text-[#1c64f2]', {
  variants: {
    size: {
      small: 'size-3',
      medium: 'size-4',
      large: 'size-5',
    },
  },
  defaultVariants: { size: 'medium' },
})

type SpinnerAppearanceProps = {
  size?: 'small' | 'medium' | 'large'
  className?: string
}

type SpinnerIconProps = SpinnerAppearanceProps

type SpinnerProps = SpinnerAppearanceProps &
  Pick<React.ComponentProps<'div'>, 'id' | 'aria-describedby'> &
  (
    | { 'aria-label': string; 'aria-labelledby'?: never }
    | { 'aria-label'?: never; 'aria-labelledby': string }
  )

function SpinnerIcon({ size = 'medium', className }: SpinnerIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={cn(spinnerVariants({ size }), className)}
      data-dify-spinner=""
    >
      <rect x="9" width="7" height="7" rx="1" />
      <rect x="9" y="9" width="7" height="7" rx="1" opacity="0.5" />
      <rect y="9" width="7" height="7" rx="1" opacity="0.1" />
      <rect width="7" height="7" rx="1" opacity="0.2" />
    </svg>
  )
}

function Spinner({ size = 'medium', className, ...props }: SpinnerProps) {
  return (
    <BaseProgress.Root
      {...props}
      value={null}
      aria-valuetext={undefined}
      className={cn(spinnerVariants({ size }), className)}
    >
      <SpinnerIcon className="size-full text-current" />
    </BaseProgress.Root>
  )
}

export { Spinner, SpinnerIcon }
export type { SpinnerIconProps, SpinnerProps }
