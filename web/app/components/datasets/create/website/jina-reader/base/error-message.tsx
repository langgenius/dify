'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

interface Props {
  className?: string
  title: string
  errorMsg?: string
}

const ErrorMessage: FC<Props> = ({
  className,
  title,
  errorMsg,
}) => {
  return (
    <div className={cn(className, 'border-t border-gray-200 bg-[#FFFAEB] px-4 py-2')}>
      <div className='flex h-5 items-center'>
        <AlertTriangle className='mr-2 h-4 w-4 text-[#F79009]' />
        <div className='text-sm font-medium text-[#DC6803]'>{title}</div>
      </div>
      {errorMsg && (
        <div className='mt-1 pl-6 text-xs font-normal leading-[18px] text-gray-700'>{errorMsg}</div>
      )}
    </div>
  )
}
export default React.memo(ErrorMessage)
