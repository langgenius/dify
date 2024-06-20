import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import classNames from 'classnames'
import Spinner from '../spinner'

const buttonVariants = cva(
  'btn disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'btn-primary disabled:btn-primary-disabled',
        warning:
          'btn-warning disabled:btn-warning-disabled',
        default: 'btn-default disabled:btn-default-disabled',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type ButtonProps = {
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, loading, children, ...props }, ref) => {
    return (
      <button
        className={classNames(buttonVariants({ variant, className }))}
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
