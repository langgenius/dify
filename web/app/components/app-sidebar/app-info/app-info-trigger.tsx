import type { App, AppSSO } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
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
      <div
        className={cn(
          'rounded-xl hover:bg-state-base-hover',
          expand ? 'flex items-start gap-2 p-2' : 'flex items-center justify-center px-1 py-1.5',
        )}
      >
        <div className="flex shrink-0 items-center">
          <div>
            <AppIcon
              size={expand ? 'large' : 'medium'}
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
          </div>
        </div>
        {expand && (
          <>
            <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-0.5 self-stretch">
              <div className="flex w-full min-w-0 pr-1">
                <div className="truncate system-md-semibold text-text-secondary">
                  {appDetail.name}
                </div>
              </div>
              <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
                {modeLabel}
              </div>
            </div>
            <div className="flex size-5 shrink-0 items-center justify-center rounded-md p-0.5">
              <span aria-hidden className="i-ri-equalizer-2-line size-4 text-text-tertiary" />
            </div>
          </>
        )}
      </div>
    </button>
  )
}

export default React.memo(AppInfoTrigger)
