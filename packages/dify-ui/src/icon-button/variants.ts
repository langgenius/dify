import { cva } from 'class-variance-authority'

const iconButtonVariants = cva(
  [
    'inline-flex cursor-pointer items-center justify-center focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-disabled:cursor-not-allowed',
  ],
  {
    variants: {
      variant: {
        default: [
          'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          'data-disabled:text-text-disabled data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled',
        ],
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
      tone: {
        default: '',
        destructive: '',
      },
      size: {
        xs: 'size-4 rounded-sm p-0',
        sm: 'size-5 rounded-md',
        md: 'size-6 rounded-md p-0.5',
        lg: 'size-8 rounded-lg p-1.5',
        xl: 'size-9 rounded-lg p-2',
      },
    },
    compoundVariants: [
      {
        variant: 'default',
        tone: 'destructive',
        class: [
          'text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive',
          'data-disabled:text-text-disabled data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled',
        ],
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
      variant: 'default',
      tone: 'default',
      size: 'md',
    },
  },
)

export { iconButtonVariants }
