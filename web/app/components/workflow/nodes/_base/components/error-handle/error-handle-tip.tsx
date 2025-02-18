import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAlertFill } from '@remixicon/react'
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
      return t('workflow.nodes.common.errorHandle.failBranch.inLog')

    if (type === ErrorHandleTypeEnum.defaultValue)
      return t('workflow.nodes.common.errorHandle.defaultValue.inLog')
  }, [])

  if (!type)
    return null

  return (
    <div
      className='border-components-panel-border bg-components-panel-bg-blur shadow-xs relative flex rounded-lg border-[0.5px] p-2 pr-[52px]'
    >
      <div
        className='absolute inset-0 rounded-lg opacity-40'
        style={{
          background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
        }}
      ></div>
      <RiAlertFill className='text-text-warning-secondary mr-1 h-4 w-4 shrink-0' />
      <div className='system-xs-medium text-text-primary grow'>
        {text}
      </div>
    </div>
  )
}

export default ErrorHandleTip
