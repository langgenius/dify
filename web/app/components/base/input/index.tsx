import type { VariantProps } from 'class-variance-authority'
import type { ChangeEventHandler, CSSProperties, FocusEventHandler } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { cva } from 'class-variance-authority'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedbackNew } from '../copy-feedback'

export const inputVariants = cva(
  '',
  {
    variants: {
      size: {
        regular: 'rounded-lg px-3 system-sm-regular',
        large: 'rounded-[10px] px-4 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'regular',
    },
  },
)

export type InputProps = {
  showLeftIcon?: boolean
  showClearIcon?: boolean
  showCopyIcon?: boolean
  onClear?: () => void
  disabled?: boolean
  destructive?: boolean
  wrapperClassName?: string
  styleCss?: CSSProperties
  unit?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & VariantProps<typeof inputVariants>

const removeLeadingZeros = (value: string) => value.replace(/^(-?)0+(?=\d)/, '$1')

const Input = React.forwardRef<HTMLInputElement, InputProps>(({
  size,
  disabled,
  destructive,
  showLeftIcon,
  showClearIcon,
  showCopyIcon,
  onClear,
  wrapperClassName,
  className,
  styleCss,
  value,
  placeholder,
  onChange = noop,
  onBlur = noop,
  unit,
  ...props
}, ref) => {
  const { t } = useTranslation()
  const handleNumberChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    if (value === 0) {
      // remove leading zeros
      const formattedValue = removeLeadingZeros(e.target.value)
      if (e.target.value !== formattedValue)
        e.target.value = formattedValue
    }
    onChange(e)
  }
  const handleNumberBlur: FocusEventHandler<HTMLInputElement> = (e) => {
    // remove leading zeros
    const formattedValue = removeLeadingZeros(e.target.value)
    if (e.target.value !== formattedValue) {
      e.target.value = formattedValue
      onChange({
        ...e,
        type: 'change',
        target: {
          ...e.target,
          value: formattedValue,
        },
      })
    }
    onBlur(e)
  }
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      {showLeftIcon && <span className={cn('absolute top-1/2 left-2 i-ri-search-line h-4 w-4 -translate-y-1/2 text-components-input-text-placeholder')} />}
      <input
        ref={ref}
        style={styleCss}
        className={cn(
          'w-full appearance-none border border-transparent bg-components-input-bg-normal py-[7px] text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          inputVariants({ size }),
          showLeftIcon && 'pl-[26px]',
          showLeftIcon && size === 'large' && 'pl-7',
          showClearIcon && value && 'pr-[26px]',
          showClearIcon && value && size === 'large' && 'pr-7',
          (destructive || showCopyIcon) && 'pr-[26px]',
          (destructive || showCopyIcon) && size === 'large' && 'pr-7',
          disabled && 'cursor-not-allowed border-transparent bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
          destructive && 'border-components-input-border-destructive bg-components-input-bg-destructive text-components-input-text-filled hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive focus:border-components-input-border-destructive focus:bg-components-input-bg-destructive',
          className,
        )}
        placeholder={placeholder ?? (showLeftIcon
          ? (t('operation.search', { ns: 'common' }) || '')
          : (t('placeholder.input', { ns: 'common' }) || ''))}
        value={value}
        onChange={props.type === 'number' ? handleNumberChange : onChange}
        onBlur={props.type === 'number' ? handleNumberBlur : onBlur}
        disabled={disabled}
        {...props}
      />
      {!!(showClearIcon && value && !disabled && !destructive) && (
        <div
          className={cn('group absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer p-px')}
          onClick={onClear}
          data-testid="input-clear"
        >
          <span className="i-ri-close-circle-fill h-3.5 w-3.5 cursor-pointer text-text-quaternary group-hover:text-text-tertiary" />
        </div>
      )}
      {destructive && (
        <span className="absolute top-1/2 right-2 i-ri-error-warning-line h-4 w-4 -translate-y-1/2 text-text-destructive-secondary" />
      )}
      {showCopyIcon && (
        <div className={cn('group absolute top-1/2 right-0 -translate-y-1/2 cursor-pointer')}>
          <CopyFeedbackNew
            content={String(value ?? '')}
            className="h-7! w-7! hover:bg-transparent"
          />
        </div>
      )}
      {
        unit && (
          <div className="absolute top-1/2 right-2 -translate-y-1/2 system-sm-regular text-text-tertiary">
            {unit}
          </div>
        )
      }
    </div>
  )
})

Input.displayName = 'Input'

export default Input
