'use client'
import type { FC } from 'react'
import * as React from 'react'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { cn } from '@/utils/classnames'

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
    <div className={cn(className, 'border-t border-divider-subtle bg-dataset-warning-message-bg px-4 py-2 opacity-40')}>
      <div className="flex h-5 items-center">
        <AlertTriangle className="mr-2 h-4 w-4 text-text-warning-secondary" />
        <div className="text-text-warning system-md-medium">{title}</div>
      </div>
      {errorMsg && (
        <div className="mt-1 pl-6 text-text-secondary system-xs-regular">{errorMsg}</div>
      )}
    </div>
  )
}
export default React.memo(ErrorMessage)
