'use client'
import type { FC } from 'react'
import React from 'react'
import {
  RiQuestionLine,
} from '@remixicon/react'
import Input from './input'
import cn from '@/utils/classnames'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type Props = {
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
        <div className={cn(labelClassName, 'flex items-center h-[18px] text-[13px] font-medium text-gray-900')}>{label} </div>
        {isRequired && <span className='ml-0.5 text-xs font-semibold text-[#D92D20]'>*</span>}
        {tooltip && (
          <TooltipPlus popupContent={
            <div className='w-[200px]'>{tooltip}</div>
          }>
            <RiQuestionLine className='relative top-[3px] w-3 h-3 ml-1 text-gray-500' />
          </TooltipPlus>
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
