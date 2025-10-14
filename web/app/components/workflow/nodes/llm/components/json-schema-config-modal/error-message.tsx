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
      'mt-1 flex gap-x-1 rounded-lg border-[0.5px] border-components-panel-border bg-toast-error-bg p-2',
      className,
    )}>
      <RiErrorWarningFill className='h-4 w-4 shrink-0 text-text-destructive' />
      <div className='system-xs-medium max-h-12 grow overflow-y-auto whitespace-pre-line break-words text-text-primary'>
        {message}
      </div>
    </div>
  )
}

export default React.memo(ErrorMessage)
