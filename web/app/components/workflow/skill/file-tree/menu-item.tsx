'use client'

import type { VariantProps } from 'class-variance-authority'
import type { FC } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

const menuItemVariants = cva(
  [
    'flex w-full items-center gap-2 rounded-lg px-3 py-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-components-input-border-active',
  ],
  {
    variants: {
      variant: {
        default: 'hover:bg-state-base-hover',
        destructive: 'group hover:bg-state-destructive-hover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const iconVariants = cva('size-4 text-text-tertiary', {
  variants: {
    variant: {
      default: '',
      destructive: 'group-hover:text-text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

const labelVariants = cva('system-sm-regular text-text-secondary', {
  variants: {
    variant: {
      default: '',
      destructive: 'group-hover:text-text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type MenuItemProps = {
  icon: React.ElementType
  label: string
  onClick: () => void
  disabled?: boolean
} & VariantProps<typeof menuItemVariants>

const MenuItem: FC<MenuItemProps> = ({ icon: Icon, label, onClick, disabled, variant }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(menuItemVariants({ variant }))}
  >
    <Icon className={cn(iconVariants({ variant }))} aria-hidden="true" />
    <span className={cn(labelVariants({ variant }))}>{label}</span>
  </button>
)

export default React.memo(MenuItem)
