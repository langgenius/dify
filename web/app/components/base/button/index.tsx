import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import Spinner from '../spinner'

const buttonVariants = cva(
  'btn',
  {
    variants: {
      variant: {
        'primary': 'btn-primary',
        'warning': 'btn-warning',
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
      destructive: {
        true: 'btn-destructive',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'medium',
    },
  },
)

export type ButtonProps = {
  loading?: boolean
  spinnerClassName?: string
  ref?: React.Ref<HTMLButtonElement>
  render?: React.ReactElement
  focusableWhenDisabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = ({
  className,
  variant,
  size,
  destructive,
  loading,
  children,
  spinnerClassName,
  ref,
  render,
  focusableWhenDisabled,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) => {
  const isDisabled = disabled || loading

  return (
    <BaseButton
      type={type}
      className={cn(buttonVariants({ variant, size, destructive, className }))}
      ref={ref}
      render={render}
      {...props}
      disabled={isDisabled}
      focusableWhenDisabled={focusableWhenDisabled}
      aria-busy={loading || undefined}
    >
      {children}
      {loading && <Spinner loading={loading} className={cn('!ml-1 !h-3 !w-3 !border-2 !text-white', spinnerClassName)} />}
    </BaseButton>
  )
}
Button.displayName = 'Button'

export default Button
export { Button, buttonVariants }
