'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'

type InputProps = {
  placeholder?: string
  value?: string
  defaultValue?: string
  onChange?: (v: any) => void
  className?: string
  wrapperClassName?: string
  type?: string
  showPrefix?: React.ReactNode
  prefixIcon?: React.ReactNode
}

const GlassIcon: FC<{ className?: string }> = ({ className }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path d="M12.25 12.25L10.2084 10.2083M11.6667 6.70833C11.6667 9.44675 9.44675 11.6667 6.70833 11.6667C3.96992 11.6667 1.75 9.44675 1.75 6.70833C1.75 3.96992 3.96992 1.75 6.70833 1.75C9.44675 1.75 11.6667 3.96992 11.6667 6.70833Z" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const Input: FC<InputProps> = ({ value, defaultValue, onChange, className = '', wrapperClassName = '', placeholder, type, showPrefix, prefixIcon }) => {
  const [localValue, setLocalValue] = useState(value ?? defaultValue)
  const { t } = useTranslation()
  return (
    <div className={`relative inline-flex w-full ${wrapperClassName}`}>
      {showPrefix && <span className={s.prefix}>{prefixIcon ?? <GlassIcon className='h-3.5 w-3.5 stroke-current text-gray-700 stroke-2' />}</span>}
      <input
        type={type ?? 'text'}
        className={`${s.input} ${showPrefix ? '!pl-7' : ''} ${className}`}
        placeholder={placeholder ?? (showPrefix ? t('common.operation.search') : 'please input')}
        value={localValue}
        onChange={(e) => {
          setLocalValue(e.target.value)
          onChange && onChange(e.target.value)
        }}
      />
    </div>
  )
}

export default Input
