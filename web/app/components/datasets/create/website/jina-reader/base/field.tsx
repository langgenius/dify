'use client'
import type { FC } from 'react'
import React from 'react'
import Input from './input'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

interface Props {
  className?: string
  label: string
  labelClassName?: string
  value: string | number
  onChange: (value: string | number) => void
  isRequired?: boolean
  placeholder?: string
  isNumber?: boolean
  tooltip?: string
}

const Field: FC<Props> = ({
  className,
  label,
  labelClassName,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
  isNumber = false,
  tooltip,
}) => {
  return (
    <div className={cn(className)}>
      <div className='flex py-[7px]'>
        <div className={cn(labelClassName, 'flex h-[18px] items-center text-[13px] font-medium text-gray-900')}>{label} </div>
        {isRequired && <span className='ml-0.5 text-xs font-semibold text-[#D92D20]'>*</span>}
        {tooltip && (
          <Tooltip
            popupContent={
              <div className='w-[200px]'>{tooltip}</div>
            }
            triggerClassName='ml-0.5 w-4 h-4'
          />
        )}
      </div>
      <Input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        isNumber={isNumber}
      />
    </div>
  )
}
export default React.memo(Field)
