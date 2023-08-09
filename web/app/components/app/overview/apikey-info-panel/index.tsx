'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import useSWR from 'swr'
import Progress from './progress'
import Button from '@/app/components/base/button'
import { LinkExternal02, XClose } from '@/app/components/base/icons/src/vender/line/general'
import AccountSetting from '@/app/components/header/account-setting'
import { fetchTenantInfo } from '@/service/common'
import { IS_CE_EDITION } from '@/config'
import { useProviderContext } from '@/context/provider-context'

const APIKeyInfoPanel: FC = () => {
  const isCloud = !IS_CE_EDITION
  const { providers }: any = useProviderContext()

  const { t } = useTranslation()

  const [showSetAPIKeyModal, setShowSetAPIKeyModal] = useState(false)

  const [isShow, setIsShow] = useState(true)

  const { data: userInfo } = useSWR({ url: '/info' }, fetchTenantInfo)
  if (!userInfo)
    return null

  const hasBindAPI = userInfo?.providers?.find(({ token_is_set }) => token_is_set)
  if (hasBindAPI)
    return null

  // first show in trail and not used exhausted, else find the exhausted
  const [used, total, providerName] = (() => {
    if (!providers || !isCloud)
      return [0, 0, '']
    let used = 0
    let total = 0
    let trailProviderName = ''
    let hasFoundNotExhausted = false
    Object.keys(providers).forEach((providerName) => {
      if (hasFoundNotExhausted)
        return
      providers[providerName].providers.forEach(({ quota_type, quota_limit, quota_used }: any) => {
        if (quota_type === 'trial') {
          if (quota_limit !== quota_used)
            hasFoundNotExhausted = true

          used = quota_used
          total = quota_limit
          trailProviderName = providerName
        }
      })
    })
    return [used, total, trailProviderName]
  })()
  const usedPercent = Math.round(used / total * 100)
  const exhausted = isCloud && usedPercent === 100
  if (!(isShow))
    return null

  return (
    <div className={cn(exhausted ? 'bg-[#FEF3F2] border-[#FEE4E2]' : 'bg-[#EFF4FF] border-[#D1E0FF]', 'mb-6 relative  rounded-2xl shadow-md border  p-8 ')}>
      <div className={cn('text-[24px] text-gray-800 font-semibold', isCloud ? 'flex items-center h-8 space-x-1' : 'leading-8 mb-6')}>
        {isCloud && <em-emoji id={exhausted ? '🤔' : '😀'} />}
        {isCloud
          ? (
            <div>{t(`appOverview.apiKeyInfo.cloud.${exhausted ? 'exhausted' : 'trial'}.title`, { providerName })}</div>
          )
          : (
            <div>
              <div>{t('appOverview.apiKeyInfo.selfHost.title.row1')}</div>
              <div>{t('appOverview.apiKeyInfo.selfHost.title.row2')}</div>
            </div>
          )}
      </div>
      {isCloud && (
        <div className='mt-1 text-sm text-gray-600 font-normal'>{t(`appOverview.apiKeyInfo.cloud.${exhausted ? 'exhausted' : 'trial'}.description`)}</div>
      )}
      {/* Call times info */}
      {isCloud && (
        <div className='my-5'>
          <div className='flex items-center h-5 space-x-2 text-sm text-gray-700 font-medium'>
            <div>{t('appOverview.apiKeyInfo.callTimes')}</div>
            <div>·</div>
            <div className={cn('font-semibold', exhausted && 'text-[#D92D20]')}>{used}/{total}</div>
          </div>
          <Progress className='mt-2' value={usedPercent} />
        </div>
      )}
      <Button
        type='primary'
        className='space-x-2'
        onClick={() => {
          setShowSetAPIKeyModal(true)
        }}
      >
        <div className='text-sm font-medium'>{t('appOverview.apiKeyInfo.setAPIBtn')}</div>
        <LinkExternal02 className='w-4 h-4' />
      </Button>
      {!isCloud && (
        <a
          className='mt-2 flex items-center h-[26px] text-xs  font-medium text-[#155EEF] p-1 space-x-1'
          href='https://cloud.dify.ai/apps'
          target='_blank'
        >
          <div>{t('appOverview.apiKeyInfo.tryCloud')}</div>
          <LinkExternal02 className='w-3 h-3' />
        </a>
      )}
      <div
        onClick={() => setIsShow(false)}
        className='absolute right-4 top-4 flex items-center justify-center w-8 h-8 cursor-pointer '>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>

      {
        showSetAPIKeyModal && (
          <AccountSetting activeTab="provider" onCancel={async () => {
            setShowSetAPIKeyModal(false)
          }} />
        )
      }
    </div>
  )
}
export default React.memo(APIKeyInfoPanel)
