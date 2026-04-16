'use client'
import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

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
    )}
    >
      {appDetail && (
        <AppIcon
          className="mr-2"
          size="xs"
          iconType={appDetail.icon_type}
          icon={appDetail.icon}
          background={appDetail.icon_background}
          imageUrl={appDetail.icon_url}
        />
      )}
      {appDetail && (
        <div title={appDetail.name} className="grow system-sm-medium text-components-input-text-filled">{appDetail.name}</div>
      )}
      {!appDetail && (
        <div className="grow truncate system-sm-regular text-components-input-text-placeholder">{t('appSelector.placeholder', { ns: 'app' })}</div>
      )}
      <RiArrowDownSLine className={cn('ml-0.5 h-4 w-4 shrink-0 text-text-quaternary group-hover:text-text-secondary', open && 'text-text-secondary')} />
    </div>
  )
}

export default AppTrigger
