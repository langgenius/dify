import React from 'react'
import cn from '@/utils/classnames'
import { RiErrorWarningFill } from '@remixicon/react'

type ErrorMessageProps = {
  className?: string
  title: string
  errorMsg?: string
}

const ErrorMessage = ({
  className,
  title,
  errorMsg,
}: ErrorMessageProps) => {
  return (
    // eslint-disable-next-line tailwindcss/migration-from-tailwind-2
    <div className={cn(
      'flex gap-x-0.5 rounded-xl border-[0.5px] border-components-panel-border bg-opacity-40 bg-toast-error-bg p-2 shadow-xs shadow-shadow-shadow-3',
      className,
    )}>
      <div className='flex size-6 items-center justify-center'>
        <RiErrorWarningFill className='h-4 w-4 text-text-destructive' />
      </div>
      <div className='flex flex-col gap-y-0.5 py-1'>
        <div className='system-xs-medium text-text-primary'>{title}</div>
        {errorMsg && (
          <div className='system-xs-regular text-text-secondary'>{errorMsg}</div>
        )}
      </div>
    </div>
  )
}
export default React.memo(ErrorMessage)
