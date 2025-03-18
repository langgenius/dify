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
      <RiErrorWarningFill className='shrink-0 w-4 h-4 text-text-destructive' />
      <div className='grow text-text-primary system-xs-medium max-h-12 overflow-y-auto break-words'>
        {message}
      </div>
    </div>
  )
}

export default React.memo(ErrorMessage)
