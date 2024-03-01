'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { App } from '@/types/app'
import Run from '@/app/components/workflow/run'
import { XClose } from '@/app/components/base/icons/src/vender/line/general'

type ILogDetail = {
  appDetail?: App
  onClose: () => void
}

const DetailPanel: FC<ILogDetail> = ({ appDetail, onClose }) => {
  const { t } = useTranslation()

  return (
    <div className='grow relative flex flex-col py-3'>
      <span className='absolute right-3 top-4 p-1 cursor-pointer z-20' onClick={onClose}>
        <XClose className='w-4 h-4 text-gray-500' />
      </span>
      <h1 className='shrink-0 px-4 py-1 text-md font-semibold text-gray-900'>{t('appLog.runDetail.workflowTitle')}</h1>
      <Run activeTab='RESULT' appId={appDetail?.id || ''}></Run>
    </div>
  )
}

export default DetailPanel
