import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleTipProps = {
  type?: ErrorHandleTypeEnum
}
const ErrorHandleTip = ({ type }: ErrorHandleTipProps) => {
  const { t } = useTranslation(['workflow'])

  const text = useMemo(() => {
    if (type === ErrorHandleTypeEnum.failBranch)
      return t(($) => $['nodes.common.errorHandle.failBranch.inLog'], { ns: 'workflow' })

    if (type === ErrorHandleTypeEnum.defaultValue)
      return t(($) => $['nodes.common.errorHandle.defaultValue.inLog'], { ns: 'workflow' })
  }, [t, type])

  if (!type) return null

  return (
    <Alert type="warning">
      <AlertTitle>{text}</AlertTitle>
    </Alert>
  )
}

export default ErrorHandleTip
