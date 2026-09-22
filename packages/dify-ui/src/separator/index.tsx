'use client'

import { Separator as BaseSeparator } from '@base-ui/react/separator'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'

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

type SeparatorProps = BaseSeparator.Props & {
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
      className={(state) =>
        cn(separatorVariants({ orientation, variant }), resolveClassName(className, state))
      }
      {...props}
    />
  )
}

export { Separator }
export type { SeparatorProps }
