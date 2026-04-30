import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiErrorWarningFill } from '@remixicon/react'
import * as React from 'react'

type ErrorMessageProps = {
  message: string
} & React.HTMLAttributes<HTMLDivElement>

const ErrorMessage: FC<ErrorMessageProps> = ({
  message,
  className,
}) => {
  return (
    <div className={cn('mt-1 flex gap-x-1 rounded-lg border-[0.5px] border-components-panel-border bg-toast-error-bg p-2', className)}>
      <RiErrorWarningFill className="h-4 w-4 shrink-0 text-text-destructive" />
      <div className="max-h-12 grow overflow-y-auto system-xs-medium wrap-break-word whitespace-pre-line text-text-primary">
        {message}
      </div>
    </div>
  )
}

export default React.memo(ErrorMessage)
