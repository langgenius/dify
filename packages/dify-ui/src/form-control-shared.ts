import { cva } from 'class-variance-authority'

export const formLabelClassName =
  'w-fit py-1 text-text-secondary system-sm-medium data-disabled:cursor-not-allowed'

export const textControlFocusClassName =
  'focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs'

export const textControlCompoundFocusClassName =
  'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs'

export const textControlVariants = cva(
  [
    'w-full appearance-none border border-transparent bg-components-input-bg-normal text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color,box-shadow]',
    'placeholder:text-components-input-text-placeholder',
    'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
    textControlFocusClassName,
    'data-invalid:border-components-input-border-destructive data-invalid:bg-components-input-bg-destructive',
    'read-only:cursor-default read-only:shadow-none read-only:hover:border-transparent read-only:hover:bg-components-input-bg-normal read-only:focus:border-transparent read-only:focus:bg-components-input-bg-normal read-only:focus:shadow-none',
    'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled',
    'disabled:hover:border-transparent disabled:hover:bg-components-input-bg-disabled',
    'motion-reduce:transition-none',
  ],
  {
    variants: {
      size: {
        small: 'rounded-md px-2 py-[3px] system-xs-regular',
        medium: 'rounded-lg px-3 py-[7px] system-sm-regular',
        large: 'rounded-[10px] px-4 py-[7px] system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)
