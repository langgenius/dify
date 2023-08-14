'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import Config from '@/app/components/explore/universal-chat/config'
import type { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'

type Props = {
  modelId: string
  providerName: ProviderEnum
  plugins: Record<string, boolean>
  dataSets: any[]
}
const ConfigViewPanel: FC<Props> = ({
  modelId,
  providerName,
  plugins,
  dataSets,
}) => {
  const { t } = useTranslation()
  return (
    <div className={cn('absolute top-9 right-0 z-20 p-4 bg-white rounded-2xl shadow-md', s.panelBorder)}>
      <div className='w-[368px]'>
        <Config
          readonly
          modelId={modelId}
          providerName={providerName}
          plugins={plugins}
          dataSets={dataSets}
        />
        <div className='mt-3 text-xs leading-[18px] text-500 font-normal'>{t('explore.universalChat.viewConfigDetailTip')}</div>
      </div>
    </div>
  )
}
export default React.memo(ConfigViewPanel)
