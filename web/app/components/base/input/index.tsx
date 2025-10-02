import type { CSSProperties, ChangeEventHandler, FocusEventHandler } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseCircleFill, RiErrorWarningLine, RiSearchLine } from '@remixicon/react'
import { type VariantProps, cva } from 'class-variance-authority'
import cn from '@/utils/classnames'
import { noop } from 'lodash-es'

export const inputVariants = cva(
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

export type InputProps = {
  showLeftIcon?: boolean
  showClearIcon?: boolean
  onClear?: () => void
  disabled?: boolean
  destructive?: boolean
  wrapperClassName?: string
  styleCss?: CSSProperties
  unit?: string
  ref?: React.Ref<HTMLInputElement>
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & VariantProps<typeof inputVariants>

const removeLeadingZeros = (value: string) => value.replace(/^(-?)0+(?=\d)/, '$1')

const Input = ({
  size,
  disabled,
  destructive,
  showLeftIcon,
  showClearIcon,
  onClear,
  wrapperClassName,
  className,
  styleCss,
  value,
  placeholder,
  onChange = noop,
  onBlur = noop,
  unit,
  ref,
  ...props
}: InputProps) => {
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
      {showLeftIcon && <RiSearchLine className={cn('absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-components-input-text-placeholder')} />}
      <input
        ref={ref}
        style={styleCss}
        className={cn(
          'w-full appearance-none border border-transparent bg-components-input-bg-normal py-[7px] text-components-input-text-filled caret-primary-600 outline-none placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs',
          inputVariants({ size }),
          showLeftIcon && 'pl-[26px]',
          showLeftIcon && size === 'large' && 'pl-7',
          showClearIcon && value && 'pr-[26px]',
          showClearIcon && value && size === 'large' && 'pr-7',
          destructive && 'pr-[26px]',
          destructive && size === 'large' && 'pr-7',
          disabled && 'cursor-not-allowed border-transparent bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:border-transparent hover:bg-components-input-bg-disabled',
          destructive && 'border-components-input-border-destructive bg-components-input-bg-destructive text-components-input-text-filled hover:border-components-input-border-destructive hover:bg-components-input-bg-destructive focus:border-components-input-border-destructive focus:bg-components-input-bg-destructive',
          className,
        )}
        placeholder={placeholder ?? (showLeftIcon
          ? (t('common.operation.search') || '')
          : (t('common.placeholder.input') || ''))}
        value={value}
        onChange={props.type === 'number' ? handleNumberChange : onChange}
        onBlur={props.type === 'number' ? handleNumberBlur : onBlur}
        disabled={disabled}
        {...props}
      />
      {showClearIcon && value && !disabled && !destructive && (
        <div className={cn('group absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer p-[1px]')} onClick={onClear}>
          <RiCloseCircleFill className='h-3.5 w-3.5 cursor-pointer text-text-quaternary group-hover:text-text-tertiary' />
        </div>
      )}
      {destructive && (
        <RiErrorWarningLine className='absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-text-destructive-secondary' />
      )}
      {
        unit && (
          <div className='system-sm-regular absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary'>
            {unit}
          </div>
        )
      }
    </div>
  )
}

Input.displayName = 'Input'

export default Input
