'use client'
import type { FC } from 'react'
import React from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import { useTranslation } from 'react-i18next'
import type { TryAppInfo } from '@/service/try-app'
import cn from '@/utils/classnames'

type Props = {
  appDetail: TryAppInfo
  className?: string
}

const AppInfo: FC<Props> = ({
  className,
  appDetail,
}) => {
  const { t } = useTranslation()
  const mode = appDetail?.mode
  return (
    <div className={cn('px-4 pt-4', className)}>
      {/* name and icon */}
      <div className='flex h-[66px] shrink-0 grow-0 items-center gap-3 pb-3'>
        <div className='relative shrink-0'>
          <AppIcon
            size='large'
            iconType={appDetail.site.icon_type}
            icon={appDetail.site.icon}
            background={appDetail.site.icon_background}
            imageUrl={appDetail.site.icon_url}
          />
          <AppTypeIcon wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm'
            className='h-3 w-3' type={mode} />
        </div>
        <div className='w-0 grow py-[1px]'>
          <div className='flex items-center text-sm font-semibold leading-5 text-text-secondary'>
            <div className='truncate' title={appDetail.name}>{appDetail.name}</div>
          </div>
          <div className='flex items-center text-[10px] font-medium leading-[18px] text-text-tertiary'>
            {mode === 'advanced-chat' && <div className='truncate'>{t('app.types.advanced').toUpperCase()}</div>}
            {mode === 'chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
            {mode === 'agent-chat' && <div className='truncate'>{t('app.types.agent').toUpperCase()}</div>}
            {mode === 'workflow' && <div className='truncate'>{t('app.types.workflow').toUpperCase()}</div>}
            {mode === 'completion' && <div className='truncate'>{t('app.types.completion').toUpperCase()}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
export default React.memo(AppInfo)
