import type { CSSProperties } from 'react'
import React from 'react'
import { type VariantProps, cva } from 'class-variance-authority'
import cn from '@/utils/classnames'

const textareaVariants = cva(
  '',
  {
    variants: {
      size: {
        regular: 'px-3 radius-md system-sm-regular',
        large: 'px-4 radius-lg system-md-regular',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export type TextareaProps = {
  value: string
  disabled?: boolean
  destructive?: boolean
  styleCss?: CSSProperties
} & React.TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textareaVariants>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, value, onChange, disabled, size, destructive, styleCss, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        style={styleCss}
        className={cn(
          'w-full min-h-20 p-2 bg-components-input-bg-normal border border-transparent text-components-input-text-filled hover:bg-components-input-bg-hover hover:border-components-input-border-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:text-components-input-text-placeholder appearance-none outline-none caret-primary-600',
          textareaVariants({ size }),
          disabled && 'bg-components-input-bg-disabled border-transparent text-components-input-text-filled-disabled cursor-not-allowed hover:bg-components-input-bg-disabled hover:border-transparent',
          destructive && 'bg-components-input-bg-destructive border-components-input-border-destructive text-components-input-text-filled hover:bg-components-input-bg-destructive hover:border-components-input-border-destructive focus:bg-components-input-bg-destructive focus:border-components-input-border-destructive',
          className,
        )}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...props}
      >
      </textarea>
    )
  },
)
Textarea.displayName = 'Textarea'

export default Textarea
export { Textarea, textareaVariants }
