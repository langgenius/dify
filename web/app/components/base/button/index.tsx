import type { CSSProperties } from 'react'
import React, { useRef } from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import Spinner from '../spinner'
import classNames from '@/utils/classnames'
import { useMagneticEffect } from '@/utils/animations'

const buttonVariants = cva(
  'btn disabled:btn-disabled',
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
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'medium',
    },
  },
)

export type ButtonProps = {
  destructive?: boolean
  loading?: boolean
  styleCss?: CSSProperties
  spinnerClassName?: string
  useMagnetic?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, destructive, loading, styleCss, children, spinnerClassName, useMagnetic, ...props }, ref) => {
    const magneticRef = useRef<HTMLButtonElement>(null)
    useMagneticEffect(magneticRef)

    return (
      <button
        type='button'
        className={classNames(
          buttonVariants({ variant, size, className }),
          destructive && 'btn-destructive',
          useMagnetic && 'magnetic-button',
        )}
        ref={useMagnetic ? magneticRef : ref}
        style={styleCss}
        {...props}
      >
        {children}
        {loading && <Spinner loading={loading} className={classNames('!ml-1 !h-3 !w-3 !border-2 !text-white', spinnerClassName)} />}
      </button>
    )
  },
)
Button.displayName = 'Button'

export default Button
export { Button, buttonVariants }
