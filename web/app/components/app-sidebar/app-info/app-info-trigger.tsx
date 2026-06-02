import type { App, AppSSO } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { RiEqualizer2Line } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../../base/app-icon'
import { getAppModeLabel } from './app-mode-labels'

type AppInfoTriggerProps = {
  appDetail: App & Partial<AppSSO>
  expand: boolean
  onClick: () => void
}

const AppInfoTrigger = ({ appDetail, expand, onClick }: AppInfoTriggerProps) => {
  const { t } = useTranslation()
  const modeLabel = getAppModeLabel(appDetail.mode, t)

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full"
      aria-label={!expand ? `${appDetail.name} - ${modeLabel}` : undefined}
    >
      <div className={cn(
        'rounded-xl hover:bg-state-base-hover',
        expand ? 'flex items-start gap-2 p-2' : 'flex flex-col gap-2 p-1',
      )}
      >
        <div className={cn('flex items-center', expand ? 'shrink-0' : 'gap-1')}>
          <div className={cn(!expand && 'ml-1')}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
          </div>
        </div>
        {!expand && (
          <div className="flex items-center justify-center">
            <div className="flex size-5 items-center justify-center rounded-md p-0.5">
              <RiEqualizer2Line className="size-4 text-text-tertiary" />
            </div>
          </div>
        )}
        {expand && (
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
              <div className="flex w-full min-w-0 pr-1">
                <div className="truncate system-md-semibold text-text-secondary">{appDetail.name}</div>
              </div>
              <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
                {modeLabel}
              </div>
            </div>
            <div className="flex size-5 shrink-0 items-center justify-center rounded-md p-0.5">
              <RiEqualizer2Line className="size-4 text-text-tertiary" />
            </div>
          </>
        )}
      </div>
    </button>
  )
}

export default React.memo(AppInfoTrigger)
