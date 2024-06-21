import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import classNames from 'classnames'
import Spinner from '../spinner'

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
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, ...props }, ref) => {
    return (
      <button
        type='button'
        className={classNames(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {children}
        <Spinner loading={loading} className='!text-white !h-3 !w-3 !border-2 !ml-1' />
      </button>
    )
  },
)
Button.displayName = 'Button'

export default Button
export { Button, buttonVariants }
