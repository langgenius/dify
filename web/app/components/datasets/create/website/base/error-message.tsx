'use client'
import type { FC } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import * as React from 'react'

type Props = Readonly<{
  className?: string
  title: string
  errorMsg?: string
}>

const ErrorMessage: FC<Props> = ({ className, title, errorMsg }) => {
  return (
    <Alert type="error" className={className}>
      <AlertTitle>{title}</AlertTitle>
      {errorMsg && <AlertDescription>{errorMsg}</AlertDescription>}
    </Alert>
  )
}
export default React.memo(ErrorMessage)
