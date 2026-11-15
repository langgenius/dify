import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import * as React from 'react'

const BadgeVariants = cva('badge', {
  variants: {
    size: {
      s: 'badge-s',
      m: 'badge-m',
      l: 'badge-l',
    },
  },
  defaultVariants: {
    size: 'm',
  },
})

type BadgeProps = Readonly<{
  size?: 's' | 'm' | 'l'
  iconOnly?: boolean
  uppercase?: boolean
  variant?: 'default' | 'warning' | 'accent'
  styleCss?: CSSProperties
  children?: ReactNode
}> &
  React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof BadgeVariants>

const Badge: React.FC<BadgeProps> = ({
  className,
  size,
  variant = 'default',
  iconOnly = false,
  uppercase = false,
  styleCss,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        BadgeVariants({ size, className }),
        variant === 'warning' && 'badge-warning',
        variant === 'accent' && 'badge-accent',
        size === 's'
          ? iconOnly
            ? 'p-0.75'
            : 'px-1.25 py-0.75'
          : size === 'l'
            ? iconOnly
              ? 'p-1.5'
              : 'px-2 py-1'
            : iconOnly
              ? 'p-1'
              : 'px-1.25 py-0.5',
        uppercase ? 'system-2xs-medium-uppercase' : 'system-2xs-medium',
      )}
      style={styleCss}
      {...props}
    >
      {children}
    </div>
  )
}
Badge.displayName = 'Badge'

export default Badge
export { Badge }
