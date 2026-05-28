import type { VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import { Highlight } from '@/app/components/base/icons/src/public/common'

const PremiumBadgeVariants = cva(
  'premium-badge',
  {
    variants: {
      size: {
        s: 'premium-badge-s',
        m: 'premium-badge-m',
        custom: '',
      },
      color: {
        blue: 'premium-badge-blue',
        indigo: 'premium-badge-indigo',
        gray: 'premium-badge-gray',
        orange: 'premium-badge-orange',
      },
      allowHover: {
        true: 'pb-allow-hover',
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
  size?: 's' | 'm' | 'custom'
  color?: 'blue' | 'indigo' | 'gray' | 'orange'
  allowHover?: boolean
  styleCss?: CSSProperties
  className?: string
  children?: ReactNode
} & VariantProps<typeof PremiumBadgeVariants>

type PremiumBadgeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & Omit<PremiumBadgeProps, 'styleCss'> & {
  style?: CSSProperties
}

function BadgeHighlight({ size }: { size?: PremiumBadgeProps['size'] }) {
  return (
    <Highlight
      aria-hidden="true"
      className={cn('absolute top-0 right-1/2 translate-x-[20%] opacity-50 transition-[opacity,transform] duration-100 ease-out hover:translate-x-[30%] hover:opacity-80 motion-reduce:transition-none', size === 's' ? 'h-[18px] w-12' : 'h-6 w-12')}
    />
  )
}

function PremiumBadge({
  className,
  size,
  color,
  allowHover,
  styleCss,
  children,
}: PremiumBadgeProps) {
  return (
    <span
      className={cn(PremiumBadgeVariants({ size, color, allowHover, className }), 'relative text-nowrap')}
      style={styleCss}
    >
      {children}
      <BadgeHighlight size={size} />
    </span>
  )
}

export function PremiumBadgeButton({
  className,
  size,
  color,
  allowHover = true,
  style,
  children,
  type = 'button',
  ...props
}: PremiumBadgeButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        PremiumBadgeVariants({ size, color, allowHover, className }),
        'relative touch-manipulation text-nowrap focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
      )}
      style={style}
      {...props}
    >
      {children}
      <BadgeHighlight size={size} />
    </button>
  )
}

export default PremiumBadge
