import type { Button as BaseButtonNS } from '@base-ui/react/button'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import { cn } from '@/utils/classnames'

const destructiveToneVariants = ['primary', 'secondary', 'tertiary', 'ghost'] as const
const accentVariants = ['secondary-accent', 'ghost-accent'] as const
export const buttonVariantsList = [...destructiveToneVariants, ...accentVariants] as const
export const buttonTones = ['default', 'destructive'] as const
const buttonVariantSet = new Set<string>(buttonVariantsList)
const buttonSizeSet = new Set<string>(['small', 'medium', 'large'])

type DestructiveToneVariant = typeof destructiveToneVariants[number]
type AccentVariant = typeof accentVariants[number]
export type ButtonVariant = typeof buttonVariantsList[number]
export type ButtonSize = 'small' | 'medium' | 'large'
type ButtonTone = typeof buttonTones[number]

export const isButtonVariant = (value: unknown): value is ButtonVariant => {
  return typeof value === 'string' && buttonVariantSet.has(value)
}

export const isButtonSize = (value: unknown): value is ButtonSize => {
  return typeof value === 'string' && buttonSizeSet.has(value)
}

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

type BaseButtonProps = Omit<BaseButtonNS.Props, 'className'> & {
  size?: ButtonSize
  className?: string
  loading?: boolean
}

type DestructiveToneButtonProps = BaseButtonProps & {
  variant?: DestructiveToneVariant
  tone?: ButtonTone
}

type AccentButtonProps = BaseButtonProps & {
  variant: AccentVariant
  tone?: 'default'
}

export type ButtonProps = DestructiveToneButtonProps | AccentButtonProps

const resolveTone = (variant: ButtonVariant | undefined, tone: ButtonTone | undefined) => {
  if (variant === 'secondary-accent' || variant === 'ghost-accent')
    return 'default'

  return tone
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
      className={cn(buttonVariants({ variant, size, tone: resolveTone(variant, tone), className }))}
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
