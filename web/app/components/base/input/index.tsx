import type { CSSProperties } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseCircleFill, RiErrorWarningLine, RiSearchLine } from '@remixicon/react'
import { type VariantProps, cva } from 'class-variance-authority'
import cn from '@/utils/classnames'

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
} & React.InputHTMLAttributes<HTMLInputElement> & VariantProps<typeof inputVariants>

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
  onChange,
  unit,
  ...props
}: InputProps) => {
  const { t } = useTranslation()
  return (
    <div className={cn('relative w-full', wrapperClassName)}>
      {showLeftIcon && <RiSearchLine className={cn('text-components-input-text-placeholder absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2')} />}
      <input
        style={styleCss}
        className={cn(
          'bg-components-input-bg-normal text-components-input-text-filled hover:bg-components-input-bg-hover hover:border-components-input-border-hover focus:bg-components-input-bg-active focus:border-components-input-border-active focus:shadow-xs placeholder:text-components-input-text-placeholder caret-primary-600 w-full appearance-none border border-transparent py-[7px] outline-none',
          inputVariants({ size }),
          showLeftIcon && 'pl-[26px]',
          showLeftIcon && size === 'large' && 'pl-7',
          showClearIcon && value && 'pr-[26px]',
          showClearIcon && value && size === 'large' && 'pr-7',
          destructive && 'pr-[26px]',
          destructive && size === 'large' && 'pr-7',
          disabled && 'bg-components-input-bg-disabled text-components-input-text-filled-disabled hover:bg-components-input-bg-disabled cursor-not-allowed border-transparent hover:border-transparent',
          destructive && 'bg-components-input-bg-destructive border-components-input-border-destructive text-components-input-text-filled hover:bg-components-input-bg-destructive hover:border-components-input-border-destructive focus:bg-components-input-bg-destructive focus:border-components-input-border-destructive',
          className,
        )}
        placeholder={placeholder ?? (showLeftIcon
          ? (t('common.operation.search') || '')
          : (t('common.placeholder.input') || ''))}
        value={value}
        onChange={onChange}
        disabled={disabled}
        {...props}
      />
      {showClearIcon && value && !disabled && !destructive && (
        <div className={cn('group absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer p-[1px]')} onClick={onClear}>
          <RiCloseCircleFill className='text-text-quaternary group-hover:text-text-tertiary h-3.5 w-3.5 cursor-pointer' />
        </div>
      )}
      {destructive && (
        <RiErrorWarningLine className='text-text-destructive-secondary absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2' />
      )}
      {
        unit && (
          <div className='system-sm-regular text-text-tertiary absolute right-2 top-1/2 -translate-y-1/2'>
            {unit}
          </div>
        )
      }
    </div>
  )
}

export default Input
