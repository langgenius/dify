'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useBoolean, useClickAway } from 'ahooks'
import s from './style.module.css'
import Config from '@/app/components/explore/universal-chat/config'

type Props = {
  modelId: string
  plugins: Record<string, boolean>
  dataSets: any[]
}
const ConfigViewPanel: FC<Props> = ({
  modelId,
  plugins,
  dataSets,
}) => {
  const { t } = useTranslation()
  const [isShowConfig, { setFalse: hideConfig, toggle: toggleShowConfig }] = useBoolean(false)
  const configContentRef = React.useRef(null)

  useClickAway(() => {
    hideConfig()
  }, configContentRef)
  return (
    <div ref={configContentRef} className='relative'>
      <div onClick={toggleShowConfig} className={cn(s.btn, 'flex h-8 w-8 rounded-lg border border-gray-200 bg-white cursor-pointer')}></div>
      {isShowConfig && (
        <div className={cn('absolute top-9 right-0 z-20 p-4 bg-white rounded-2xl shadow-md', s.panelBorder)}>
          <div className='w-[368px]'>
            <Config
              readonly
              modelId={modelId}
              plugins={plugins}
              dataSets={dataSets}
            />
            <div className='mt-3 text-xs leading-[18px] text-500 font-normal'>{t('explore.universalChat.viewConfigDetailTip')}</div>
          </div>
        </div>
      )}

    </div>
  )
}
export default React.memo(ConfigViewPanel)
