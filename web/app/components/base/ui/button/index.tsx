import type { Button as BaseButtonNS } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import { Button as BaseButton } from '@base-ui/react/button'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center whitespace-nowrap outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid data-[disabled]:cursor-not-allowed',
  {
    variants: {
      variant: {
        'primary': [
          'border-components-button-primary-border bg-components-button-primary-bg text-components-button-primary-text shadow',
          'hover:border-components-button-primary-border-hover hover:bg-components-button-primary-bg-hover',
          'data-[disabled]:border-components-button-primary-border-disabled data-[disabled]:bg-components-button-primary-bg-disabled data-[disabled]:text-components-button-primary-text-disabled data-[disabled]:shadow-none',
        ],
        'secondary': [
          'border-[0.5px] shadow-xs backdrop-blur-[5px]',
          'border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text',
          'hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover',
          'data-[disabled]:border-components-button-secondary-border-disabled data-[disabled]:bg-components-button-secondary-bg-disabled data-[disabled]:text-components-button-secondary-text-disabled data-[disabled]:backdrop-blur-xs',
        ],
        'secondary-accent': [
          'border-[0.5px] shadow-xs',
          'border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-accent-text',
          'hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover',
          'data-[disabled]:border-components-button-secondary-border-disabled data-[disabled]:bg-components-button-secondary-bg-disabled data-[disabled]:text-components-button-secondary-accent-text-disabled',
        ],
        'tertiary': [
          'bg-components-button-tertiary-bg text-components-button-tertiary-text',
          'hover:bg-components-button-tertiary-bg-hover',
          'data-[disabled]:bg-components-button-tertiary-bg-disabled data-[disabled]:text-components-button-tertiary-text-disabled',
        ],
        'ghost': [
          'text-components-button-ghost-text',
          'hover:bg-components-button-ghost-bg-hover',
          'data-[disabled]:text-components-button-ghost-text-disabled',
        ],
        'ghost-accent': [
          'text-components-button-secondary-accent-text',
          'hover:bg-state-accent-hover',
          'data-[disabled]:text-components-button-secondary-accent-text-disabled',
        ],
      },
      size: {
        small: 'h-6 rounded-md px-2 text-xs font-medium',
        medium: 'h-8 rounded-lg px-3.5 text-[13px] leading-4 font-medium',
        large: 'h-9 rounded-[10px] px-4 text-sm font-semibold',
      },
      tone: {
        default: '',
        destructive: '',
      },
    },
    compoundVariants: [
      {
        variant: 'primary',
        tone: 'destructive',
        class: [
          'border-components-button-destructive-primary-border bg-components-button-destructive-primary-bg text-components-button-destructive-primary-text',
          'hover:border-components-button-destructive-primary-border-hover hover:bg-components-button-destructive-primary-bg-hover',
          'data-[disabled]:border-components-button-destructive-primary-border-disabled data-[disabled]:bg-components-button-destructive-primary-bg-disabled data-[disabled]:text-components-button-destructive-primary-text-disabled data-[disabled]:shadow-none',
        ],
      },
      {
        variant: 'secondary',
        tone: 'destructive',
        class: [
          'border-components-button-destructive-secondary-border bg-components-button-destructive-secondary-bg text-components-button-destructive-secondary-text',
          'hover:border-components-button-destructive-secondary-border-hover hover:bg-components-button-destructive-secondary-bg-hover',
          'data-[disabled]:border-components-button-destructive-secondary-border-disabled data-[disabled]:bg-components-button-destructive-secondary-bg-disabled data-[disabled]:text-components-button-destructive-secondary-text-disabled',
        ],
      },
      {
        variant: 'tertiary',
        tone: 'destructive',
        class: [
          'bg-components-button-destructive-tertiary-bg text-components-button-destructive-tertiary-text',
          'hover:bg-components-button-destructive-tertiary-bg-hover',
          'data-[disabled]:bg-components-button-destructive-tertiary-bg-disabled data-[disabled]:text-components-button-destructive-tertiary-text-disabled',
        ],
      },
      {
        variant: 'ghost',
        tone: 'destructive',
        class: [
          'text-components-button-destructive-ghost-text',
          'hover:bg-components-button-destructive-ghost-bg-hover',
          'data-[disabled]:text-components-button-destructive-ghost-text-disabled',
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
