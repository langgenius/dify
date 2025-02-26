'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'

type Props = {
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
    <div className={cn(className, 'py-2 px-4 border-t border-gray-200 bg-[#FFFAEB]')}>
      <div className='flex items-center h-5'>
        <AlertTriangle className='mr-2 w-4 h-4 text-text-warning-secondary' />
        <div className='text-sm font-medium text-[#DC6803]'>{title}</div>
      </div>
      {errorMsg && (
        <div className='mt-1 pl-6 leading-[18px] text-xs font-normal text-gray-700'>{errorMsg}</div>
      )}
    </div>
  )
}
export default React.memo(ErrorMessage)
