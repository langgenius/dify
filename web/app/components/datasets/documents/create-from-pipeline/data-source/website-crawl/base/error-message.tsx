import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import * as React from 'react'

type ErrorMessageProps = {
  className?: string
  title: string
  errorMsg?: string
}

const ErrorMessage = ({ className, title, errorMsg }: ErrorMessageProps) => {
  return (
    <Alert type="error" className={className}>
      <AlertTitle>{title}</AlertTitle>
      {errorMsg && <AlertDescription>{errorMsg}</AlertDescription>}
    </Alert>
  )
}
export default React.memo(ErrorMessage)
