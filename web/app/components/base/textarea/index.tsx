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
          'bg-components-input-bg-normal text-components-input-text-filled hover:bg-components-input-bg-hover hover:border-components-input-border-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:text-components-input-text-placeholder caret-primary-600 min-h-20 w-full appearance-none border border-transparent p-2 outline-none',
          textareaVariants({ size }),
          disabled && 'bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:bg-components-input-bg-disabled cursor-not-allowed border-transparent hover:border-transparent',
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
