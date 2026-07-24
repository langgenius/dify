import { RiAlertFill } from '@remixicon/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorHandleTypeEnum } from './types'

type ErrorHandleTipProps = {
  type?: ErrorHandleTypeEnum
}
const ErrorHandleTip = ({
  type,
}: ErrorHandleTipProps) => {
  const { t } = useTranslation()

  const text = useMemo(() => {
    if (type === ErrorHandleTypeEnum.failBranch)
      return t('nodes.common.errorHandle.failBranch.inLog', { ns: 'workflow' })

    if (type === ErrorHandleTypeEnum.defaultValue)
      return t('nodes.common.errorHandle.defaultValue.inLog', { ns: 'workflow' })
  }, [t, type])

  if (!type)
    return null

  return (
    <div
      className="relative flex rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 pr-[52px] shadow-xs"
    >
      <div
        className="absolute inset-0 rounded-lg opacity-40"
        style={{
          background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
        }}
      >
      </div>
      <RiAlertFill className="mr-1 h-4 w-4 shrink-0 text-text-warning-secondary" />
      <div className="system-xs-medium grow text-text-primary">
        {text}
      </div>
    </div>
  )
}

export default ErrorHandleTip
