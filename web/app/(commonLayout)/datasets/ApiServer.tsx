'use client'

import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import CopyFeedback from '@/app/components/base/copy-feedback'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import { randomString } from '@/utils'

type ApiServerProps = {
  apiBaseUrl: string
}
const ApiServer: FC<ApiServerProps> = ({
  apiBaseUrl,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex flex-wrap items-center gap-y-2'>
      <div className='mr-2 flex h-8 items-center rounded-lg border-[0.5px] border-white bg-white/80 pl-1.5 pr-1 leading-5'>
        <div className='mr-0.5 h-5 shrink-0 rounded-md border border-gray-200 px-1.5 text-[11px] text-gray-500'>{t('appApi.apiServer')}</div>
        <div className='w-fit truncate px-1 text-[13px] font-medium text-gray-800 sm:w-[248px]'>{apiBaseUrl}</div>
        <div className='mx-1 h-[14px] w-[1px] bg-gray-200'></div>
        <CopyFeedback
          content={apiBaseUrl}
          selectorId={randomString(8)}
          className={'!h-6 !w-6 hover:bg-gray-200'}
        />
      </div>
      <div className='mr-2 flex h-8 items-center rounded-lg border-[0.5px] border-[#D1FADF] bg-[#ECFDF3] px-3 text-xs font-semibold text-[#039855]'>
        {t('appApi.ok')}
      </div>
      <SecretKeyButton
        className='!h-8 shrink-0 bg-white'
      />
    </div>
  )
}

export default ApiServer
