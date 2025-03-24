import React from 'react'
import type { FC } from 'react'
import { RiErrorWarningFill } from '@remixicon/react'
import classNames from '@/utils/classnames'

type ErrorMessageProps = {
  message: string
} & React.HTMLAttributes<HTMLDivElement>

const ErrorMessage: FC<ErrorMessageProps> = ({
  message,
  className,
}) => {
  return (
    <div className={classNames(
      'flex gap-x-1 mt-1 p-2 rounded-lg border-[0.5px] border-components-panel-border bg-toast-error-bg',
      className,
    )}>
      <RiErrorWarningFill className='h-4 w-4 shrink-0 text-text-destructive' />
      <div className='system-xs-medium max-h-12 grow overflow-y-auto break-words text-text-primary'>
        {message}
      </div>
    </div>
  )
}

export default React.memo(ErrorMessage)
