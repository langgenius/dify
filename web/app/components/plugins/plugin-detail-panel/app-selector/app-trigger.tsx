'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import AppIcon from '@/app/components/base/app-icon'
import type { App } from '@/types/app'
import cn from '@/utils/classnames'

type Props = {
  open: boolean
  appDetail?: App
}

const AppTrigger = ({
  open,
  appDetail,
}: Props) => {
  const { t } = useTranslation()
  return (
    <div className={cn(
      'group flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal p-2 pl-3 hover:bg-state-base-hover-alt',
      open && 'bg-state-base-hover-alt',
      appDetail && 'py-1.5 pl-1.5',
    )}>
      {appDetail && (
        <AppIcon
          className='mr-2'
          size='xs'
          iconType={appDetail.icon_type}
          icon={appDetail.icon}
          background={appDetail.icon_background}
          imageUrl={appDetail.icon_url}
        />
      )}
      {appDetail && (
        <div title={appDetail.name} className='system-sm-medium grow text-components-input-text-filled'>{appDetail.name}</div>
      )}
      {!appDetail && (
        <div className='system-sm-regular grow truncate text-components-input-text-placeholder'>{t('app.appSelector.placeholder')}</div>
      )}
      <RiArrowDownSLine className={cn('ml-0.5 h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
    </div>
  )
}

export default AppTrigger
