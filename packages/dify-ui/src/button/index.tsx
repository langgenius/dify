'use client'

import type { Button as BaseButtonNS } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'
import { cn } from '../cn'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        primary: [
          'bg-components-button-primary-bg text-components-button-primary-text shadow-primary-button inset-ring-[0.5px] inset-ring-components-button-primary-border',
          'hover:bg-components-button-primary-bg-hover hover:shadow-xs hover:shadow-shadow-shadow-3 hover:inset-ring-components-button-primary-border-hover',
          'data-disabled:bg-components-button-primary-bg-disabled data-disabled:text-components-button-primary-text-disabled data-disabled:shadow-none data-disabled:inset-ring-components-button-primary-border-disabled',
        ],
        secondary: [
          'bg-components-button-secondary-bg text-components-button-secondary-text shadow-xs inset-ring-[0.5px] shadow-shadow-shadow-3 inset-ring-components-button-secondary-border backdrop-blur-[5px]',
          'hover:bg-components-button-secondary-bg-hover hover:inset-ring-components-button-secondary-border-hover',
          'data-disabled:bg-components-button-secondary-bg-disabled data-disabled:text-components-button-secondary-text-disabled data-disabled:shadow-none data-disabled:inset-ring-components-button-secondary-border-disabled data-disabled:backdrop-blur-xs',
        ],
        'secondary-accent': [
          'bg-components-button-secondary-bg text-components-button-secondary-accent-text shadow-xs inset-ring-[0.5px] shadow-shadow-shadow-3 inset-ring-components-button-secondary-border backdrop-blur-[5px]',
          'hover:bg-components-button-secondary-bg-hover hover:inset-ring-components-button-secondary-border-hover',
          'data-disabled:bg-components-button-secondary-bg-disabled data-disabled:text-components-button-secondary-accent-text-disabled data-disabled:shadow-none data-disabled:inset-ring-components-button-secondary-border-disabled data-disabled:backdrop-blur-xs',
        ],
        tertiary: [
          'bg-components-button-tertiary-bg text-components-button-tertiary-text',
          'hover:bg-components-button-tertiary-bg-hover',
          'data-disabled:bg-components-button-tertiary-bg-disabled data-disabled:text-components-button-tertiary-text-disabled',
        ],
        ghost: [
          'text-components-button-ghost-text',
          'hover:bg-components-button-ghost-bg-hover',
          'data-disabled:text-components-button-ghost-text-disabled',
        ],
        'ghost-accent': [
          'text-components-button-secondary-accent-text',
          'hover:bg-state-accent-hover',
          'data-disabled:text-components-button-secondary-accent-text-disabled',
        ],
      },
      size: {
        small: 'h-6 gap-1 rounded-md px-[9px] text-xs font-medium',
        medium: 'h-8 gap-1 rounded-lg px-3.5 text-[13px] leading-4 font-medium',
        large: 'h-9 gap-1.5 rounded-[10px] px-4 text-sm font-semibold',
      },
      tone: {
        default: '',
        destructive: '',
      },
    },
    compoundVariants: [
      {
        variant: 'primary',
        size: 'small',
        class: 'gap-[3px] px-2',
      },
      {
        variant: 'primary',
        tone: 'destructive',
        class: [
          'bg-components-button-destructive-primary-bg text-components-button-destructive-primary-text inset-ring-components-button-destructive-primary-border',
          'hover:bg-components-button-destructive-primary-bg-hover hover:inset-ring-components-button-destructive-primary-border-hover',
          'data-disabled:bg-components-button-destructive-primary-bg-disabled data-disabled:text-components-button-destructive-primary-text-disabled data-disabled:shadow-none data-disabled:inset-ring-components-button-destructive-primary-bg-disabled',
        ],
      },
      {
        variant: 'secondary',
        tone: 'destructive',
        class: [
          'bg-components-button-destructive-secondary-bg text-components-button-destructive-secondary-text inset-ring-components-button-destructive-secondary-border',
          'hover:bg-components-button-destructive-secondary-bg-hover hover:inset-ring-components-button-destructive-secondary-border-hover',
          'data-disabled:text-components-button-destructive-secondary-text-disabled',
        ],
      },
      {
        variant: 'tertiary',
        tone: 'destructive',
        class: [
          'bg-components-button-destructive-tertiary-bg text-components-button-destructive-tertiary-text',
          'hover:bg-components-button-destructive-tertiary-bg-hover',
          'data-disabled:bg-components-button-destructive-tertiary-bg-disabled data-disabled:text-components-button-destructive-tertiary-text-disabled',
        ],
      },
      {
        variant: 'ghost',
        tone: 'destructive',
        class: [
          'text-components-button-destructive-ghost-text',
          'hover:bg-components-button-destructive-ghost-bg-hover',
          'data-disabled:text-components-button-destructive-ghost-text-disabled',
        ],
      },
    ],
    defaultVariants: {
      variant: 'secondary',
      size: 'medium',
      tone: 'default',
    },
  },
)

type ButtonProps = Omit<BaseButtonNS.Props, 'className'> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean
    className?: string
  }

function Button({
  className,
  variant,
  size,
  tone,
  loading,
  disabled,
  focusableWhenDisabled,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      className={cn(buttonVariants({ variant, size, tone, className }))}
      disabled={disabled || loading}
      focusableWhenDisabled={focusableWhenDisabled ?? loading}
      {...props}
    >
      {children}
      {loading && (
        <i
          className="i-ri-loader-2-line size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
    </BaseButton>
  )
}

export { Button, buttonVariants }

export type { ButtonProps }
