import type { Button as BaseButtonNS } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/classnames'

const buttonVariants = cva(
  'btn',
  {
    variants: {
      variant: {
        'primary': 'btn-primary',
        'secondary': 'btn-secondary',
        'secondary-accent': 'btn-secondary-accent',
        'ghost': 'btn-ghost',
        'ghost-accent': 'btn-ghost-accent',
        'tertiary': 'btn-tertiary',
      },
      size: {
        small: 'btn-small',
        medium: 'btn-medium',
        large: 'btn-large',
      },
      tone: {
        default: '',
        destructive: '',
      },
    },
    compoundVariants: [
      { variant: 'primary', tone: 'destructive', class: 'btn-destructive-primary' },
      { variant: 'secondary', tone: 'destructive', class: 'btn-destructive-secondary' },
      { variant: 'tertiary', tone: 'destructive', class: 'btn-destructive-tertiary' },
      { variant: 'ghost', tone: 'destructive', class: 'btn-destructive-ghost' },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'medium',
      tone: 'default',
    },
  },
)

export type ButtonProps
  = Omit<BaseButtonNS.Props, 'className'>
    & VariantProps<typeof buttonVariants> & {
      loading?: boolean
      className?: string
    }

export function Button({
  className,
  variant,
  size,
  tone,
  loading,
  disabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      className={cn(buttonVariants({ variant, size, tone, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
      {loading && (
        <i
          className="ml-1 i-ri-loader-2-line size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </BaseButton>
  )
}
