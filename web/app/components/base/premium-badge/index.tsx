import type { CSSProperties, ReactNode } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import { Highlight } from '@/app/components/base/icons/src/public/common'
import classNames from '@/utils/classnames'
import './index.css'

const PremiumBadgeVariants = cva(
  'premium-badge',
  {
    variants: {
      size: {
        s: 'premium-badge-s',
        m: 'premium-badge-m',
      },
      color: {
        blue: 'premium-badge-blue',
        indigo: 'premium-badge-indigo',
        gray: 'premium-badge-gray',
        orange: 'premium-badge-orange',
      },
      allowHover: {
        true: 'allowHover',
        false: '',
      },
    },
    defaultVariants: {
      size: 'm',
      color: 'blue',
      allowHover: false,
    },
  },
)

type PremiumBadgeProps = {
  size?: 's' | 'm'
  color?: 'blue' | 'indigo' | 'gray' | 'orange'
  allowHover?: boolean
  styleCss?: CSSProperties
  children?: ReactNode
} & React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof PremiumBadgeVariants>

const PremiumBadge: React.FC<PremiumBadgeProps> = ({
  className,
  size,
  color,
  allowHover,
  styleCss,
  children,
  ...props
}) => {
  return (
    <div
      className={classNames(
        PremiumBadgeVariants({ size, color, allowHover, className }),
        'relative text-nowrap',
      )}
      style={styleCss}
      {...props}
    >
      {children}
      <Highlight
        className={classNames(
          'absolute top-0 opacity-50 hover:opacity-80',
          size === 's' ? 'h-4.5 w-12' : 'h-6 w-12',
        )}
        style={{
          right: '50%',
          transform: 'translateX(10%)',
        }}
      />
    </div>
  )
}
PremiumBadge.displayName = 'PremiumBadge'

export default PremiumBadge
export { PremiumBadge, PremiumBadgeVariants }
