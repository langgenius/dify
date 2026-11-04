import type { FC } from 'react'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'

type ErrorMessageProps = {
  message: string
} & React.HTMLAttributes<HTMLDivElement>

const ErrorMessage: FC<ErrorMessageProps> = ({ message, className }) => {
  return (
    <Alert type="error" role="note" className={cn('mt-1', className)}>
      <AlertTitle className="whitespace-pre-line">
        <div className="max-h-12 overflow-y-auto">{message}</div>
      </AlertTitle>
    </Alert>
  )
}

export default React.memo(ErrorMessage)
