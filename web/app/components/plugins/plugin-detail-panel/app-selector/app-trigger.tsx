'use client'

import type { App } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

type AppTriggerProps = {
  open: boolean
  appDetail?: App
}

export function AppTrigger({
  open,
  appDetail,
}: AppTriggerProps) {
  const { t } = useTranslation()

  return (
    <span
      className={cn(
        'group flex cursor-pointer items-center rounded-lg bg-components-input-bg-normal p-2 pl-3 hover:bg-state-base-hover-alt',
        open && 'bg-state-base-hover-alt',
        appDetail && 'py-1.5 pl-1.5',
      )}
    >
      {appDetail && (
        <AppIcon
          className="mr-2 shrink-0"
          size="xs"
          iconType={appDetail.icon_type}
          icon={appDetail.icon}
          background={appDetail.icon_background}
          imageUrl={appDetail.icon_url}
        />
      )}
      {appDetail
        ? (
            <span title={appDetail.name} className="min-w-0 grow truncate system-sm-medium text-components-input-text-filled">
              {appDetail.name}
            </span>
          )
        : (
            <span className="min-w-0 grow truncate system-sm-regular text-components-input-text-placeholder">
              {t('appSelector.placeholder', { ns: 'app' })}
            </span>
          )}
      <span
        className={cn(
          'ml-0.5 i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary group-hover:text-text-secondary',
          open && 'text-text-secondary',
        )}
        aria-hidden="true"
      />
    </span>
  )
}
