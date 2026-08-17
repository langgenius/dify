'use client'

import type { Input as BaseInputNS } from '@base-ui/react/input'
import { Input as BaseInput } from '@base-ui/react/input'
import { cn } from '../cn'
import { textControlFocusClassName } from '../form-control-shared'

type InputProps = Omit<BaseInputNS.Props, 'className' | 'size'> & {
  className?: string
}

function Input({ className, ...props }: InputProps) {
  return (
    <BaseInput
      className={cn(
        [
          'w-full appearance-none rounded-lg border border-transparent bg-components-input-bg-normal px-3 py-1.75 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden transition-[background-color,border-color,box-shadow]',
          'placeholder:text-components-input-text-placeholder',
          'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
          textControlFocusClassName,
          'data-invalid:border-components-input-border-destructive data-invalid:bg-components-input-bg-destructive',
          'read-only:cursor-default read-only:shadow-none read-only:hover:border-transparent read-only:hover:bg-components-input-bg-normal read-only:focus:border-transparent read-only:focus:bg-components-input-bg-normal read-only:focus:shadow-none read-only:focus-visible:ring-2 read-only:focus-visible:ring-state-accent-solid',
          'disabled:cursor-not-allowed disabled:border-transparent disabled:bg-components-input-bg-disabled disabled:text-components-input-text-filled-disabled',
          'disabled:hover:border-transparent disabled:hover:bg-components-input-bg-disabled',
          'motion-reduce:transition-none',
        ],
        className,
      )}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
