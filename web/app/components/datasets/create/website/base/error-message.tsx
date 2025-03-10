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
    <div className={cn(className, 'py-2 px-4 border-t border-divider-subtle bg-dataset-warning-message-bg opacity-40')}>
      <div className='flex items-center h-5'>
        <AlertTriangle className='mr-2 w-4 h-4 text-text-warning-secondary' />
        <div className='system-md-medium text-text-warning'>{title}</div>
      </div>
      {errorMsg && (
        <div className='mt-1 pl-6 system-xs-regular text-text-secondary'>{errorMsg}</div>
      )}
    </div>
  )
}
export default React.memo(ErrorMessage)
