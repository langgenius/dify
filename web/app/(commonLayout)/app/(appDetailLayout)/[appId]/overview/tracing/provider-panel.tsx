'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TracingProvider } from './type'
import { LangfuseIconBig, LangsmithIconBig } from '@/app/components/base/icons/src/public/tracing'
import { Settings04 } from '@/app/components/base/icons/src/vender/line/general'
const I18N_PREFIX = 'app.tracing'

type Props = {
  type: TracingProvider
  onConfig: () => void
  onChoose: () => void
}

const getIcon = (type: TracingProvider) => {
  return ({
    [TracingProvider.langSmith]: LangsmithIconBig,
    [TracingProvider.langfuse]: LangfuseIconBig,
  })[type]
}

const ProviderPanel: FC<Props> = ({
  type,
  onConfig,
  onChoose,
}) => {
  const { t } = useTranslation()
  const Icon = getIcon(type)

  const handleConfigBtnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onConfig()
  }, [onConfig])
  return (
    <div
      className='px-4 py-3 rounded-xl bg-gray-100'
      onClick={onChoose}
    >
      <div className='flex justify-between items-center space-x-1'>
        <Icon className='h-6' />
        <div
          className='flex px-2 items-center h-6 bg-white rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer text-gray-700 space-x-1'
          onClick={handleConfigBtnClick}
        >
          <Settings04 className='w-3 h-3' />
          <div className='text-xs font-medium'>{t(`${I18N_PREFIX}.config`)}</div>
        </div>
      </div>
      <div className='mt-2 leading-4 text-xs font-normal text-gray-500'>
        {t(`${I18N_PREFIX}.${type}.description`)}
      </div>
    </div>
  )
}
export default React.memo(ProviderPanel)
