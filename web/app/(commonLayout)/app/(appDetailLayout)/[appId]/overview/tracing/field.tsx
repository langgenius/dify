'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'

type Props = {
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string) => void
  isRequired?: boolean
  placeholder?: string
}

const Field: FC<Props> = ({
  className,
  label,
  labelClassName,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
}) => {
  return (
    <div className={cn(className)}>
      <div className='flex py-[7px]'>
        <div className={cn(labelClassName, 'flex h-[18px] items-center text-[13px] font-medium text-text-primary')}>{label} </div>
        {isRequired && <span className='ml-0.5 text-xs font-semibold text-[#D92D20]'>*</span>}
      </div>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        className='h-9'
        placeholder={placeholder}
      />
    </div>
  )
}
export default React.memo(Field)
