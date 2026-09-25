'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  title: string
  errorMsg?: string
}>

const ErrorMessage: FC<Props> = ({ className, title, errorMsg }) => {
  return (
    <div
      className={cn(
        className,
        'border-t border-divider-subtle bg-dataset-warning-message-bg px-4 py-2 opacity-40',
      )}
    >
      <div className="flex h-5 items-center">
        <span
          aria-hidden
          className="mr-2 i-custom-vender-solid-alertsAndFeedback-alert-triangle size-4 text-text-warning-secondary"
        />
        <div className="system-md-medium text-text-warning">{title}</div>
      </div>
      {errorMsg && (
        <div className="mt-1 pl-6 system-xs-regular text-text-secondary">{errorMsg}</div>
      )}
    </div>
  )
}
export default React.memo(ErrorMessage)
