import type { CSSProperties } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import Spinner from '../spinner'
import classNames from '@/utils/classnames'

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
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, destructive, loading, styleCss, children, ...props }, ref) => {
    return (
      <button
        type='button'
        className={classNames(
          buttonVariants({ variant, size, className }),
          destructive && 'btn-destructive',
        )}
        ref={ref}
        style={styleCss}
        {...props}
      >
        {children}
        {loading && <Spinner loading={loading} className='!ml-1 !h-3 !w-3 !border-2 !text-white' />}
      </button>
    )
  },
)
Button.displayName = 'Button'

export default Button
export { Button, buttonVariants }
