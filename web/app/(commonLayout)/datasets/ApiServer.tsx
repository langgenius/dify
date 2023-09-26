'use client'

import { useTranslation } from 'react-i18next'
import CopyFeedback from '@/app/components/base/copy-feedback'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import { randomString } from '@/utils'

const ApiServer = () => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center'>
      <div className='flex items-center mr-2 pl-1.5 pr-1 h-8 bg-white/80 border-[0.5px] border-white rounded'>
        <div className='mr-0.5 px-1.5 h-5 border border-gray-200 text-[11px] text-gray-500 rounded-md'>{t('appApi.apiServer')}</div>
        <div className='px-1 w-[248px] text-[13px] font-medium text-gray-800'>https://api.dify.dev/v1</div>
        <div className='mx-1 w-[1px] h-[14px] bg-gray-200'></div>
        <CopyFeedback
          content=''
          selectorId={randomString(8)}
          className={'!w-6 !h-6 hover:bg-gray-200'}
        />
      </div>
      <div className='flex items-center mr-2 px-3 h-8 bg-[#ECFDF3] text-xs font-semibold text-[#039855] rounded-lg border-[0.5px] border-[#D1FADF]'>
        {t('appApi.ok')}
      </div>
      <SecretKeyButton
        className='flex-shrink-0 !h-8 bg-white'
        textCls='!text-gray-700 font-medium'
        iconCls='stroke-[1.2px]'
      />
    </div>
  )
}

export default ApiServer
