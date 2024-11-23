'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import { LinkExternal02 } from '@/app/components/base/icons/src/vender/line/general'
import { IS_CE_EDITION } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { useModalContext } from '@/context/modal-context'

const APIKeyInfoPanel: FC = () => {
  const isCloud = !IS_CE_EDITION

  const { isAPIKeySet } = useProviderContext()
  const { setShowAccountSettingModal } = useModalContext()

  const { t } = useTranslation()

  const [isShow, setIsShow] = useState(true)

  if (isAPIKeySet)
    return null

  if (!(isShow))
    return null

  return (
    <div className={cn('bg-[#EFF4FF] border-[#D1E0FF]', 'mb-6 relative  rounded-2xl shadow-md border  p-8 ')}>
      <div className={cn('text-[24px] text-gray-800 font-semibold', isCloud ? 'flex items-center h-8 space-x-1' : 'leading-8 mb-6')}>
        {isCloud && <em-emoji id={'😀'} />}
        {isCloud
          ? (
            <div>{t('appOverview.apiKeyInfo.cloud.trial.title', { providerName: 'OpenAI' })}</div>
          )
          : (
            <div>
              <div>{t('appOverview.apiKeyInfo.selfHost.title.row1')}</div>
              <div>{t('appOverview.apiKeyInfo.selfHost.title.row2')}</div>
            </div>
          )}
      </div>
      {isCloud && (
        <div className='mt-1 text-sm text-gray-600 font-normal'>{t(`appOverview.apiKeyInfo.cloud.${'trial'}.description`)}</div>
      )}
      <Button
        variant='primary'
        className='space-x-2'
        onClick={() => setShowAccountSettingModal({ payload: 'provider' })}
      >
        <div className='text-sm font-medium'>{t('appOverview.apiKeyInfo.setAPIBtn')}</div>
        <LinkExternal02 className='w-4 h-4' />
      </Button>
      {!isCloud && (
        <a
          className='mt-2 flex items-center h-[26px] text-xs  font-medium text-[#155EEF] p-1 space-x-1'
          href='https://cloud.dify.ai/apps'
          target='_blank' rel='noopener noreferrer'
        >
          <div>{t('appOverview.apiKeyInfo.tryCloud')}</div>
          <LinkExternal02 className='w-3 h-3' />
        </a>
      )}
      <div
        onClick={() => setIsShow(false)}
        className='absolute right-4 top-4 flex items-center justify-center w-8 h-8 cursor-pointer '>
        <RiCloseLine className='w-4 h-4 text-gray-500' />
      </div>
    </div>
  )
}
export default React.memo(APIKeyInfoPanel)
