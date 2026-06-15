'use client'

import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const kbdVariants = cva(
  'pointer-events-none inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-px font-sans system-kbd capitalize not-italic select-none',
  {
    variants: {
      color: {
        gray: 'bg-components-kbd-bg-gray text-text-tertiary',
        white: 'bg-components-kbd-bg-white text-text-primary-on-surface',
      },
      disabled: {
        true: 'opacity-30',
        false: '',
      },
    },
    defaultVariants: {
      color: 'gray',
      disabled: false,
    },
  },
)

export type KbdColor = NonNullable<VariantProps<typeof kbdVariants>['color']>

export type KbdProps = Omit<React.ComponentProps<'kbd'>, 'color'> & VariantProps<typeof kbdVariants>

export function Kbd({ className, color, disabled, ...props }: KbdProps) {
  return (
    <kbd
      data-disabled={disabled ? '' : undefined}
      className={cn(kbdVariants({ color, disabled, className }))}
      {...props}
    />
  )
}

export type KbdGroupProps = React.ComponentProps<'span'>

export function KbdGroup({ className, ...props }: KbdGroupProps) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 align-middle', className)} {...props} />
  )
}
