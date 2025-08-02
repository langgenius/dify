'use client'

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from './index'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type SecretInputProps = {
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  autoFocus?: boolean
  maxLength?: number
}

const SecretInput: React.FC<SecretInputProps> = ({
  value = '',
  onChange,
  placeholder,
  className,
  disabled,
  autoFocus,
  maxLength,
}) => {
  const { t } = useTranslation()
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className={cn('relative', className)}>
      <Input
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={maxLength}
        className='pr-10'
      />
      <div className="absolute inset-y-0 right-0 flex items-center pr-3">
        <Button
          type="button"
          variant='ghost'
          size='small'
          onClick={() => setShowPassword(!showPassword)}
          className='h-6 w-6 p-0'
          disabled={disabled}
        >
          {showPassword ? '👀' : '😝'}
        </Button>
      </div>
    </div>
  )
}

export default SecretInput
