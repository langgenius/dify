import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

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
  ref?: React.Ref<HTMLButtonElement>
  render?: React.ReactElement
  focusableWhenDisabled?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

export function Button({
  className,
  variant,
  size,
  destructive,
  loading,
  children,
  ref,
  render,
  focusableWhenDisabled,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
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
      {loading && (
        <i
          className="ml-1 i-ri-loader-2-line size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </BaseButton>
  )
}
