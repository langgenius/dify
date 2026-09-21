'use client'

import { Separator as BaseSeparator } from '@base-ui/react/separator'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const separatorVariants = cva('shrink-0', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
    variant: {
      solid: 'bg-divider-regular',
      gradient: 'bg-linear-to-r from-divider-regular to-background-gradient-mask-transparent',
    },
  },
})

type SeparatorProps = Omit<BaseSeparator.Props, 'className'> & {
  className?: string
  /** Set true for visual lines that do not separate content groups. */
  decorative?: boolean
  variant?: 'solid' | 'gradient'
}

function Separator({
  decorative = false,
  orientation = 'horizontal',
  variant = 'solid',
  className,
  ...props
}: SeparatorProps) {
  return (
    <BaseSeparator
      orientation={orientation}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(separatorVariants({ orientation, variant }), className)}
      {...props}
    />
  )
}

export { Separator }
export type { SeparatorProps }
