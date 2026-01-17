import type { VariantProps } from 'class-variance-authority'
import type { CSSProperties } from 'react'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

const textareaVariants = cva(
  '',
  {
    variants: {
      size: {
        small: 'py-1 rounded-md system-xs-regular',
        regular: 'px-3 rounded-md system-sm-regular',
        large: 'px-4 rounded-lg system-md-regular',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export type TextareaProps = {
  value: string | number
  disabled?: boolean
  destructive?: boolean
  styleCss?: CSSProperties
  ref?: React.Ref<HTMLTextAreaElement>
  onFocus?: React.FocusEventHandler<HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
} & React.TextareaHTMLAttributes<HTMLTextAreaElement> & VariantProps<typeof textareaVariants>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, value, onChange, disabled, size, destructive, styleCss, onFocus, onBlur, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        onFocus={onFocus}
        onBlur={onBlur}
        style={styleCss}
        className={cn(
          'min-h-20 w-full appearance-none border border-transparent bg-components-input-bg-normal p-2 text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          textareaVariants({ size }),
          disabled && 'cursor-not-allowed border-transparent bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
          destructive && 'border-components-input-border-destructive bg-components-input-bg-destructive text-components-input-text-filled hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive focus:border-components-input-border-destructive focus:bg-components-input-bg-destructive',
          className,
        )}
        value={value ?? ''}
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
